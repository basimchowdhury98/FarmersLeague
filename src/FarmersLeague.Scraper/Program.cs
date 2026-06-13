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

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/world-cup-2026/games", async (FotMobWorldCupScraper scraper, CancellationToken cancellationToken) =>
{
    try
    {
        var games = await scraper.GetGames(cancellationToken);

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

app.Run();

class FotMobWorldCupScraper(IHttpClientFactory httpClientFactory, IConfiguration configuration)
{
    private const string NextDataStart = "<script id=\"__NEXT_DATA__\" type=\"application/json\">";
    private const string ScriptEnd = "</script>";

    public async Task<IReadOnlyList<WorldCupGameResponse>> GetGames(CancellationToken cancellationToken)
    {
        var matches = await GetFixtureMatches(cancellationToken);

        return matches
            .Select(match => match.Game)
            .OrderBy(game => game.StartTimeUtc)
            .ToArray();
    }

    public async Task<WorldCupLineupResponse?> GetLineup(string gameId, CancellationToken cancellationToken)
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

        return TryGetLineup(document.RootElement, out var lineup) && IsConfirmedLineup(lineup)
            ? ToLineup(lineup)
            : null;
    }

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

record FotMobFixtureMatch(WorldCupGameResponse Game, string PageUrl);

record WorldCupGameResponse(
    string Id,
    WorldCupTeamResponse HomeTeam,
    WorldCupTeamResponse AwayTeam,
    string? Group,
    string? Round,
    string? RoundName,
    DateTimeOffset StartTimeUtc,
    WorldCupGameStatusResponse Status);

record WorldCupTeamResponse(string Id, string Name, string? ShortName);

record WorldCupGameStatusResponse(bool Started, bool Finished, string? Score, string? Reason, string? LiveTime);

record WorldCupLineupResponse(
    string GameId,
    string? LineupType,
    string? Source,
    WorldCupLineupTeamResponse HomeTeam,
    WorldCupLineupTeamResponse AwayTeam);

record WorldCupLineupTeamResponse(
    string Id,
    string Name,
    string? Formation,
    IReadOnlyList<WorldCupLineupPlayerResponse> Starting11,
    IReadOnlyList<WorldCupLineupPlayerResponse> Bench);

record WorldCupLineupPlayerResponse(
    string Id,
    string Name,
    string? FirstName,
    string? LastName,
    int? ShirtNumber,
    int? PositionId,
    int? UsualPlayingPositionId,
    bool IsCaptain,
    WorldCupFormationPositionResponse? FormationPosition);

record WorldCupFormationPositionResponse(WorldCupLayoutResponse? Horizontal, WorldCupLayoutResponse? Vertical);

record WorldCupLayoutResponse(decimal X, decimal Y, decimal Height, decimal Width);

class FotMobScrapeException(string message) : Exception(message);
