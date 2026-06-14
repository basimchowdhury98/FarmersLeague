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
    var user = await GetUser(passkey, cache, cancellationToken);

    return user is null
        ? Results.NotFound(new AccessResponse(false, null, false))
        : Results.Ok(new AccessResponse(true, user.Name, user.IsAdmin));
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
        if (passkey is null)
        {
            return Results.NotFound(new DraftPickErrorResponse("No access"));
        }

        var user = await GetUser(passkey, cache, cancellationToken);
        if (user is null)
        {
            return Results.NotFound(new DraftPickErrorResponse("No access"));
        }

        if (!user.IsAdmin)
        {
            return Results.NotFound(new DraftPickErrorResponse("Draft not found"));
        }

        draft = NewOpenDraftState([user.Name]);
        await SaveDraft(matchId, draft, cache, cancellationToken);
    }

    return Results.Ok(ToDraftResponse(match, draft));
});

app.MapPost("/api/drafts/{matchId:int}", async (int matchId, DraftAccessRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftContext(request.Passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    if (HasMatchStarted(draftContext.Match!))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft can't be created since match has started or ended"));
    }

    if (RequireAdmin(draftContext) is { } forbidden)
    {
        return forbidden;
    }

    var draft = NewOpenDraftState([draftContext.UserName!]);
    var response = await SaveAndBroadcastDraft(matchId, draftContext.Match!, draft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(response);
});

app.MapPost("/api/drafts/{matchId:int}/join", async (int matchId, DraftAccessRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
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

app.MapPost("/api/drafts/{matchId:int}/start", async (int matchId, DraftStartRequest request, IHttpClientFactory httpClientFactory, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftContext(request.Passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    if (HasMatchStarted(draftContext.Match!))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft can't be started since match has started"));
    }

    if (RequireAdmin(draftContext) is { } forbidden)
    {
        return forbidden;
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

    var randomizedDraftOrder = CreateRandomDraftOrder(draft.JoinedUsers);
    draft = draft with
    {
        Status = DraftStatuses.Started,
        DraftOrder = randomizedDraftOrder,
        DraftTurnOrder = CreateDraftTurnOrder(randomizedDraftOrder, request.DraftOrderMode),
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

    if (RequireAdmin(draftContext) is { } forbidden)
    {
        return forbidden;
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
    liveDraftConnections.Add(matchId, socket, draftContext.UserName!, draftContext.IsAdmin);

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

            if (message.MessageType == WebSocketMessageType.Text && liveDraftConnections.IsAdmin(matchId, socket))
            {
                var clientMessage = JsonSerializer.Deserialize<DraftLiveClientMessage>(Encoding.UTF8.GetString(buffer, 0, message.Count), AppJson.Options);
                if (clientMessage is not null && string.Equals(clientMessage.Type, "draftOrderRevealNext", StringComparison.Ordinal))
                {
                    var currentDraft = await GetDraft(matchId, cache, cancellationToken) ?? NewOpenDraftState([]);
                    await liveDraftConnections.BroadcastDraftOrderReveal(matchId, Math.Clamp(clientMessage.RevealedCount ?? 0, 0, currentDraft.DraftOrder.Count), cancellationToken);
                }
                else if (clientMessage is not null && string.Equals(clientMessage.Type, "draftOrderRevealSkip", StringComparison.Ordinal))
                {
                    var currentDraft = await GetDraft(matchId, cache, cancellationToken) ?? NewOpenDraftState([]);
                    await liveDraftConnections.BroadcastDraftOrderReveal(matchId, currentDraft.DraftOrder.Count, cancellationToken);
                }
                else if (clientMessage is not null && string.Equals(clientMessage.Type, "draftOrderRevealComplete", StringComparison.Ordinal))
                {
                    await liveDraftConnections.BroadcastDraftOrderRevealComplete(matchId, cancellationToken);
                }
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

    if (IsDraftComplete(updatedDraft) && HasMatchStarted(match))
    {
        await cache.RemoveAsync(DraftCacheKey(matchId), cancellationToken);
        await liveDraftConnections.Broadcast(matchId, ToDraftResponse(match, NewOpenDraftState([])), cancellationToken);

        return Results.BadRequest(new DraftPickErrorResponse("Live match cannot be created since the actual match has started"));
    }

    var updatedResponse = await SaveAndBroadcastDraft(matchId, match, updatedDraft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(updatedResponse);
});

app.MapGet("/api/matches/{matchId:int}/live", async (int matchId, string passkey, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var liveMatch = await GetLiveMatch(passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (liveMatch.Error is not null)
    {
        return liveMatch.Error;
    }

    return Results.Ok(liveMatch.LiveMatch);
});

app.MapGet("/api/matches/{matchId:int}/live/updates", async (int matchId, HttpContext context, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        return Results.BadRequest(new DraftPickErrorResponse("Live match updates require a WebSocket connection"));
    }

    var passkey = context.Request.Query["passkey"].ToString();
    var initialLiveMatch = await GetLiveMatch(passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (initialLiveMatch.Error is not null)
    {
        return initialLiveMatch.Error;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var lastPayload = string.Empty;

    while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
    {
        var liveMatch = await GetLiveMatch(passkey, matchId, httpClientFactory, cache, cancellationToken);
        if (liveMatch.Error is not null)
        {
            break;
        }

        var payload = JsonSerializer.Serialize(liveMatch.LiveMatch, AppJson.Options);
        if (!string.Equals(payload, lastPayload, StringComparison.Ordinal))
        {
            var bytes = Encoding.UTF8.GetBytes(payload);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
            lastPayload = payload;
        }

        await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
    }

    return Results.Empty;
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
        await cache.SetStringAsync(UserPasskeyCacheKey(user.Passkey), JsonSerializer.Serialize(user, AppJson.Options));
    }
}

static string UserPasskeyCacheKey(string passkey) => $"users:passkeys:{passkey}";

static async Task<LeagueUser?> GetUser(string passkey, IDistributedCache cache, CancellationToken cancellationToken)
{
    var cachedUser = await cache.GetStringAsync(UserPasskeyCacheKey(passkey), cancellationToken);
    if (cachedUser is null)
    {
        return null;
    }

    if (cachedUser.StartsWith('{'))
    {
        return JsonSerializer.Deserialize<LeagueUser>(cachedUser, AppJson.Options);
    }

    return new LeagueUser(cachedUser, passkey, false);
}

static IResult? RequireAdmin(DraftContextResult draftContext) =>
    draftContext.IsAdmin ? null : Results.StatusCode(StatusCodes.Status403Forbidden);

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

static async Task<PlayerStatsResponse?> GetPlayerStats(int matchId, IReadOnlyList<string> playerNames, IHttpClientFactory httpClientFactory, CancellationToken cancellationToken)
{
    var scraper = httpClientFactory.CreateClient("WorldCupScraper");
    using var httpResponse = await scraper.PostAsJsonAsync(
        $"api/world-cup-2026/games/{matchId}/player-stats",
        new PlayerStatsRequest(playerNames),
        AppJson.Options,
        cancellationToken);

    if (httpResponse.StatusCode == HttpStatusCode.NotFound)
    {
        return null;
    }

    httpResponse.EnsureSuccessStatusCode();
    return await httpResponse.Content.ReadFromJsonAsync<PlayerStatsResponse>(AppJson.Options, cancellationToken);
}

static async Task<LiveMatchResult> GetLiveMatch(string passkey, int matchId, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken)
{
    var draftContext = await GetDraftContext(passkey, matchId, httpClientFactory, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return new LiveMatchResult(null, draftContext.Error);
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null || !IsDraftComplete(draft))
    {
        return new LiveMatchResult(null, Results.BadRequest(new DraftPickErrorResponse("Match has not started yet")));
    }

    var match = draftContext.Match!;
    var stats = await GetPlayerStats(matchId, draft.Picks.Select(pick => pick.PlayerName).ToArray(), httpClientFactory, cancellationToken);

    return new LiveMatchResult(ToLiveMatchResponse(match, draft, stats), null);
}

static async Task<MatchResponse?> GetMatch(int matchId, IHttpClientFactory httpClientFactory, CancellationToken cancellationToken)
{
    var matches = await GetMatches(httpClientFactory, includeLineups: true, cancellationToken);

    return matches.FirstOrDefault(match => match.Id == matchId);
}

static async Task<DraftContextResult> GetDraftContext(string passkey, int matchId, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken)
{
    var user = await GetUser(passkey, cache, cancellationToken);
    if (user is null)
    {
        return new DraftContextResult(null, false, null, Results.NotFound(new DraftPickErrorResponse("No access")));
    }

    var match = await GetMatch(matchId, httpClientFactory, cancellationToken);
    if (match is null)
    {
        return new DraftContextResult(user.Name, user.IsAdmin, null, Results.NotFound(new DraftPickErrorResponse("Match not found")));
    }

    return new DraftContextResult(user.Name, user.IsAdmin, match, null);
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

static DraftState NewOpenDraftState(IReadOnlyList<string> joinedUsers) => new(DraftStatuses.Open, joinedUsers, [], null, []);

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

    var draftTurnOrder = draft.DraftTurnOrder is { Count: > 0 }
        ? draft.DraftTurnOrder
        : CreateDraftTurnOrder(draftOrder, DraftOrderModes.RoundRobin);

    var normalized = draft with
    {
        Status = status,
        JoinedUsers = joinedUsers,
        DraftOrder = draftOrder,
        DraftTurnOrder = draftTurnOrder,
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

    return new DraftResponse(match, status, draft.JoinedUsers, draft.DraftOrder, draft.DraftTurnOrder ?? [], draft.Picks, currentTurn, isComplete);
}

static bool IsDraftComplete(DraftState draft)
{
    var totalTurnCount = DraftTurns(draft).Count;
    return totalTurnCount > 0 && draft.Picks.Count >= totalTurnCount;
}

static bool HasMatchStarted(MatchResponse match) => match.HasStarted || match.HasFinished;

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
    var turns = DraftTurns(draft);
    for (var pickOffset = 0; pickOffset < turns.Count; pickOffset++)
    {
        var turnIndex = draft.Picks.Count + pickOffset;
        if (turnIndex >= turns.Count)
        {
            return null;
        }

        var userName = turns[turnIndex];
        if (PickCountFor(draft, userName) < MaxPicksPerUser)
        {
            return userName;
        }
    }

    return null;
}

static IReadOnlyList<string> CreateRandomDraftOrder(IReadOnlyList<string> joinedUsers) =>
    joinedUsers.OrderBy(_ => Random.Shared.Next()).ToArray();

static IReadOnlyList<string> CreateDraftTurnOrder(IReadOnlyList<string> draftOrder, string? mode)
{
    if (draftOrder.Count == 0)
    {
        return [];
    }

    var normalizedMode = string.IsNullOrWhiteSpace(mode) ? DraftOrderModes.RoundRobin : mode;
    var turns = new List<string>(draftOrder.Count * MaxPicksPerUser);

    for (var round = 0; round < MaxPicksPerUser; round++)
    {
        var roundOrder = string.Equals(normalizedMode, DraftOrderModes.Abba, StringComparison.OrdinalIgnoreCase) && round % 2 == 1
            ? draftOrder.Reverse()
            : draftOrder;
        turns.AddRange(roundOrder);
    }

    return turns;
}

static IReadOnlyList<string> DraftTurns(DraftState draft) =>
    draft.DraftTurnOrder is { Count: > 0 } ? draft.DraftTurnOrder : CreateDraftTurnOrder(draft.DraftOrder, DraftOrderModes.RoundRobin);

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
        [],
        game.Status.Started,
        game.Status.Finished);
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
    match.HasStarted,
    match.HasFinished);

static LiveMatchResponse ToLiveMatchResponse(MatchResponse match, DraftState draft, PlayerStatsResponse? stats)
{
    var playersByName = stats?.Players.ToDictionary(player => player.Name, StringComparer.Ordinal) ?? [];
    var teamsByPlayerName = match.Lineups
        .SelectMany(lineup => lineup.Starters.Concat(lineup.Bench).Select(player => new { player.Name, lineup.TeamName }))
        .GroupBy(player => player.Name, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.First().TeamName, StringComparer.Ordinal);

    var squads = draft.Picks
        .GroupBy(pick => pick.UserName, StringComparer.Ordinal)
        .Select(group => new LiveSquadResponse(
            group.Key,
            group.Select(pick => ToLivePlayerResponse(pick.PlayerName, playersByName, teamsByPlayerName)).ToArray()))
        .ToArray();

    return new LiveMatchResponse(match, squads);
}

static LivePlayerResponse ToLivePlayerResponse(string playerName, IReadOnlyDictionary<string, PlayerStatsPlayerResponse> playersByName, IReadOnlyDictionary<string, string> teamsByPlayerName)
{
    if (playersByName.TryGetValue(playerName, out var statsPlayer))
    {
        return new LivePlayerResponse(playerName, statsPlayer.TeamName, statsPlayer.Categories);
    }

    return new LivePlayerResponse(playerName, teamsByPlayerName.GetValueOrDefault(playerName), []);
}

static LeagueUser[] SeededUsers() =>
[
    new("Alice", "alice-1111-1111-1111", true),
    new("Bob", "bob-2222-2222-2222", false),
    new("Carol", "carol-3333-3333-3333", false)
];
