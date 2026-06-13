using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

var builder = WebApplication.CreateBuilder(args);
const int MaxPicksPerUser = 3;
const int StartingPlayerCount = 11;
const int FullBenchPlayerCount = 15;

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = AppJson.Options.PropertyNamingPolicy;
});

builder.Services.AddHttpClient("WorldCupScraper", client =>
{
    var baseUrl = builder.Configuration["WorldCupScraper:BaseUrl"] ?? "http://localhost:5082";
    client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : $"{baseUrl}/");
    client.DefaultRequestHeaders.Accept.ParseAdd("application/json");
});

builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration["Redis:ConnectionString"] ?? "localhost:6379";
    options.InstanceName = "FarmersLeague:";
});
builder.Services.AddSingleton<LiveDraftConnections>();

var app = builder.Build();

await SeedLocalUsers(app.Services);

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseWebSockets();

app.MapGet("/api/hello", () => new HelloResponse("Hello from FarmersLeague API"));

app.MapGet("/api/access/{passkey}", async (string passkey, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var userName = await cache.GetStringAsync(UserPasskeyCacheKey(passkey), cancellationToken);

    return userName is null
        ? Results.NotFound(new AccessResponse(false, null))
        : Results.Ok(new AccessResponse(true, userName));
});

app.MapGet("/api/drafts/{matchId:int}", async (int matchId, string? passkey, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var match = await GetMatch(matchId, httpClientFactory, cancellationToken);
    if (match is null)
    {
        return Results.NotFound();
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null)
    {
        var userName = passkey is null ? null : await cache.GetStringAsync(UserPasskeyCacheKey(passkey), cancellationToken);
        draft = NewOpenDraftState(userName is null ? [] : [userName]);
        await SaveDraft(matchId, draft, cache, cancellationToken);
    }

    return Results.Ok(ToDraftResponse(match, draft));
});

app.MapPost("/api/drafts/{matchId:int}", async (int matchId, DraftLifecycleRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetUpcomingDraftContext(request.Passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    var draft = NewOpenDraftState([draftContext.UserName!]);
    var response = await SaveAndBroadcastDraft(matchId, draftContext.Match!, draft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(response);
});

app.MapPost("/api/drafts/{matchId:int}/join", async (int matchId, DraftLifecycleRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetUpcomingDraftContext(request.Passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null)
    {
        return Results.NotFound(new DraftPickErrorResponse("Draft not found"));
    }

    if (!string.Equals(draft.Status, DraftStatuses.Open, StringComparison.Ordinal))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft is closed to new joiners"));
    }

    if (!draft.JoinedUsers.Contains(draftContext.UserName!, StringComparer.Ordinal))
    {
        draft = draft with { JoinedUsers = draft.JoinedUsers.Concat([draftContext.UserName!]).ToArray() };
    }

    var response = await SaveAndBroadcastDraft(matchId, draftContext.Match!, draft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(response);
});

app.MapPost("/api/drafts/{matchId:int}/start", async (int matchId, DraftLifecycleRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetUpcomingDraftContext(request.Passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    if (!HasConfirmedFullSquads(draftContext.Match!))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Starting lineups and full benches are not confirmed"));
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null)
    {
        return Results.NotFound(new DraftPickErrorResponse("Draft not found"));
    }

    if (!string.Equals(draft.Status, DraftStatuses.Open, StringComparison.Ordinal))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft already started"));
    }

    if (!draft.JoinedUsers.Contains(draftContext.UserName!, StringComparer.Ordinal))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Join the draft before starting it"));
    }

    if (draft.JoinedUsers.Count < 2)
    {
        return Results.BadRequest(new DraftPickErrorResponse("Starting a draft requires at least two joined users"));
    }

    draft = draft with
    {
        Status = DraftStatuses.Started,
        DraftOrder = draft.JoinedUsers.OrderBy(_ => Random.Shared.Next()).ToArray(),
        Picks = []
    };
    var response = await SaveAndBroadcastDraft(matchId, draftContext.Match!, draft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(response);
});

app.MapDelete("/api/drafts/{matchId:int}", async (int matchId, string passkey, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftContext(passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is not null && IsDraftComplete(draft))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft complete"));
    }

    await cache.RemoveAsync(DraftCacheKey(matchId), cancellationToken);
    await liveDraftConnections.Broadcast(matchId, ToDraftResponse(draftContext.Match!, NewOpenDraftState([draftContext.UserName!])), cancellationToken);

    return Results.NoContent();
});

app.MapGet("/api/drafts/{matchId:int}/live", async (int matchId, HttpContext context, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        return Results.BadRequest(new DraftPickErrorResponse("Live draft updates require a WebSocket connection"));
    }

    var draftContext = await GetDraftContext(
        context.Request.Query["passkey"].ToString(),
        matchId,
        httpClientFactory,
        cache,
        cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }
    var match = draftContext.Match!;

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    liveDraftConnections.Add(matchId, socket);

    var draft = await GetDraft(matchId, cache, cancellationToken) ?? NewOpenDraftState([]);
    await liveDraftConnections.Send(socket, ToDraftResponse(match, draft), cancellationToken);

    var buffer = new byte[1024];
    try
    {
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            var message = await socket.ReceiveAsync(buffer, cancellationToken);
            if (message.MessageType == WebSocketMessageType.Close)
            {
                break;
            }
        }
    }
    finally
    {
        liveDraftConnections.Remove(matchId, socket);
    }

    return Results.Empty;
});

app.MapPost("/api/drafts/{matchId:int}/picks", async (int matchId, DraftPickRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftContext(request.Passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }
    var match = draftContext.Match!;
    var userName = draftContext.UserName!;

    var draft = await GetDraft(matchId, cache, cancellationToken) ?? NewOpenDraftState([]);

    if (!string.Equals(draft.Status, DraftStatuses.Started, StringComparison.Ordinal))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft has not started"));
    }

    if (IsDraftComplete(draft))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft complete"));
    }

    var currentTurn = GetCurrentTurn(draft);
    if (!string.Equals(currentTurn, userName, StringComparison.Ordinal))
    {
        return Results.BadRequest(new DraftPickErrorResponse($"Wait for {currentTurn}’s turn"));
    }

    if (!HasPlayerInMatch(match, request.PlayerName))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Player is not available in this match"));
    }

    if (IsPlayerDrafted(draft, request.PlayerName))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Player is already drafted"));
    }

    if (PickCountFor(draft, userName) >= MaxPicksPerUser)
    {
        return Results.BadRequest(new DraftPickErrorResponse($"You already drafted {MaxPicksPerUser} players"));
    }

    var updatedDraft = draft with
    {
        Picks = draft.Picks.Concat([new DraftPick(userName, request.PlayerName)]).ToArray()
    };

    var updatedResponse = await SaveAndBroadcastDraft(matchId, match, updatedDraft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(updatedResponse);
});

app.MapGet("/api/matches", async (IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var matches = await GetMatches(httpClientFactory, includeLineups: false, cancellationToken);
    var responses = new List<HomeMatchResponse>();

    foreach (var match in matches)
    {
        var draft = await GetDraft(match.Id, cache, cancellationToken);
        responses.Add(ToHomeMatchResponse(match, draft));
    }

    return Results.Ok(responses);
});

app.MapDelete("/api/testing/drafts", async (IDistributedCache cache, CancellationToken cancellationToken) =>
{
    await cache.RemoveAsync(DraftCacheKey(1001), cancellationToken);

    return Results.NoContent();
});

app.MapDelete("/api/testing/drafts/{matchId:int}", async (int matchId, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    await cache.RemoveAsync(DraftCacheKey(matchId), cancellationToken);

    return Results.NoContent();
});

app.MapPut("/api/testing/drafts/{matchId:int}", async (int matchId, DraftState draft, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    await SaveDraft(matchId, NormalizeDraft(draft), cache, cancellationToken);

    return Results.NoContent();
});

app.MapFallbackToFile("index.html");

app.Run();

static async Task SeedLocalUsers(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var cache = scope.ServiceProvider.GetRequiredService<IDistributedCache>();

    foreach (var user in SeededUsers())
    {
        await cache.SetStringAsync(UserPasskeyCacheKey(user.Passkey), user.Name);
    }
}

static string UserPasskeyCacheKey(string passkey) => $"users:passkeys:{passkey}";

static string DraftCacheKey(int matchId) => $"drafts:{matchId}";

static async Task<IReadOnlyList<MatchResponse>> GetMatches(IHttpClientFactory httpClientFactory, bool includeLineups, CancellationToken cancellationToken)
{
    var scraper = httpClientFactory.CreateClient("WorldCupScraper");

    return await GetScraperMatches(scraper, includeLineups, cancellationToken);
}

static async Task<IReadOnlyList<MatchResponse>> GetScraperMatches(HttpClient scraper, bool includeLineups, CancellationToken cancellationToken)
{
    var games = await scraper.GetFromJsonAsync<IReadOnlyList<WorldCupGameResponse>>("api/world-cup-2026/games", AppJson.Options, cancellationToken) ?? [];
    var matches = new List<MatchResponse>();

    foreach (var game in games)
    {
        var match = ToScraperMatchResponse(game);
        if (match is null)
        {
            continue;
        }

        var lineups = includeLineups ? await GetScraperLineups(scraper, game.Id, cancellationToken) : [];
        matches.Add(match with { Lineups = lineups });
    }

    return matches.OrderBy(match => match.Date).ToArray();
}

static async Task<IReadOnlyList<LineupResponse>> GetScraperLineups(HttpClient scraper, string gameId, CancellationToken cancellationToken)
{
    using var httpResponse = await scraper.GetAsync($"api/world-cup-2026/games/{gameId}/lineups", cancellationToken);
    if (httpResponse.StatusCode == HttpStatusCode.NotFound)
    {
        return [];
    }

    httpResponse.EnsureSuccessStatusCode();
    var response = await httpResponse.Content.ReadFromJsonAsync<WorldCupLineupResponse>(AppJson.Options, cancellationToken);
    if (response is null)
    {
        return [];
    }

    return [ToScraperLineupResponse(response.HomeTeam), ToScraperLineupResponse(response.AwayTeam)];
}

static async Task<MatchResponse?> GetMatch(int matchId, IHttpClientFactory httpClientFactory, CancellationToken cancellationToken)
{
    var matches = await GetMatches(httpClientFactory, includeLineups: true, cancellationToken);

    return matches.FirstOrDefault(match => match.Id == matchId);
}

static async Task<DraftContextResult> GetDraftContext(string passkey, int matchId, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken)
{
    var userName = await cache.GetStringAsync(UserPasskeyCacheKey(passkey), cancellationToken);
    if (userName is null)
    {
        return new DraftContextResult(null, null, Results.NotFound(new DraftPickErrorResponse("No access")));
    }

    var match = await GetMatch(matchId, httpClientFactory, cancellationToken);
    if (match is null)
    {
        return new DraftContextResult(userName, null, Results.NotFound(new DraftPickErrorResponse("Match not found")));
    }

    return new DraftContextResult(userName, match, null);
}

static async Task<DraftContextResult> GetUpcomingDraftContext(string passkey, int matchId, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken)
{
    var draftContext = await GetDraftContext(passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext;
    }

    return HasMatchStarted(draftContext.Match!)
        ? draftContext with { Error = Results.BadRequest(new DraftPickErrorResponse("Match started")) }
        : draftContext;
}

static async Task<DraftState?> GetDraft(int matchId, IDistributedCache cache, CancellationToken cancellationToken)
{
    var cachedDraft = await cache.GetStringAsync(DraftCacheKey(matchId), cancellationToken);
    return cachedDraft is null ? null : NormalizeDraft(JsonSerializer.Deserialize<DraftState>(cachedDraft, AppJson.Options));
}

static DraftState NewOpenDraftState(IReadOnlyList<string> joinedUsers) => new(DraftStatuses.Open, joinedUsers, [], []);

static DraftState NormalizeDraft(DraftState? draft)
{
    if (draft is null)
    {
        return NewOpenDraftState([]);
    }

    var draftOrder = draft.DraftOrder ?? [];
    var rawJoinedUsers = draft.JoinedUsers ?? [];
    var joinedUsers = rawJoinedUsers.Count > 0 ? rawJoinedUsers : draftOrder;
    var status = string.IsNullOrWhiteSpace(draft.Status)
        ? draftOrder.Count > 0 ? DraftStatuses.Started : DraftStatuses.Open
        : draft.Status;

    var normalized = draft with
    {
        Status = status,
        JoinedUsers = joinedUsers,
        DraftOrder = draftOrder,
        Picks = draft.Picks ?? []
    };

    return IsDraftComplete(normalized) ? normalized with { Status = DraftStatuses.Completed } : normalized;
}

static Task SaveDraft(int matchId, DraftState draft, IDistributedCache cache, CancellationToken cancellationToken) =>
    cache.SetStringAsync(DraftCacheKey(matchId), JsonSerializer.Serialize(draft, AppJson.Options), cancellationToken);

static async Task<DraftResponse> SaveAndBroadcastDraft(int matchId, MatchResponse match, DraftState draft, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken)
{
    await SaveDraft(matchId, draft, cache, cancellationToken);
    var response = ToDraftResponse(match, draft);
    await liveDraftConnections.Broadcast(matchId, response, cancellationToken);

    return response;
}

static DraftResponse ToDraftResponse(MatchResponse match, DraftState draft)
{
    draft = NormalizeDraft(draft);
    var isComplete = IsDraftComplete(draft);
    var status = isComplete ? DraftStatuses.Completed : draft.Status;
    var currentTurn = string.Equals(status, DraftStatuses.Started, StringComparison.Ordinal) && !isComplete ? GetCurrentTurn(draft) : null;

    return new DraftResponse(match, status, draft.JoinedUsers, draft.DraftOrder, draft.Picks, currentTurn, isComplete);
}

static bool IsDraftComplete(DraftState draft) => draft.DraftOrder.Count > 0 && draft.Picks.Count >= draft.DraftOrder.Count * MaxPicksPerUser;

static bool HasMatchStarted(MatchResponse match) => match.Date <= DateTimeOffset.UtcNow;

static bool HasConfirmedFullSquads(MatchResponse match) =>
    match.Lineups.Count >= 2
    && match.Lineups.All(lineup => lineup.Starters.Count == StartingPlayerCount && lineup.Bench.Count == FullBenchPlayerCount);

static bool HasPlayerInMatch(MatchResponse match, string playerName) =>
    match.Lineups.SelectMany(lineup => lineup.Starters).Any(starter => string.Equals(starter.Name, playerName, StringComparison.Ordinal));

static bool IsPlayerDrafted(DraftState draft, string playerName) =>
    draft.Picks.Any(pick => string.Equals(pick.PlayerName, playerName, StringComparison.Ordinal));

static int PickCountFor(DraftState draft, string userName) =>
    draft.Picks.Count(pick => string.Equals(pick.UserName, userName, StringComparison.Ordinal));

static string? GetCurrentTurn(DraftState draft)
{
    for (var pickOffset = 0; pickOffset < draft.DraftOrder.Count; pickOffset++)
    {
        var userName = draft.DraftOrder[(draft.Picks.Count + pickOffset) % draft.DraftOrder.Count];
        if (PickCountFor(draft, userName) < MaxPicksPerUser)
        {
            return userName;
        }
    }

    return null;
}

static MatchResponse? ToScraperMatchResponse(WorldCupGameResponse game)
{
    if (!int.TryParse(game.Id, out var matchId))
    {
        return null;
    }

    return new MatchResponse(
        matchId,
        game.HomeTeam.Name,
        game.AwayTeam.Name,
        "FIFA World Cup",
        game.StartTimeUtc,
        []);
}

static LineupResponse ToScraperLineupResponse(WorldCupLineupTeamResponse lineup) => new(
    lineup.Name,
    lineup.Formation ?? string.Empty,
    lineup.Starting11.Select((player, index) => ToScraperStarterResponse(player, FormationGrid(lineup.Formation, index))).ToArray(),
    lineup.Bench.Select(player => ToScraperStarterResponse(player, null)).ToArray());

static StarterResponse ToScraperStarterResponse(WorldCupLineupPlayerResponse player, string? grid)
{
    var (gridRow, gridColumn) = ParseGrid(grid);

    return new StarterResponse(
        player.Name,
        player.ShirtNumber,
        PlayerPosition(player),
        grid,
        gridRow,
        gridColumn);
}

static string? PlayerPosition(WorldCupLineupPlayerResponse player) =>
    player.PositionId?.ToString() ?? player.UsualPlayingPositionId?.ToString();

static string? FormationGrid(string? formation, int starterIndex)
{
    if (starterIndex == 0)
    {
        return "1:1";
    }

    var rows = formation?
        .Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Select(part => int.TryParse(part, out var playerCount) ? playerCount : 0)
        .Where(playerCount => playerCount > 0)
        .ToArray();
    if (rows is null || rows.Length == 0)
    {
        return null;
    }

    var offset = starterIndex - 1;
    for (var rowIndex = 0; rowIndex < rows.Length; rowIndex++)
    {
        if (offset < rows[rowIndex])
        {
            return $"{rowIndex + 2}:{offset + 1}";
        }

        offset -= rows[rowIndex];
    }

    return null;
}

static (int? Row, int? Column) ParseGrid(string? grid)
{
    var parts = grid?.Split(':');
    if (parts?.Length != 2)
    {
        return (null, null);
    }

    return int.TryParse(parts[0], out var row) && int.TryParse(parts[1], out var column)
        ? (row, column)
        : (null, null);
}

static HomeMatchResponse ToHomeMatchResponse(MatchResponse match, DraftState? draft) => new(
    match.Id,
    match.HomeTeam,
    match.AwayTeam,
    match.League,
    match.Date,
    match.Lineups,
    draft is null ? null : ToDraftResponse(match, draft),
    HasMatchStarted(match));

static TestUser[] SeededUsers() =>
[
    new("Alice", "11111111-1111-1111-1111-111111111111"),
    new("Bob", "22222222-2222-2222-2222-222222222222"),
    new("Carol", "33333333-3333-3333-3333-333333333333")
];
