using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
});

builder.Services.AddHttpClient("FotMob", client =>
{
    var baseUrl = builder.Configuration["FotMob:BaseUrl"] ?? "https://www.fotmob.com";
    client.BaseAddress = new Uri(baseUrl.EndsWith('/') ? baseUrl : $"{baseUrl}/");
    client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36");
    client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
    client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en-US,en;q=0.9");
});
builder.Services.AddSingleton<FotMobWorldCupScraper>();
builder.Services.AddSingleton<WorldCupGamesCache>();
builder.Services.AddHostedService<WorldCupGamesCacheHydrationService>();

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/world-cup-2026/games", async (WorldCupGamesCache gamesCache, CancellationToken cancellationToken) =>
{
    try
    {
        var games = await gamesCache.GetGames(cancellationToken);

        return Results.Ok(games);
    }
    catch (FotMobScrapeException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem($"FotMob request failed: {exception.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
    catch (JsonException exception)
    {
        return Results.Problem($"FotMob page data could not be parsed: {exception.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapGet("/api/world-cup-2026/games/{gameId}/lineups", async (string gameId, FotMobWorldCupScraper scraper, CancellationToken cancellationToken) =>
{
    try
    {
        var lineup = await scraper.GetLineup(gameId, cancellationToken);

        return lineup is null
            ? Results.NotFound(new { title = "Lineup is not available for this game" })
            : Results.Ok(lineup);
    }
    catch (FotMobScrapeException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem($"FotMob request failed: {exception.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
    catch (JsonException exception)
    {
        return Results.Problem($"FotMob page data could not be parsed: {exception.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/world-cup-2026/games/{gameId}/player-stats", async (string gameId, WorldCupPlayerStatsRequest request, FotMobWorldCupScraper scraper, CancellationToken cancellationToken) =>
{
    if (request.Players.Count == 0)
    {
        return Results.BadRequest(new { title = "At least one player name or identifier is required" });
    }

    try
    {
        var playerStats = await scraper.GetPlayerStats(gameId, request.Players, cancellationToken);

        return playerStats is null
            ? Results.NotFound(new { title = "Player stats are not available for this game" })
            : Results.Ok(playerStats);
    }
    catch (FotMobScrapeException exception)
    {
        return Results.Problem(exception.Message, statusCode: StatusCodes.Status502BadGateway);
    }
    catch (HttpRequestException exception)
    {
        return Results.Problem($"FotMob request failed: {exception.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
    catch (JsonException exception)
    {
        return Results.Problem($"FotMob page data could not be parsed: {exception.Message}", statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/testing/world-cup-2026/games/reset", async (WorldCupGamesCache gamesCache, CancellationToken cancellationToken) =>
{
    FotMobWorldCupScraper.ResetMockGameStatus();
    await gamesCache.TryHydrate("testing reset", force: true, cancellationToken);

    return Results.NoContent();
});

app.MapPut("/api/testing/world-cup-2026/games/{gameId}/status", async (string gameId, TestingGameStatusRequest request, WorldCupGamesCache gamesCache, CancellationToken cancellationToken) =>
{
    if (!FotMobWorldCupScraper.SetMockGameStatus(gameId, request.Started, request.Finished))
    {
        return Results.NotFound(new { title = "Mock game not found" });
    }

    await gamesCache.TryHydrate("testing status override", force: true, cancellationToken);

    return Results.NoContent();
});

app.Run();

record TestingGameStatusRequest(bool Started, bool Finished);

partial class FotMobWorldCupScraper(IHttpClientFactory httpClientFactory, IConfiguration configuration)
{
    private const string NextDataStart = "<script id=\"__NEXT_DATA__\" type=\"application/json\">";
    private const string ScriptEnd = "</script>";
    private int mockPlayerStatsStep;
    private static readonly PlayerStatCategoryDefinition[] PlayerStatCategories =
    [
        new("attack", "Attack", ["goals", "expected_goals", "expected_goals_on_target_variant", "total_shots", "ShotsOnTarget", "touches_opp_box", "dribbles_succeeded", "big_chance_missed_title"]),
        new("passes", "Passes", ["touches", "accurate_passes", "assists", "expected_assists", "chances_created", "passes_into_final_third", "accurate_crosses", "long_balls_accurate"]),
        new("defense", "Defense", ["defensive_actions", "matchstats.headers.tackles", "interceptions", "shot_blocks", "recoveries", "clearances", "headed_clearance", "dribbled_past"]),
        new("duels", "Duels", ["duel_won", "duel_lost", "ground_duels_won", "aerials_won", "fouls", "was_fouled", "dribbles_succeeded", "matchstats.headers.tackles"]),
        new("goalkeeping", "Goalkeeping", ["saves", "goals_conceded", "expected_goals_on_target_faced", "goals_prevented", "keeper_sweeper", "keeper_high_claim", "long_balls_accurate", "accurate_passes"])
    ];

    public async Task<IReadOnlyList<WorldCupGameResponse>> GetGames(CancellationToken cancellationToken)
    {
        if (UseMockMode())
        {
            return MockGames();
        }

        if (UseFixtureData())
        {
            return FixtureGames();
        }

        var matches = await GetFixtureMatches(cancellationToken);

        return matches
            .Select(match => match.Game)
            .OrderBy(game => game.StartTimeUtc)
            .ToArray();
    }

    public async Task<WorldCupLineupResponse?> GetLineup(string gameId, CancellationToken cancellationToken)
    {
        if (UseMockMode())
        {
            return string.Equals(gameId, MockGameId, StringComparison.Ordinal) ? MockLineup() : null;
        }

        if (UseFixtureData())
        {
            return string.Equals(gameId, FixtureGameId, StringComparison.Ordinal) ? FixtureLineup() : null;
        }

        var root = await GetMatchPageRoot(gameId, cancellationToken);
        if (root is null)
        {
            return null;
        }

        return TryGetLineup(root.Value, out var lineup) && IsConfirmedLineup(lineup)
            ? ToLineup(lineup)
            : null;
    }

    public async Task<WorldCupPlayerStatsResponse?> GetPlayerStats(string gameId, IReadOnlyList<string> requestedPlayers, CancellationToken cancellationToken)
    {
        if (UseMockMode())
        {
            return string.Equals(gameId, MockGameId, StringComparison.Ordinal)
                ? MockPlayerStats(gameId, requestedPlayers)
                : null;
        }

        if (UseFixtureData())
        {
            return new WorldCupPlayerStatsResponse(gameId, [], requestedPlayers);
        }

        var root = await GetMatchPageRoot(gameId, cancellationToken);
        if (root is null || !TryGetPlayerStats(root.Value, out var playerStats))
        {
            return null;
        }

        var players = playerStats
            .EnumerateObject()
            .Where(property => property.Value.ValueKind == JsonValueKind.Object)
            .Select(property => ToPlayerStatsPlayer(property.Value))
            .ToArray();

        return SelectRequestedPlayerStats(gameId, players, requestedPlayers);
    }

    private static WorldCupPlayerStatsResponse SelectRequestedPlayerStats(string gameId, IReadOnlyList<WorldCupPlayerStatsPlayerResponse> players, IReadOnlyList<string> requestedPlayers)
    {
        var foundPlayers = new List<WorldCupPlayerStatsPlayerResponse>();
        var missingPlayers = new List<string>();

        foreach (var requestedPlayer in requestedPlayers.Select(player => player.Trim()).Where(player => player.Length > 0))
        {
            var player = players.FirstOrDefault(player => PlayerMatches(player, requestedPlayer));
            if (player is null)
            {
                missingPlayers.Add(requestedPlayer);
                continue;
            }

            if (!foundPlayers.Any(foundPlayer => foundPlayer.Id == player.Id))
            {
                foundPlayers.Add(player);
            }
        }

        return new WorldCupPlayerStatsResponse(gameId, foundPlayers, missingPlayers);
    }

    private async Task<JsonElement?> GetMatchPageRoot(string gameId, CancellationToken cancellationToken)
    {
        var matches = await GetFixtureMatches(cancellationToken);
        var match = matches.FirstOrDefault(match => match.Game.Id == gameId);
        if (match is null)
        {
            return null;
        }

        var matchPath = match.PageUrl.Split('#', 2)[0];
        var client = httpClientFactory.CreateClient("FotMob");

        using var response = await client.GetAsync(matchPath, cancellationToken);
        response.EnsureSuccessStatusCode();

        var html = await response.Content.ReadAsStringAsync(cancellationToken);
        var nextDataJson = ExtractNextData(html);
        using var document = JsonDocument.Parse(nextDataJson);

        return document.RootElement.Clone();
    }

    private bool UseMockMode() => bool.TryParse(configuration["FotMob:MockMode"], out var mockMode) && mockMode;

    private bool UseFixtureData() => bool.TryParse(configuration["FotMob:UseFixtureData"], out var useFixtureData) && useFixtureData;

    private async Task<IReadOnlyList<FotMobFixtureMatch>> GetFixtureMatches(CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("FotMob");
        var fixturesPath = configuration["FotMob:WorldCup2026FixturesPath"]
            ?? "/leagues/77/fixtures/world-cup?group=by-date&page=0";

        using var response = await client.GetAsync(fixturesPath, cancellationToken);
        response.EnsureSuccessStatusCode();

        var html = await response.Content.ReadAsStringAsync(cancellationToken);
        var nextDataJson = ExtractNextData(html);
        using var document = JsonDocument.Parse(nextDataJson);
        var allMatches = GetAllMatches(document.RootElement);

        return allMatches
            .EnumerateArray()
            .Select(ToFixtureMatch)
            .ToArray();
    }

    private static string ExtractNextData(string html)
    {
        var start = html.IndexOf(NextDataStart, StringComparison.Ordinal);
        if (start < 0)
        {
            throw new FotMobScrapeException("FotMob page did not include __NEXT_DATA__");
        }

        start += NextDataStart.Length;
        var end = html.IndexOf(ScriptEnd, start, StringComparison.Ordinal);
        if (end < 0)
        {
            throw new FotMobScrapeException("FotMob __NEXT_DATA__ script was not closed");
        }

        return WebUtility.HtmlDecode(html[start..end]);
    }

    private static JsonElement GetAllMatches(JsonElement root)
    {
        if (!root.TryGetProperty("props", out var props)
            || !props.TryGetProperty("pageProps", out var pageProps)
            || !pageProps.TryGetProperty("fixtures", out var fixtures)
            || !fixtures.TryGetProperty("allMatches", out var allMatches)
            || allMatches.ValueKind != JsonValueKind.Array)
        {
            throw new FotMobScrapeException("FotMob page data did not include fixtures.allMatches");
        }

        return allMatches;
    }

    private static WorldCupGameResponse ToGame(JsonElement match)
    {
        var id = RequiredString(match, "id");
        var status = RequiredObject(match, "status");
        var startTimeUtc = DateTimeOffset.Parse(RequiredString(status, "utcTime"));

        return new WorldCupGameResponse(
            id,
            ToTeam(RequiredObject(match, "home")),
            ToTeam(RequiredObject(match, "away")),
            OptionalString(match, "group"),
            OptionalString(match, "round"),
            OptionalString(match, "roundName"),
            startTimeUtc,
            new WorldCupGameStatusResponse(
                OptionalBool(status, "started") ?? false,
                OptionalBool(status, "finished") ?? false,
                OptionalString(status, "scoreStr"),
                OptionalString(status, "reason"),
                OptionalString(status, "liveTime")));
    }

    private static FotMobFixtureMatch ToFixtureMatch(JsonElement match) => new(
        ToGame(match),
        RequiredString(match, "pageUrl"));

    private static bool TryGetLineup(JsonElement root, out JsonElement lineup)
    {
        lineup = default;

        return root.TryGetProperty("props", out var props)
            && props.TryGetProperty("pageProps", out var pageProps)
            && pageProps.TryGetProperty("content", out var content)
            && content.TryGetProperty("lineup", out lineup)
            && lineup.ValueKind == JsonValueKind.Object;
    }

    private static bool TryGetPlayerStats(JsonElement root, out JsonElement playerStats)
    {
        playerStats = default;

        return root.TryGetProperty("props", out var props)
            && props.TryGetProperty("pageProps", out var pageProps)
            && pageProps.TryGetProperty("content", out var content)
            && content.TryGetProperty("playerStats", out playerStats)
            && playerStats.ValueKind == JsonValueKind.Object;
    }

    private static WorldCupLineupResponse ToLineup(JsonElement lineup) => new(
        RequiredString(lineup, "matchId"),
        OptionalString(lineup, "lineupType"),
        OptionalString(lineup, "source"),
        ToLineupTeam(RequiredObject(lineup, "homeTeam")),
        ToLineupTeam(RequiredObject(lineup, "awayTeam")));

    private static bool IsConfirmedLineup(JsonElement lineup)
    {
        return string.Equals(OptionalString(lineup, "lineupType"), "confirmed", StringComparison.OrdinalIgnoreCase)
            && TryGetObject(lineup, "homeTeam", out var homeTeam)
            && TryGetObject(lineup, "awayTeam", out var awayTeam)
            && HasConfirmedTeamLineup(homeTeam)
            && HasConfirmedTeamLineup(awayTeam);
    }

    private static bool HasConfirmedTeamLineup(JsonElement team)
    {
        return TryGetArray(team, "starters", out var starters)
            && starters.GetArrayLength() == 11
            && TryGetArray(team, "subs", out var subs)
            && subs.GetArrayLength() > 0;
    }

    private static WorldCupLineupTeamResponse ToLineupTeam(JsonElement team) => new(
        RequiredString(team, "id"),
        RequiredString(team, "name"),
        OptionalString(team, "formation"),
        ToPlayers(RequiredArray(team, "starters"), includeFormationPosition: true),
        ToPlayers(RequiredArray(team, "subs"), includeFormationPosition: false));

    private static WorldCupPlayerStatsPlayerResponse ToPlayerStatsPlayer(JsonElement player)
    {
        var statsByKey = FlattenPlayerStats(player);

        return new WorldCupPlayerStatsPlayerResponse(
            RequiredString(player, "id"),
            OptionalString(player, "optaId"),
            RequiredString(player, "name"),
            RequiredString(player, "teamId"),
            RequiredString(player, "teamName"),
            OptionalString(player, "shirtNumber"),
            OptionalBool(player, "isGoalkeeper") ?? false,
            PlayerStatCategories
                .Select(category => ToPlayerStatCategory(category, statsByKey))
                .Where(category => category.Stats.Count > 0)
                .ToArray());
    }

    private static Dictionary<string, WorldCupPlayerStatResponse> FlattenPlayerStats(JsonElement player)
    {
        var statsByKey = new Dictionary<string, WorldCupPlayerStatResponse>(StringComparer.OrdinalIgnoreCase);
        if (!TryGetArray(player, "stats", out var statGroups))
        {
            return statsByKey;
        }

        foreach (var group in statGroups.EnumerateArray())
        {
            var groupKey = OptionalString(group, "key");
            if (!TryGetObject(group, "stats", out var stats))
            {
                continue;
            }

            foreach (var statProperty in stats.EnumerateObject())
            {
                if (!TryGetObject(statProperty.Value, "stat", out var stat))
                {
                    continue;
                }

                var key = OptionalString(statProperty.Value, "key");
                if (string.IsNullOrWhiteSpace(key))
                {
                    continue;
                }

                statsByKey[key] = new WorldCupPlayerStatResponse(
                    key,
                    statProperty.Name,
                    groupKey,
                    OptionalJsonValue(stat, "value"),
                    OptionalJsonValue(stat, "total"),
                    OptionalString(stat, "type"));
            }
        }

        return statsByKey;
    }

    private static WorldCupPlayerStatCategoryResponse ToPlayerStatCategory(PlayerStatCategoryDefinition category, Dictionary<string, WorldCupPlayerStatResponse> statsByKey) => new(
        category.Key,
        category.Title,
        category.StatKeys
            .Where(statsByKey.ContainsKey)
            .Select(key => statsByKey[key])
            .ToArray());

    private static bool PlayerMatches(WorldCupPlayerStatsPlayerResponse player, string requestedPlayer)
    {
        return string.Equals(player.Id, requestedPlayer, StringComparison.OrdinalIgnoreCase)
            || string.Equals(player.OptaId, requestedPlayer, StringComparison.OrdinalIgnoreCase)
            || string.Equals(player.Name, requestedPlayer, StringComparison.OrdinalIgnoreCase);
    }

    private static IReadOnlyList<WorldCupLineupPlayerResponse> ToPlayers(JsonElement players, bool includeFormationPosition) => players
        .EnumerateArray()
        .Select(player => ToPlayer(player, includeFormationPosition))
        .ToArray();

    private static WorldCupLineupPlayerResponse ToPlayer(JsonElement player, bool includeFormationPosition) => new(
        RequiredString(player, "id"),
        RequiredString(player, "name"),
        OptionalString(player, "firstName"),
        OptionalString(player, "lastName"),
        OptionalInt(player, "shirtNumber"),
        OptionalInt(player, "positionId"),
        OptionalInt(player, "usualPlayingPositionId"),
        OptionalBool(player, "isCaptain") ?? false,
        includeFormationPosition ? ToFormationPosition(player) : null);

    private static WorldCupFormationPositionResponse? ToFormationPosition(JsonElement player)
    {
        var horizontal = TryGetObject(player, "horizontalLayout", out var horizontalLayout)
            ? ToLayout(horizontalLayout)
            : null;
        var vertical = TryGetObject(player, "verticalLayout", out var verticalLayout)
            ? ToLayout(verticalLayout)
            : null;

        return horizontal is null && vertical is null
            ? null
            : new WorldCupFormationPositionResponse(horizontal, vertical);
    }

    private static WorldCupLayoutResponse ToLayout(JsonElement layout) => new(
        RequiredDecimal(layout, "x"),
        RequiredDecimal(layout, "y"),
        RequiredDecimal(layout, "height"),
        RequiredDecimal(layout, "width"));

    private static WorldCupTeamResponse ToTeam(JsonElement team) => new(
        RequiredString(team, "id"),
        RequiredString(team, "name"),
        OptionalString(team, "shortName"));

    private static JsonElement RequiredArray(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            throw new FotMobScrapeException($"FotMob match data is missing array property '{propertyName}'");
        }

        return value;
    }

    private static JsonElement RequiredObject(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.Object)
        {
            throw new FotMobScrapeException($"FotMob match data is missing object property '{propertyName}'");
        }

        return value;
    }

    private static bool TryGetObject(JsonElement element, string propertyName, out JsonElement value)
    {
        return element.TryGetProperty(propertyName, out value) && value.ValueKind == JsonValueKind.Object;
    }

    private static bool TryGetArray(JsonElement element, string propertyName, out JsonElement value)
    {
        return element.TryGetProperty(propertyName, out value) && value.ValueKind == JsonValueKind.Array;
    }

    private static string RequiredString(JsonElement element, string propertyName)
    {
        var value = OptionalString(element, propertyName);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new FotMobScrapeException($"FotMob match data is missing string property '{propertyName}'");
        }

        return value;
    }

    private static string? OptionalString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private static bool? OptionalBool(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }

    private static object? OptionalJsonValue(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number when value.TryGetInt64(out var integer) => integer,
            JsonValueKind.Number when value.TryGetDecimal(out var number) => number,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => value.GetRawText()
        };
    }

    private static int? OptionalInt(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var parsed) => parsed,
            JsonValueKind.String when int.TryParse(value.GetString(), out var parsed) => parsed,
            _ => null
        };
    }

    private static decimal RequiredDecimal(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value))
        {
            throw new FotMobScrapeException($"FotMob match data is missing decimal property '{propertyName}'");
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDecimal(out var parsed) => parsed,
            JsonValueKind.String when decimal.TryParse(value.GetString(), out var parsed) => parsed,
            _ => throw new FotMobScrapeException($"FotMob match data property '{propertyName}' is not a decimal")
        };
    }
}
