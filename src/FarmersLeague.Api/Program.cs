using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

var builder = WebApplication.CreateBuilder(args);
const int MaxPicksPerUser = DraftRules.MaxPicksPerUser;

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = AppJson.Options.PropertyNamingPolicy;
});

builder.Services.AddHttpClient("FotMob", client =>
{
    var baseUrl = builder.Configuration["FotMob:BaseUrl"] ?? "https://www.fotmob.com";
    client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : $"{baseUrl}/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36");
    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
    client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en-US,en;q=0.9");
});
builder.Services.AddSingleton<IWorldCupScraper, FotMobWorldCupScraper>();
builder.Services.AddHostedService<HomeMatchesCacheHydrationService>();

builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration["Redis:ConnectionString"] ?? "localhost:6379";
    options.InstanceName = "FarmersLeague:";
});
builder.Services.AddSingleton<LiveDraftConnections>();
builder.Services.AddSingleton<LiveMatchTrackers>();
builder.Services.AddHostedService(sp => new CompletedLiveMatchFinalizationHostedService(
    sp,
    async (services, cancellationToken) =>
    {
        using var scope = services.CreateScope();
        await FinalizeCompletedLiveMatches(
            scope.ServiceProvider.GetRequiredService<IWorldCupScraper>(),
            scope.ServiceProvider.GetRequiredService<IDistributedCache>(),
            scope.ServiceProvider.GetRequiredService<ILogger<Program>>(),
            cancellationToken);
    },
    sp.GetRequiredService<IConfiguration>(),
    sp.GetRequiredService<ILogger<CompletedLiveMatchFinalizationHostedService>>()));

var app = builder.Build();

await SeedLocalUsers(app.Services);

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseWebSockets();

app.MapGet("/api/hello", () => new HelloResponse("Hello from FarmersLeague API"));

app.MapGet("/api/live-scoring/rules", () => LiveScoringConfig.PointMultipliers
    .Select(entry => new LiveScoringRuleResponse(entry.Key, LiveScoringRuleLabel(entry.Key), entry.Value))
    .OrderByDescending(rule => rule.Points != 0)
    .ThenBy(rule => rule.Label, StringComparer.Ordinal)
    .ToArray());

app.MapGet("/api/access/{passkey}", async (string passkey, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var user = await GetUser(passkey, cache, cancellationToken);

    return user is null
        ? Results.NotFound(new AccessResponse(false, null, false))
        : Results.Ok(new AccessResponse(true, user.Name, user.IsAdmin));
});

app.MapGet("/api/drafts/{matchId:int}", async (int matchId, string? passkey, IWorldCupScraper scraper, IDistributedCache cache, ILogger<Program> logger, CancellationToken cancellationToken) =>
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

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null)
    {
        if (!user.IsAdmin)
        {
            return Results.NotFound(new DraftPickErrorResponse("Draft not found"));
        }

        draft = NewOpenDraftState([user.Name]);
        await SaveDraft(matchId, draft, cache, cancellationToken);
    }

    var match = await GetMatch(matchId, draft, user.IsAdmin, true, scraper, cache, logger, cancellationToken);
    if (match is null)
    {
        return Results.NotFound();
    }

    return Results.Ok(ToDraftResponse(match, draft));
});

app.MapPost("/api/drafts/{matchId:int}", async (int matchId, DraftAccessRequest request, IWorldCupScraper scraper, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftMetadataContext(request.Passkey, matchId, scraper, cache, cancellationToken);
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

app.MapPost("/api/drafts/{matchId:int}/join", async (int matchId, DraftAccessRequest request, IWorldCupScraper scraper, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetUpcomingDraftMetadataContext(request.Passkey, matchId, scraper, cache, cancellationToken);
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

app.MapPost("/api/drafts/{matchId:int}/start", async (int matchId, DraftStartRequest request, IWorldCupScraper scraper, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftMetadataContext(request.Passkey, matchId, scraper, cache, cancellationToken);
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

    var cachedLineups = await GetCachedLineups(matchId, cache, cancellationToken);
    if (!HasConfirmedStartingLineups(cachedLineups))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Starting lineups are not confirmed"));
    }

    var match = draftContext.Match! with { Lineups = cachedLineups };

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
        DraftTurnOrder = DraftRules.CreateTurnOrder(randomizedDraftOrder, request.DraftOrderMode),
        Picks = []
    };
    var response = await SaveAndBroadcastDraft(matchId, match, draft, cache, liveDraftConnections, cancellationToken);

    return Results.Ok(response);
});

app.MapDelete("/api/drafts/{matchId:int}", async (int matchId, string passkey, IWorldCupScraper scraper, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftMetadataContext(passkey, matchId, scraper, cache, cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }

    if (RequireAdmin(draftContext) is { } forbidden)
    {
        return forbidden;
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is not null && DraftRules.IsComplete(draft))
    {
        return Results.BadRequest(new DraftPickErrorResponse("Draft complete"));
    }

    await RemoveDraft(matchId, cache, cancellationToken);
    await liveDraftConnections.Broadcast(matchId, ToDraftUpdateMessage(NewOpenDraftState([draftContext.UserName!])), cancellationToken);

    return Results.NoContent();
});

app.MapGet("/api/drafts/{matchId:int}/live", async (int matchId, HttpContext context, IWorldCupScraper scraper, IDistributedCache cache, LiveDraftConnections liveDraftConnections, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        return Results.BadRequest(new DraftPickErrorResponse("Live draft updates require a WebSocket connection"));
    }

    var draftContext = await GetDraftContext(
        context.Request.Query["passkey"].ToString(),
        matchId,
        scraper,
        cache,
        logger,
        false,
        cancellationToken);
    if (draftContext.Error is not null)
    {
        return draftContext.Error;
    }
    var match = draftContext.Match!;

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    liveDraftConnections.Add(matchId, socket, draftContext.UserName!, draftContext.IsAdmin);

    var draft = await GetDraft(matchId, cache, cancellationToken) ?? NewOpenDraftState([]);
    await liveDraftConnections.Send(socket, ToDraftUpdateMessage(draft), cancellationToken);

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

app.MapPost("/api/drafts/{matchId:int}/picks", async (int matchId, DraftPickRequest request, IWorldCupScraper scraper, IDistributedCache cache, LiveDraftConnections liveDraftConnections, LiveMatchTrackers liveMatchTrackers, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    var draftContext = await GetDraftContext(request.Passkey, matchId, scraper, cache, logger, false, cancellationToken);
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

    if (DraftRules.IsComplete(draft))
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

    if (DraftRules.IsComplete(updatedDraft) && HasMatchStarted(match))
    {
        await RemoveDraft(matchId, cache, cancellationToken);
        await liveDraftConnections.Broadcast(matchId, ToDraftUpdateMessage(NewOpenDraftState([])), cancellationToken);

        return Results.BadRequest(new DraftPickErrorResponse("Live match cannot be created since the actual match has started"));
    }

    var updatedResponse = await SaveAndBroadcastDraft(matchId, match, updatedDraft, cache, liveDraftConnections, cancellationToken);
    if (DraftRules.IsComplete(updatedDraft))
    {
        StartLiveMatchTracker(matchId, ToLiveMatchResponse(updatedResponse.Match, updatedDraft, null), scraper, cache, liveMatchTrackers, logger);
    }

    return Results.Ok(updatedResponse);
});

app.MapGet("/api/matches/{matchId:int}/live", async (int matchId, string passkey, IWorldCupScraper scraper, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    var liveMatch = await GetInitialLiveMatch(passkey, matchId, scraper, cache, liveMatchTrackers, logger, cancellationToken);
    if (liveMatch.Error is not null)
    {
        return liveMatch.Error;
    }

    return Results.Ok(liveMatch.LiveMatch);
});

app.MapGet("/api/matches/{matchId:int}/live/updates", async (int matchId, HttpContext context, IWorldCupScraper scraper, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        return Results.BadRequest(new DraftPickErrorResponse("Live match updates require a WebSocket connection"));
    }

    var passkey = context.Request.Query["passkey"].ToString();
    var initialLiveMatch = await GetInitialLiveMatch(passkey, matchId, scraper, cache, liveMatchTrackers, logger, cancellationToken);
    if (initialLiveMatch.Error is not null)
    {
        return initialLiveMatch.Error;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await liveMatchTrackers.Subscribe(matchId, socket, cancellationToken);

    while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
    {
        var buffer = new byte[1024];
        var message = await socket.ReceiveAsync(buffer, cancellationToken);
        if (message.MessageType == WebSocketMessageType.Close)
        {
            break;
        }
    }

    liveMatchTrackers.Unsubscribe(matchId, socket);

    return Results.Empty;
});

app.MapGet("/api/matches", async (IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var matches = await HomeMatchesCache.GetOrHydrate(cache, scraper, cancellationToken);

    return Results.Ok(matches.Select(ToCachedHomeMatchResponse).ToArray());
});

app.MapDelete("/api/testing/drafts", async (IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, CancellationToken cancellationToken) =>
{
    await RemoveDraft(1001, cache, cancellationToken);
    liveMatchTrackers.Remove(1001);

    return Results.NoContent();
});

app.MapDelete("/api/testing/drafts/{matchId:int}", async (int matchId, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, CancellationToken cancellationToken) =>
{
    await RemoveDraft(matchId, cache, cancellationToken);
    liveMatchTrackers.Remove(matchId);

    return Results.NoContent();
});

app.MapPost("/api/testing/world-cup-2026/games/reset", async (IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    FotMobWorldCupScraper.ResetMockGameStatus();
    await HomeMatchesCache.Hydrate(cache, scraper, cancellationToken);

    return Results.NoContent();
});

app.MapPut("/api/testing/world-cup-2026/games/{gameId}/status", async (string gameId, TestingGameStatusRequest request, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    if (!FotMobWorldCupScraper.SetMockGameStatus(gameId, request.Started, request.Finished, request.Score))
    {
        return Results.NotFound(new { title = "Mock game not found" });
    }

    await HomeMatchesCache.Hydrate(cache, scraper, cancellationToken);

    return Results.NoContent();
});

app.MapPut("/api/testing/world-cup-2026/games/{gameId}/live-status", (string gameId, TestingGameStatusRequest request) =>
{
    if (!FotMobWorldCupScraper.SetMockGameStatus(gameId, request.Started, request.Finished, request.Score))
    {
        return Results.NotFound(new { title = "Mock game not found" });
    }

    return Results.NoContent();
});

app.MapGet("/api/testing/live-matches/{matchId:int}/completed", async (int matchId, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var completed = await GetCompletedLiveMatch(matchId, cache, cancellationToken);

    return completed is null ? Results.NotFound() : Results.Ok(completed);
});

app.MapPut("/api/testing/live-matches/{matchId:int}/completed", async (int matchId, CompletedLiveMatchResult completed, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, CancellationToken cancellationToken) =>
{
    await SaveCompletedLiveMatch(matchId, completed, cache, cancellationToken);
    liveMatchTrackers.Remove(matchId);

    return Results.NoContent();
});

app.MapDelete("/api/testing/live-matches/{matchId:int}/completed", async (int matchId, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, CancellationToken cancellationToken) =>
{
    await cache.RemoveAsync(CompletedLiveMatchCacheKey(matchId), cancellationToken);
    liveMatchTrackers.Remove(matchId);

    return Results.NoContent();
});

app.MapPost("/api/testing/live-matches/finalize-completed", async (IWorldCupScraper scraper, IDistributedCache cache, ILogger<Program> logger, CancellationToken cancellationToken) =>
{
    await FinalizeCompletedLiveMatches(scraper, cache, logger, cancellationToken);

    return Results.NoContent();
});

app.MapPut("/api/testing/drafts/{matchId:int}", async (int matchId, DraftState draft, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, CancellationToken cancellationToken) =>
{
    await SaveDraft(matchId, DraftRules.Normalize(draft), cache, cancellationToken);
    liveMatchTrackers.Remove(matchId);

    return Results.NoContent();
});

app.MapFallbackToFile("index.html");

app.Run();

static async Task SeedLocalUsers(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var cache = scope.ServiceProvider.GetRequiredService<IDistributedCache>();
    var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
    var includeTestUsers = bool.TryParse(configuration["SeedTestUsers"], out var seedTestUsers) && seedTestUsers;

    foreach (var user in SeededUsers(includeTestUsers))
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

static string CompletedLiveMatchCacheKey(int matchId) => $"live-matches:{matchId}:completed";

static string ConfirmedLineupsCacheKey(int matchId) => $"matches:{matchId}:lineups";

static async Task<IReadOnlyList<LineupResponse>> GetCachedLineups(int matchId, IDistributedCache cache, CancellationToken cancellationToken)
{
    var cachedLineups = await cache.GetStringAsync(ConfirmedLineupsCacheKey(matchId), cancellationToken);

    return cachedLineups is null
        ? []
        : JsonSerializer.Deserialize<IReadOnlyList<LineupResponse>>(cachedLineups, AppJson.Options) ?? [];
}

static Task SaveConfirmedLineups(int matchId, IReadOnlyList<LineupResponse> lineups, IDistributedCache cache, CancellationToken cancellationToken) =>
    cache.SetStringAsync(ConfirmedLineupsCacheKey(matchId), JsonSerializer.Serialize(lineups, AppJson.Options), cancellationToken);

static async Task<IReadOnlyList<LineupResponse>> GetScraperLineups(IWorldCupScraper scraper, string gameId, CancellationToken cancellationToken)
{
    var response = await scraper.GetLineup(gameId, cancellationToken);
    if (response is null)
    {
        return [];
    }

    return [ToScraperLineupResponse(response.HomeTeam), ToScraperLineupResponse(response.AwayTeam)];
}

static async Task<IReadOnlyList<LineupResponse>> GetAdminOpenDraftLineups(int matchId, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken)
{
    var lineups = await GetScraperLineups(scraper, matchId.ToString(), cancellationToken);
    if (HasConfirmedStartingLineups(lineups))
    {
        await SaveConfirmedLineups(matchId, lineups, cache, cancellationToken);
    }

    return lineups;
}

static async Task<IReadOnlyList<LineupResponse>> GetStartedDraftLineups(int matchId, string draftStatus, IWorldCupScraper scraper, IDistributedCache cache, ILogger logger, CancellationToken cancellationToken)
{
    var cachedLineups = await GetCachedLineups(matchId, cache, cancellationToken);
    if (HasConfirmedStartingLineups(cachedLineups))
    {
        return cachedLineups;
    }

    logger.LogError("Confirmed lineup cache missing for {DraftStatus} draft {MatchId}; attempting scraper recovery", draftStatus, matchId);

    var recoveredLineups = await GetScraperLineups(scraper, matchId.ToString(), cancellationToken);
    if (HasConfirmedStartingLineups(recoveredLineups))
    {
        await SaveConfirmedLineups(matchId, recoveredLineups, cache, cancellationToken);
        return recoveredLineups;
    }

    logger.LogError("Confirmed lineup cache recovery failed for {DraftStatus} draft {MatchId}", draftStatus, matchId);

    return [];
}

static async Task<PlayerStatsResponse?> GetPlayerStats(int matchId, IReadOnlyList<string> playerNames, IWorldCupScraper scraper, CancellationToken cancellationToken)
{
    var response = await scraper.GetPlayerStats(matchId.ToString(), playerNames, cancellationToken);

    return response is null ? null : ToPlayerStatsResponse(response);
}

static async Task<CompletedLiveMatchResult?> GetCompletedLiveMatch(int matchId, IDistributedCache cache, CancellationToken cancellationToken)
{
    var cachedCompleted = await cache.GetStringAsync(CompletedLiveMatchCacheKey(matchId), cancellationToken);

    return cachedCompleted is null
        ? null
        : JsonSerializer.Deserialize<CompletedLiveMatchResult>(cachedCompleted, AppJson.Options);
}

static Task SaveCompletedLiveMatch(int matchId, CompletedLiveMatchResult completed, IDistributedCache cache, CancellationToken cancellationToken) =>
    cache.SetStringAsync(CompletedLiveMatchCacheKey(matchId), JsonSerializer.Serialize(completed, AppJson.Options), cancellationToken);

static async Task<LiveMatchResult> GetInitialLiveMatch(string passkey, int matchId, IWorldCupScraper scraper, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, ILogger logger, CancellationToken cancellationToken)
{
    var draftContext = await GetDraftContext(passkey, matchId, scraper, cache, logger, false, cancellationToken);
    if (draftContext.Error is not null)
    {
        return new LiveMatchResult(null, draftContext.Error);
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null || !DraftRules.IsComplete(draft))
    {
        return new LiveMatchResult(null, Results.BadRequest(new DraftPickErrorResponse("Match has not started yet")));
    }

    if (liveMatchTrackers.TryGetCurrent(matchId, out var current))
    {
        return new LiveMatchResult(current, null);
    }

    var match = draftContext.Match!;
    var completedLiveMatch = await GetCompletedOrFinalizedLiveMatchResponse(match, draft, scraper, cache, cancellationToken);
    if (completedLiveMatch is not null)
    {
        return new LiveMatchResult(completedLiveMatch, null);
    }

    var initialState = ToLiveMatchResponse(match, draft, null);
    StartLiveMatchTracker(matchId, initialState, scraper, cache, liveMatchTrackers, logger);

    return new LiveMatchResult(initialState, null);
}

static void StartLiveMatchTracker(int matchId, LiveMatchResponse initialState, IWorldCupScraper scraper, IDistributedCache cache, LiveMatchTrackers liveMatchTrackers, ILogger logger)
{
    liveMatchTrackers.Start(
        matchId,
        initialState,
        cancellationToken => GetTrackableLiveMatch(matchId, scraper, cache, logger, cancellationToken),
        logger);
}

static async Task<LiveMatchResponse?> GetTrackableLiveMatch(int matchId, IWorldCupScraper scraper, IDistributedCache cache, ILogger logger, CancellationToken cancellationToken)
{
    var draft = await GetDraft(matchId, cache, cancellationToken);
    if (draft is null || !DraftRules.IsComplete(draft))
    {
        return null;
    }

    var match = await GetMatch(matchId, draft, false, false, scraper, cache, logger, cancellationToken);
    if (match is null)
    {
        return null;
    }

    var completedLiveMatch = await GetCompletedOrFinalizedLiveMatchResponse(match, draft, scraper, cache, cancellationToken);
    if (completedLiveMatch is not null)
    {
        return completedLiveMatch;
    }

    var stats = await GetPlayerStats(matchId, draft.Picks.Select(pick => pick.PlayerName).ToArray(), scraper, cancellationToken);
    if (IsFullTime(stats?.Status))
    {
        var finalMatch = match with
        {
            HasStarted = true,
            HasFinished = true,
            Score = stats?.Status?.Score ?? match.Score
        };
        var completed = await FinalizeCompletedLiveMatch(finalMatch, draft, scraper, cache, cancellationToken);

        return ToCompletedLiveMatchResponse(finalMatch, draft, completed);
    }

    return ToLiveMatchResponse(match, draft, stats);
}

static async Task<LiveMatchResponse?> GetCompletedOrFinalizedLiveMatchResponse(MatchResponse match, DraftState draft, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken)
{
    var completed = await GetCompletedLiveMatch(match.Id, cache, cancellationToken);
    if (completed is not null)
    {
        return ToCompletedLiveMatchResponse(match, draft, completed);
    }

    if (!match.HasFinished)
    {
        return null;
    }

    completed = await FinalizeCompletedLiveMatch(match, draft, scraper, cache, cancellationToken);

    return ToCompletedLiveMatchResponse(match, draft, completed);
}

static async Task<CompletedLiveMatchResult> FinalizeCompletedLiveMatch(MatchResponse match, DraftState draft, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken)
{
    var existing = await GetCompletedLiveMatch(match.Id, cache, cancellationToken);
    if (existing is not null)
    {
        return existing;
    }

    var allPlayerNames = AllLineupPlayers(match)
        .Select(player => player.Name)
        .Distinct(StringComparer.Ordinal)
        .ToArray();
    var allStats = await GetPlayerStats(match.Id, allPlayerNames, scraper, cancellationToken)
        ?? new PlayerStatsResponse(match.Id.ToString(), [], allPlayerNames, []);
    var pointsConfig = LiveScoringConfig.PointMultipliers.ToDictionary(entry => entry.Key, entry => entry.Value, StringComparer.Ordinal);
    var draftedPlayerNames = draft.Picks.Select(pick => pick.PlayerName).ToHashSet(StringComparer.Ordinal);
    var draftedByPlayerName = draft.Picks
        .GroupBy(pick => pick.PlayerName, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.First().UserName, StringComparer.Ordinal);
    var draftedStats = allStats.Players
        .Where(player => draftedPlayerNames.Contains(player.Name))
        .ToArray();
    var statsByPlayerName = draftedStats.ToDictionary(player => player.Name, StringComparer.Ordinal);
    var squads = draft.Picks
        .GroupBy(pick => pick.UserName, StringComparer.Ordinal)
        .Select(group => new LiveSquadFinalScoreResponse(
            group.Key,
            group.Sum(pick => statsByPlayerName.TryGetValue(pick.PlayerName, out var player) ? LivePlayerPoints(player, pointsConfig) : 0)))
        .ToArray();
    var winningScore = squads.Length == 0 ? 0 : squads.Max(squad => squad.TotalPoints);
    var winners = squads
        .Where(squad => squad.TotalPoints == winningScore)
        .Select(squad => squad.UserName)
        .ToArray();
    var completed = new CompletedLiveMatchResult(
        match,
        winners,
        squads,
        draftedStats,
        allStats.Players.Select(player => ToArchivedPlayerStats(player, draftedByPlayerName, pointsConfig)).ToArray(),
        pointsConfig,
        DateTimeOffset.UtcNow);

    await SaveCompletedLiveMatch(match.Id, completed, cache, cancellationToken);

    return completed;
}

static async Task FinalizeCompletedLiveMatches(IWorldCupScraper scraper, IDistributedCache cache, ILogger logger, CancellationToken cancellationToken)
{
    var matches = await HomeMatchesCache.GetOrHydrate(cache, scraper, cancellationToken);
    foreach (var cachedMatch in matches)
    {
        if (!cachedMatch.HasStarted || !cachedMatch.HasFinished || cachedMatch.Draft is null)
        {
            continue;
        }

        var draft = DraftRules.Normalize(cachedMatch.Draft);
        if (!DraftRules.IsComplete(draft))
        {
            continue;
        }

        if (await GetCompletedLiveMatch(cachedMatch.Id, cache, cancellationToken) is not null)
        {
            continue;
        }

        try
        {
            var cachedLineups = await GetStartedDraftLineups(cachedMatch.Id, draft.Status, scraper, cache, logger, cancellationToken);
            var match = ToMatchResponse(cachedMatch) with { Lineups = cachedLineups };
            await FinalizeCompletedLiveMatch(match, draft, scraper, cache, cancellationToken);
            logger.LogInformation("Completed live match {MatchId} finalized by background job", cachedMatch.Id);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Completed live match {MatchId} finalization failed", cachedMatch.Id);
        }
    }
}

static async Task<MatchResponse?> GetMatchMetadata(int matchId, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken)
{
    var cachedMatch = await HomeMatchesCache.GetMatch(cache, scraper, matchId, cancellationToken);
    if (cachedMatch is null)
    {
        return null;
    }

    return ToMatchResponse(cachedMatch);
}

static async Task<MatchResponse?> GetMatch(int matchId, DraftState? draft, bool isAdmin, bool allowAdminOpenLineupScrape, IWorldCupScraper scraper, IDistributedCache cache, ILogger logger, CancellationToken cancellationToken)
{
    var match = await GetMatchMetadata(matchId, scraper, cache, cancellationToken);
    if (match is null)
    {
        return null;
    }

    var normalizedDraft = DraftRules.Normalize(draft);
    var lineups = normalizedDraft.Status switch
    {
        DraftStatuses.Started or DraftStatuses.Completed => await GetStartedDraftLineups(matchId, normalizedDraft.Status, scraper, cache, logger, cancellationToken),
        DraftStatuses.Open when isAdmin && allowAdminOpenLineupScrape => await GetAdminOpenDraftLineups(matchId, scraper, cache, cancellationToken),
        _ => await GetCachedLineups(matchId, cache, cancellationToken)
    };

    return match with { Lineups = lineups };
}

static async Task<DraftContextResult> GetDraftMetadataContext(string passkey, int matchId, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken)
{
    var user = await GetUser(passkey, cache, cancellationToken);
    if (user is null)
    {
        return new DraftContextResult(null, false, null, Results.NotFound(new DraftPickErrorResponse("No access")));
    }

    var match = await GetMatchMetadata(matchId, scraper, cache, cancellationToken);
    if (match is null)
    {
        return new DraftContextResult(user.Name, user.IsAdmin, null, Results.NotFound(new DraftPickErrorResponse("Match not found")));
    }

    return new DraftContextResult(user.Name, user.IsAdmin, match, null);
}

static async Task<DraftContextResult> GetDraftContext(string passkey, int matchId, IWorldCupScraper scraper, IDistributedCache cache, ILogger logger, bool allowAdminOpenLineupScrape, CancellationToken cancellationToken)
{
    var metadataContext = await GetDraftMetadataContext(passkey, matchId, scraper, cache, cancellationToken);
    if (metadataContext.Error is not null)
    {
        return metadataContext;
    }

    var draft = await GetDraft(matchId, cache, cancellationToken);
    var match = await GetMatch(matchId, draft, metadataContext.IsAdmin, allowAdminOpenLineupScrape, scraper, cache, logger, cancellationToken);
    if (match is null)
    {
        return metadataContext with { Error = Results.NotFound(new DraftPickErrorResponse("Match not found")) };
    }

    return metadataContext with { Match = match };
}

static async Task<DraftContextResult> GetUpcomingDraftMetadataContext(string passkey, int matchId, IWorldCupScraper scraper, IDistributedCache cache, CancellationToken cancellationToken)
{
    var draftContext = await GetDraftMetadataContext(passkey, matchId, scraper, cache, cancellationToken);
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
    return await HomeMatchesCache.GetDraft(cache, matchId, cancellationToken);
}

static DraftState NewOpenDraftState(IReadOnlyList<string> joinedUsers) => new(DraftStatuses.Open, joinedUsers, [], null, []);

static Task SaveDraft(int matchId, DraftState draft, IDistributedCache cache, CancellationToken cancellationToken) =>
    HomeMatchesCache.SaveDraft(cache, matchId, draft, cancellationToken);

static Task RemoveDraft(int matchId, IDistributedCache cache, CancellationToken cancellationToken) =>
    HomeMatchesCache.RemoveDraft(cache, matchId, cancellationToken);

static async Task<DraftResponse> SaveAndBroadcastDraft(int matchId, MatchResponse match, DraftState draft, IDistributedCache cache, LiveDraftConnections liveDraftConnections, CancellationToken cancellationToken)
{
    await SaveDraft(matchId, draft, cache, cancellationToken);
    var cachedLineups = await GetCachedLineups(matchId, cache, cancellationToken);
    var response = ToDraftResponse(match with { Lineups = cachedLineups }, draft);
    await liveDraftConnections.Broadcast(matchId, ToDraftUpdateMessage(draft), cancellationToken);

    return response;
}

static DraftUpdateMessage ToDraftUpdateMessage(DraftState draft)
{
    var viewState = ToDraftViewState(draft);

    return new DraftUpdateMessage("draftUpdate", viewState.Status, viewState.Draft.JoinedUsers, viewState.Draft.DraftOrder, viewState.Draft.DraftTurnOrder ?? [], viewState.Draft.Picks, viewState.CurrentTurn, viewState.IsComplete);
}

static DraftResponse ToDraftResponse(MatchResponse match, DraftState draft)
{
    var viewState = ToDraftViewState(draft);

    return new DraftResponse(match, viewState.Status, viewState.Draft.JoinedUsers, viewState.Draft.DraftOrder, viewState.Draft.DraftTurnOrder ?? [], viewState.Draft.Picks, viewState.CurrentTurn, viewState.IsComplete);
}

static DraftViewState ToDraftViewState(DraftState draft)
{
    draft = DraftRules.Normalize(draft);
    var isComplete = DraftRules.IsComplete(draft);
    var status = isComplete ? DraftStatuses.Completed : draft.Status;
    var currentTurn = string.Equals(status, DraftStatuses.Started, StringComparison.Ordinal) && !isComplete ? GetCurrentTurn(draft) : null;

    return new DraftViewState(draft, status, currentTurn, isComplete);
}

static bool HasMatchStarted(MatchResponse match) => match.HasStarted || match.HasFinished;

static bool IsFullTime(PlayerStatsMatchStatusResponse? status) =>
    status?.Finished == true
    || string.Equals(status?.Reason?.Short, "FT", StringComparison.OrdinalIgnoreCase)
    || string.Equals(status?.Reason?.Long, "Full-Time", StringComparison.OrdinalIgnoreCase)
    || string.Equals(status?.Reason?.LongKey, "finished", StringComparison.OrdinalIgnoreCase);

static bool HasConfirmedStartingLineups(IReadOnlyList<LineupResponse> lineups) =>
    lineups.Count >= 2
    && lineups.All(lineup => WorldCupLineupRules.HasConfirmedStarters(lineup.Starters.Count));

static bool HasPlayerInMatch(MatchResponse match, string playerName) =>
    match.Lineups.SelectMany(lineup => lineup.Starters).Any(starter => string.Equals(starter.Name, playerName, StringComparison.Ordinal));

static bool IsPlayerDrafted(DraftState draft, string playerName) =>
    draft.Picks.Any(pick => string.Equals(pick.PlayerName, playerName, StringComparison.Ordinal));

static int PickCountFor(DraftState draft, string userName) =>
    draft.Picks.Count(pick => string.Equals(pick.UserName, userName, StringComparison.Ordinal));

static string? GetCurrentTurn(DraftState draft)
{
    var turns = DraftRules.Turns(draft);
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

static MatchResponse ToMatchResponse(CachedHomeMatch match) => new(
    match.Id,
    match.HomeTeam,
    match.AwayTeam,
    match.League,
    match.Date,
    [],
    match.HasStarted,
    match.HasFinished,
    match.Score);

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

static HomeMatchResponse ToCachedHomeMatchResponse(CachedHomeMatch match)
{
    var matchResponse = ToMatchResponse(match);

    return new HomeMatchResponse(
        match.Id,
        match.HomeTeam,
        match.AwayTeam,
        match.League,
        match.Date,
        [],
        match.Draft is null ? null : ToDraftResponse(matchResponse, match.Draft),
        match.HasStarted,
        match.HasFinished,
        match.Score);
}

static PlayerStatsResponse ToPlayerStatsResponse(WorldCupPlayerStatsResponse stats) => new(
    stats.GameId,
    stats.Players.Select(ToPlayerStatsPlayerResponse).ToArray(),
    stats.MissingPlayers,
    stats.Substitutions.Select(ToMatchSubstitutionResponse).ToArray(),
    stats.Status is null ? null : ToPlayerStatsMatchStatusResponse(stats.Status));

static MatchSubstitutionResponse ToMatchSubstitutionResponse(WorldCupMatchSubstitutionResponse substitution) => new(
    substitution.Minute,
    substitution.IsHome,
    substitution.PlayerOnId,
    substitution.PlayerOnName,
    substitution.PlayerOffId,
    substitution.PlayerOffName,
    substitution.InjuredPlayerOut);

static PlayerStatsMatchStatusResponse ToPlayerStatsMatchStatusResponse(WorldCupGameStatusResponse status) => new(
    status.Started,
    status.Finished,
    status.Score,
    status.Reason is null ? null : new PlayerStatsMatchStatusReasonResponse(status.Reason.Short, status.Reason.ShortKey, status.Reason.Long, status.Reason.LongKey),
    status.LiveTime);

static PlayerStatsPlayerResponse ToPlayerStatsPlayerResponse(WorldCupPlayerStatsPlayerResponse player) => new(
    player.Id,
    player.OptaId,
    player.Name,
    player.TeamId,
    player.TeamName,
    player.ShirtNumber,
    player.IsGoalkeeper,
    player.Categories.Select(ToPlayerStatCategoryResponse).ToArray());

static ArchivedPlayerStatsPlayerResponse ToArchivedPlayerStats(PlayerStatsPlayerResponse player, IReadOnlyDictionary<string, string> draftedByPlayerName, IReadOnlyDictionary<string, int> pointsConfig) => new(
    player.Id,
    player.OptaId,
    player.Name,
    player.TeamId,
    player.TeamName,
    player.ShirtNumber,
    player.IsGoalkeeper,
    player.Categories,
    draftedByPlayerName.GetValueOrDefault(player.Name),
    player.TeamName,
    player.Categories.SelectMany(category => category.Stats).ToArray(),
    LivePlayerPoints(player, pointsConfig));

static PlayerStatCategoryResponse ToPlayerStatCategoryResponse(WorldCupPlayerStatCategoryResponse category) => new(
    category.Key,
    category.Title,
    category.Stats.Select(ToPlayerStatResponse).ToArray());

static PlayerStatResponse ToPlayerStatResponse(WorldCupPlayerStatResponse stat) => new(
    stat.Key,
    stat.Label,
    stat.SourceGroup,
    stat.Value,
    stat.Total,
    stat.Type,
    CalculateLiveStatPoints(stat.Value, stat.Key, LiveScoringConfig.PointMultipliers));

static LiveMatchResponse ToCompletedLiveMatchResponse(MatchResponse match, DraftState draft, CompletedLiveMatchResult completed) =>
    ToLiveMatchResponse(match, draft, new PlayerStatsResponse(match.Id.ToString(), completed.DraftedPlayerStats, [], []), completed);

static LiveMatchResponse ToLiveMatchResponse(MatchResponse match, DraftState draft, PlayerStatsResponse? stats, CompletedLiveMatchResult? completed = null)
{
    match = stats?.Substitutions.Count > 0 ? WithSubstitutions(match, stats.Substitutions) : match;
    var playersByName = stats?.Players.ToDictionary(player => player.Name, StringComparer.Ordinal) ?? [];
    var substitutionsByPlayerName = stats?.Substitutions
        .GroupBy(substitution => substitution.PlayerOffName, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.OrderBy(substitution => substitution.Minute).First(), StringComparer.Ordinal) ?? [];
    var teamsByPlayerName = AllLineupPlayers(match)
        .GroupBy(player => player.Name, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.First().TeamName, StringComparer.Ordinal);
    var pointMultipliers = completed?.PointsConfig ?? LiveScoringConfig.PointMultipliers;

    var squads = draft.Picks
        .GroupBy(pick => pick.UserName, StringComparer.Ordinal)
        .Select(group => new LiveSquadResponse(
            group.Key,
            group.Select(pick => ToLivePlayerResponse(pick.PlayerName, playersByName, substitutionsByPlayerName, teamsByPlayerName, pointMultipliers)).ToArray()))
        .ToArray();

    var finalResult = completed is null
        ? null
        : new LiveMatchFinalResultResponse(completed.Winners, completed.Squads, completed.FinalizedAt);

    return new LiveMatchResponse(match, squads, finalResult);
}

static MatchResponse WithSubstitutions(MatchResponse match, IReadOnlyList<MatchSubstitutionResponse> substitutions)
{
    var substitutionsByPlayerName = substitutions
        .GroupBy(substitution => substitution.PlayerOffName, StringComparer.Ordinal)
        .ToDictionary(group => group.Key, group => group.OrderBy(substitution => substitution.Minute).First(), StringComparer.Ordinal);

    return match with
    {
        Lineups = match.Lineups.Select(lineup => lineup with
        {
            Starters = lineup.Starters.Select(starter => WithSubstitution(starter, substitutionsByPlayerName)).ToArray(),
            Bench = lineup.Bench.Select(starter => WithSubstitution(starter, substitutionsByPlayerName)).ToArray()
        }).ToArray()
    };
}

static StarterResponse WithSubstitution(StarterResponse player, IReadOnlyDictionary<string, MatchSubstitutionResponse> substitutionsByPlayerName) =>
    substitutionsByPlayerName.TryGetValue(player.Name, out var substitution)
        ? player with
        {
            IsSubbedOff = true,
            SubbedOffMinute = substitution.Minute,
            SubbedOnPlayerName = substitution.PlayerOnName,
            InjuredSubstitution = substitution.InjuredPlayerOut
        }
        : player;

static IEnumerable<(string Name, string TeamName)> AllLineupPlayers(MatchResponse match) =>
    match.Lineups.SelectMany(lineup => lineup.Starters.Concat(lineup.Bench).Select(player => (player.Name, lineup.TeamName)));

static LivePlayerResponse ToLivePlayerResponse(
    string playerName,
    IReadOnlyDictionary<string, PlayerStatsPlayerResponse> playersByName,
    IReadOnlyDictionary<string, MatchSubstitutionResponse> substitutionsByPlayerName,
    IReadOnlyDictionary<string, string> teamsByPlayerName,
    IReadOnlyDictionary<string, int> pointMultipliers)
{
    var substitution = substitutionsByPlayerName.TryGetValue(playerName, out var playerSubstitution)
        ? new LivePlayerSubstitutionResponse(playerSubstitution.Minute, playerSubstitution.PlayerOnName, playerSubstitution.InjuredPlayerOut)
        : null;

    if (playersByName.TryGetValue(playerName, out var statsPlayer))
    {
        return new LivePlayerResponse(playerName, statsPlayer.TeamName, WithStatPoints(statsPlayer.Categories, pointMultipliers), substitution);
    }

    return new LivePlayerResponse(playerName, teamsByPlayerName.GetValueOrDefault(playerName), [], substitution);
}

static IReadOnlyList<PlayerStatCategoryResponse> WithStatPoints(IReadOnlyList<PlayerStatCategoryResponse> categories, IReadOnlyDictionary<string, int> pointMultipliers) =>
    categories
        .Select(category => category with
        {
            Stats = category.Stats.Select(stat => stat with { Points = LiveStatPoints(stat, pointMultipliers) }).ToArray()
        })
        .ToArray();

static int LivePlayerPoints(PlayerStatsPlayerResponse player, IReadOnlyDictionary<string, int> pointMultipliers) =>
    player.Categories
        .SelectMany(category => category.Stats)
        .GroupBy(stat => stat.Key, StringComparer.Ordinal)
        .Select(group => group.First())
        .Sum(stat => LiveStatPoints(stat, pointMultipliers));

static int LiveStatPoints(PlayerStatResponse stat, IReadOnlyDictionary<string, int> pointMultipliers) =>
    CalculateLiveStatPoints(stat.Value, stat.Key, pointMultipliers);

static int CalculateLiveStatPoints(object? value, string statKey, IReadOnlyDictionary<string, int> pointMultipliers) =>
    NumericStatValue(value) * pointMultipliers.GetValueOrDefault(statKey, 0);

static string LiveScoringRuleLabel(string statKey) => statKey switch
{
    "goals" => "Goals",
    "expected_goals" => "Expected goals",
    "expected_goals_on_target_variant" => "Expected goals on target",
    "total_shots" => "Total shots",
    "ShotsOnTarget" => "Shots on target",
    "touches_opp_box" => "Touches in opposition box",
    "dribbles_succeeded" => "Successful dribbles",
    "big_chance_missed_title" => "Big chances missed",
    "touches" => "Touches",
    "accurate_passes" => "Accurate passes",
    "assists" => "Assists",
    "expected_assists" => "Expected assists",
    "chances_created" => "Chances created",
    "passes_into_final_third" => "Passes into final third",
    "accurate_crosses" => "Accurate crosses",
    "long_balls_accurate" => "Accurate long balls",
    "defensive_actions" => "Defensive actions",
    "matchstats.headers.tackles" => "Tackles",
    "shot_blocks" => "Shot blocks",
    "recoveries" => "Recoveries",
    "clearances" => "Clearances",
    "headed_clearance" => "Headed clearances",
    "interceptions" => "Interceptions",
    "dribbled_past" => "Dribbled past",
    "duel_won" => "Duels won",
    "duel_lost" => "Duels lost",
    "ground_duels_won" => "Ground duels won",
    "aerials_won" => "Aerial duels won",
    "fouls" => "Fouls",
    "was_fouled" => "Fouls won",
    "saves" => "Saves",
    "goals_conceded" => "Goals conceded",
    "expected_goals_on_target_faced" => "Expected goals on target faced",
    "goals_prevented" => "Goals prevented",
    "keeper_sweeper" => "Keeper sweeper actions",
    "keeper_high_claim" => "Keeper high claims",
    _ => statKey
};

static int NumericStatValue(object? value)
{
    if (value is null)
    {
        return 0;
    }

    if (value is JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Number => element.TryGetInt32(out var intValue) ? intValue : (int)Math.Round(element.GetDouble()),
            JsonValueKind.String => int.TryParse(element.GetString(), out var stringValue) ? stringValue : 0,
            _ => 0
        };
    }

    return value switch
    {
        int intValue => intValue,
        long longValue => (int)longValue,
        decimal decimalValue => (int)Math.Round(decimalValue),
        double doubleValue when double.IsFinite(doubleValue) => (int)Math.Round(doubleValue),
        float floatValue when float.IsFinite(floatValue) => (int)Math.Round(floatValue),
        string stringValue when int.TryParse(stringValue, out var parsed) => parsed,
        _ => 0
    };
}

static LeagueUser[] SeededUsers(bool includeTestUsers)
{
    var users = new List<LeagueUser>
    {
        new("Basim", "basim-e537-dc50-3bb8", true),
        new("Avi", "avi-79fa-1d3a-3460", false),
        new("Suyash", "suyash-1efa-61d5-4fb3", false),
        new("Mahlee", "mahlee-8cedeeb6-007f-4dd5", false)
    };

    if (includeTestUsers)
    {
        users.AddRange([
            new("Alice", "alice-1111-1111-1111", true),
            new("Bob", "bob-2222-2222-2222", false),
            new("Carol", "carol-3333-3333-3333", false)
        ]);
    }

    return users.ToArray();
}

class CompletedLiveMatchFinalizationHostedService(
    IServiceProvider services,
    Func<IServiceProvider, CancellationToken, Task> finalizeCompletedLiveMatches,
    IConfiguration configuration,
    ILogger<CompletedLiveMatchFinalizationHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(RefreshInterval(), stoppingToken);
                await finalizeCompletedLiveMatches(services, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Completed live match finalization background job failed");
            }
        }
    }

    private TimeSpan RefreshInterval()
    {
        var seconds = int.TryParse(configuration["CompletedLiveMatches:FinalizationIntervalSeconds"], out var configuredSeconds)
            ? configuredSeconds
            : 30;

        return TimeSpan.FromSeconds(Math.Clamp(seconds, 5, 3600));
    }
}
