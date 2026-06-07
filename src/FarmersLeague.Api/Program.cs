using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

var builder = WebApplication.CreateBuilder(args);
const int MaxPicksPerUser = 3;

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = AppJson.Options.PropertyNamingPolicy;
});

builder.Services.AddHttpClient("FootballApi", client =>
{
    var baseUrl = builder.Configuration["FootballApi:BaseUrl"] ?? "http://localhost:5081";
    client.BaseAddress = new Uri(baseUrl);
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

app.MapGet("/api/drafts/{matchId:int}", async (int matchId, IHttpClientFactory httpClientFactory, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var match = await GetMatch(matchId, httpClientFactory, cancellationToken);
    if (match is null)
    {
        return Results.NotFound();
    }

    var draft = await GetOrCreateDraft(matchId, cache, cancellationToken);

    return Results.Ok(ToDraftResponse(match, draft));
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

    var draft = await GetOrCreateDraft(matchId, cache, cancellationToken);
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

    var draft = await GetOrCreateDraft(matchId, cache, cancellationToken);

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

    await SaveDraft(matchId, updatedDraft, cache, cancellationToken);
    var updatedResponse = ToDraftResponse(match, updatedDraft);
    await liveDraftConnections.Broadcast(matchId, updatedResponse, cancellationToken);

    return Results.Ok(updatedResponse);
});

app.MapGet("/api/matches", async (IHttpClientFactory httpClientFactory, CancellationToken cancellationToken) =>
{
    var matches = await GetMatches(httpClientFactory, cancellationToken);

    return Results.Ok(matches);
});

app.MapDelete("/api/testing/drafts", async (IDistributedCache cache, CancellationToken cancellationToken) =>
{
    await cache.RemoveAsync(DraftCacheKey(1001), cancellationToken);

    return Results.NoContent();
});

app.MapPut("/api/testing/drafts/{matchId:int}", async (int matchId, DraftState draft, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    await SaveDraft(matchId, draft, cache, cancellationToken);

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

static async Task<IReadOnlyList<MatchResponse>> GetMatches(IHttpClientFactory httpClientFactory, CancellationToken cancellationToken)
{
    var footballApi = httpClientFactory.CreateClient("FootballApi");
    var fixtures = await footballApi.GetFromJsonAsync<ApiFootballFixturesResponse>(
        "/v3/fixtures?league=1&season=2026",
        cancellationToken);

    return fixtures?.Response.Select(ToMatchResponse).ToArray() ?? [];
}

static async Task<MatchResponse?> GetMatch(int matchId, IHttpClientFactory httpClientFactory, CancellationToken cancellationToken)
{
    var matches = await GetMatches(httpClientFactory, cancellationToken);

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

static async Task<DraftState> GetOrCreateDraft(int matchId, IDistributedCache cache, CancellationToken cancellationToken)
{
    var cachedDraft = await cache.GetStringAsync(DraftCacheKey(matchId), cancellationToken);
    if (cachedDraft is not null)
    {
        return JsonSerializer.Deserialize<DraftState>(cachedDraft, AppJson.Options) ?? NewDraftState();
    }

    var draft = NewDraftState();
    await SaveDraft(matchId, draft, cache, cancellationToken);

    return draft;
}

static DraftState NewDraftState()
{
    var draftOrder = SeededUsers().Select(user => user.Name).OrderBy(_ => Random.Shared.Next()).ToArray();

    return new DraftState(draftOrder, []);
}

static Task SaveDraft(int matchId, DraftState draft, IDistributedCache cache, CancellationToken cancellationToken) =>
    cache.SetStringAsync(DraftCacheKey(matchId), JsonSerializer.Serialize(draft, AppJson.Options), cancellationToken);

static DraftResponse ToDraftResponse(MatchResponse match, DraftState draft)
{
    var isComplete = IsDraftComplete(draft);
    var currentTurn = isComplete ? null : GetCurrentTurn(draft);

    return new DraftResponse(match, draft.DraftOrder, draft.Picks, currentTurn, isComplete);
}

static bool IsDraftComplete(DraftState draft) => draft.Picks.Count >= draft.DraftOrder.Count * MaxPicksPerUser;

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

static MatchResponse ToMatchResponse(ApiFootballFixtureItem fixture) => new(
    fixture.Fixture.Id,
    fixture.Teams.Home.Name,
    fixture.Teams.Away.Name,
    fixture.League.Name,
    fixture.Fixture.Date,
    fixture.Lineups.Select(ToLineupResponse).ToArray());

static LineupResponse ToLineupResponse(ApiFootballLineup lineup) => new(
    lineup.Team.Name,
    lineup.Formation,
    lineup.StartXI.Select(ToStarterResponse).ToArray());

static StarterResponse ToStarterResponse(ApiFootballStarter starter)
{
    var (gridRow, gridColumn) = ParseGrid(starter.Player.Grid);

    return new StarterResponse(
        starter.Player.Name,
        starter.Player.Number,
        starter.Player.Pos,
        starter.Player.Grid,
        gridRow,
        gridColumn);
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

static TestUser[] SeededUsers() =>
[
    new("Alice", "11111111-1111-1111-1111-111111111111"),
    new("Bob", "22222222-2222-2222-2222-222222222222")
];

record HelloResponse(string Message);

record AccessResponse(bool HasAccess, string? UserName);

record TestUser(string Name, string Passkey);

record DraftState(IReadOnlyList<string> DraftOrder, IReadOnlyList<DraftPick> Picks);

record DraftPick(string UserName, string PlayerName);

record DraftPickRequest(string Passkey, string PlayerName);

record DraftPickErrorResponse(string Message);

record DraftContextResult(string? UserName, MatchResponse? Match, IResult? Error);

record DraftResponse(MatchResponse Match, IReadOnlyList<string> DraftOrder, IReadOnlyList<DraftPick> Picks, string? CurrentTurn, bool IsComplete);

record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups);

record LineupResponse(string TeamName, string Formation, IReadOnlyList<StarterResponse> Starters);

record StarterResponse(string Name, int? Number, string? Position, string? Grid, int? GridRow, int? GridColumn);

record ApiFootballFixturesResponse(IReadOnlyList<ApiFootballFixtureItem> Response);

record ApiFootballFixtureItem(ApiFootballFixture Fixture, ApiFootballLeague League, ApiFootballTeams Teams, IReadOnlyList<ApiFootballLineup> Lineups);

record ApiFootballFixture(int Id, DateTimeOffset Date);

record ApiFootballLeague(string Name);

record ApiFootballTeams(ApiFootballTeam Home, ApiFootballTeam Away);

record ApiFootballTeam(string Name);

record ApiFootballLineup(ApiFootballTeam Team, string Formation, IReadOnlyList<ApiFootballStarter> StartXI);

record ApiFootballStarter(ApiFootballPlayer Player);

record ApiFootballPlayer(string Name, int? Number, string? Pos, string? Grid);

class LiveDraftConnections
{
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<WebSocket, byte>> socketsByMatch = [];

    public void Add(int matchId, WebSocket socket)
    {
        var sockets = socketsByMatch.GetOrAdd(matchId, _ => []);
        sockets.TryAdd(socket, 0);
    }

    public void Remove(int matchId, WebSocket socket)
    {
        if (socketsByMatch.TryGetValue(matchId, out var sockets))
        {
            sockets.TryRemove(socket, out _);
        }
    }

    public async Task Broadcast(int matchId, DraftResponse draft, CancellationToken cancellationToken)
    {
        if (!socketsByMatch.TryGetValue(matchId, out var sockets))
        {
            return;
        }

        foreach (var socket in sockets.Keys)
        {
            await Send(socket, draft, cancellationToken);
        }
    }

    public async Task Send(WebSocket socket, DraftResponse draft, CancellationToken cancellationToken)
    {
        if (socket.State != WebSocketState.Open)
        {
            return;
        }

        var payload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(draft, AppJson.Options));
        await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
    }
}

static class AppJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
