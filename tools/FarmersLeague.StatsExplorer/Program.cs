using System.Globalization;
using System.Text.Json;
using Spectre.Console;
using StackExchange.Redis;

var options = ExplorerOptions.Parse(args);
var redisConnectionString = options.RedisConnectionString
    ?? Environment.GetEnvironmentVariable("Redis__ConnectionString")
    ?? "localhost:6379";

AnsiConsole.MarkupLine("[bold]FarmersLeague Stats Explorer[/]");
AnsiConsole.MarkupLine($"Redis: [grey]{Markup.Escape(RedactRedisConnectionString(redisConnectionString))}[/]");

await using var redis = await ConnectionMultiplexer.ConnectAsync(redisConnectionString);
var database = redis.GetDatabase();
var completedGames = ListCompletedGames(redis, options.InstanceName).ToArray();

if (completedGames.Length == 0)
{
    AnsiConsole.MarkupLine($"[yellow]No completed live matches found for pattern {Markup.Escape(CompletedKeyPattern(options.InstanceName))}.[/]");
    return;
}

var cachedMatches = await LoadCachedMatches(database, options.InstanceName);
var selectedGame = options.GameId is not null
    ? completedGames.FirstOrDefault(game => game.MatchId == options.GameId.Value)
    : SelectGame(completedGames, cachedMatches);

if (selectedGame is null)
{
    AnsiConsole.MarkupLine($"[red]Completed game {options.GameId} was not found.[/]");
    return;
}

var completedJson = await GetDistributedCacheString(database, selectedGame.RedisKey);
if (completedJson.IsNullOrEmpty)
{
    AnsiConsole.MarkupLine($"[red]Completed game key {Markup.Escape(selectedGame.RedisKey)} is empty.[/]");
    return;
}

var completed = JsonSerializer.Deserialize<CompletedLiveMatchResult>((string)completedJson!, JsonOptions.Options);
if (completed is null)
{
    AnsiConsole.MarkupLine("[red]Could not parse completed game JSON.[/]");
    return;
}

var scoringConfigSource = options.UseCurrentScoringConfig ? ScoringConfigSource.Current : ScoringConfigSource.Stored;
var showResults = true;

while (showResults)
{
    var activePointsConfig = PointsConfigFor(completed, scoringConfigSource);
    var playerRows = CalculatePlayerRows(completed, activePointsConfig);

    RenderGameSummary(completed, activePointsConfig, scoringConfigSource);
    RenderSquads(completed, playerRows, scoringConfigSource);
    RenderLeaderboard(playerRows);

    var action = SelectExplorerAction(playerRows, scoringConfigSource);
    switch (action)
    {
        case ExplorerAction.ShowPlayerBreakdown:
            var selectedPlayer = AnsiConsole.Prompt(
                new SelectionPrompt<PlayerPoints>()
                    .Title("Select player")
                    .PageSize(20)
                    .UseConverter(player => $"{player.Player.Name} ({player.Player.TeamName}) - {player.TotalPoints} pts")
                    .AddChoices(playerRows));
            RenderPlayerBreakdown(selectedPlayer);
            break;
        case ExplorerAction.UseCurrentScoringConfig:
            scoringConfigSource = ScoringConfigSource.Current;
            break;
        case ExplorerAction.ResetToStoredScoringConfig:
            scoringConfigSource = ScoringConfigSource.Stored;
            break;
        case ExplorerAction.Exit:
            showResults = false;
            break;
    }
}

static CompletedGameKey[] ListCompletedGames(ConnectionMultiplexer redis, string instanceName)
{
    var pattern = CompletedKeyPattern(instanceName);

    return redis.GetEndPoints()
        .Select(endpoint => redis.GetServer(endpoint))
        .Where(server => server.IsConnected)
        .SelectMany(server => server.Keys(pattern: pattern).Select(key => CompletedGameKey.TryParse(key.ToString(), instanceName)))
        .Where(game => game is not null)
        .Select(game => game!)
        .GroupBy(game => game.MatchId)
        .Select(group => group.First())
        .OrderBy(game => game.MatchId)
        .ToArray();
}

static string CompletedKeyPattern(string instanceName) => $"{instanceName}live-matches:*:completed";

static async Task<IReadOnlyDictionary<int, CachedHomeMatch>> LoadCachedMatches(IDatabase database, string instanceName)
{
    var cached = await GetDistributedCacheString(database, $"{instanceName}matches:world-cup-2026");
    if (cached.IsNullOrEmpty)
    {
        return new Dictionary<int, CachedHomeMatch>();
    }

    try
    {
        return (JsonSerializer.Deserialize<CachedHomeMatch[]>((string)cached!, JsonOptions.Options) ?? [])
            .ToDictionary(match => match.Id, EqualityComparer<int>.Default);
    }
    catch (JsonException)
    {
        return new Dictionary<int, CachedHomeMatch>();
    }
}

static async Task<RedisValue> GetDistributedCacheString(IDatabase database, RedisKey key)
{
    var entryType = await database.KeyTypeAsync(key);
    return entryType switch
    {
        RedisType.Hash => await database.HashGetAsync(key, "data"),
        RedisType.String => await database.StringGetAsync(key),
        RedisType.None => RedisValue.Null,
        _ => RedisValue.Null
    };
}

static CompletedGameKey SelectGame(IReadOnlyList<CompletedGameKey> completedGames, IReadOnlyDictionary<int, CachedHomeMatch> cachedMatches) =>
    AnsiConsole.Prompt(
        new SelectionPrompt<CompletedGameKey>()
            .Title("Select completed game")
            .PageSize(20)
            .UseConverter(game => GameLabel(game, cachedMatches))
            .AddChoices(completedGames));

static string GameLabel(CompletedGameKey game, IReadOnlyDictionary<int, CachedHomeMatch> cachedMatches)
{
    if (!cachedMatches.TryGetValue(game.MatchId, out var match))
    {
        return game.MatchId.ToString(CultureInfo.InvariantCulture);
    }

    var score = string.IsNullOrWhiteSpace(match.Score) ? string.Empty : $" {match.Score}";
    return $"{match.Id} - {match.HomeTeam} vs {match.AwayTeam}{score} ({match.Date.LocalDateTime:g})";
}

static IReadOnlyDictionary<string, int> PointsConfigFor(CompletedLiveMatchResult completed, ScoringConfigSource scoringConfigSource) =>
    scoringConfigSource switch
    {
        ScoringConfigSource.Current => LiveScoringConfig.PointMultipliers,
        _ => completed.PointsConfig
    };

static PlayerPoints[] CalculatePlayerRows(CompletedLiveMatchResult completed, IReadOnlyDictionary<string, int> pointsConfig) =>
    completed.AllPlayerStats
        .Select(player => PlayerPoints.From(player, pointsConfig))
        .OrderByDescending(player => player.TotalPoints)
        .ThenBy(player => player.Player.TeamName, StringComparer.Ordinal)
        .ThenBy(player => player.Player.Name, StringComparer.Ordinal)
        .ToArray();

static void RenderGameSummary(CompletedLiveMatchResult completed, IReadOnlyDictionary<string, int> pointsConfig, ScoringConfigSource scoringConfigSource)
{
    var table = new Table().Title("Game").RoundedBorder();
    table.AddColumn("Field");
    table.AddColumn("Value");
    table.AddRow("Match", $"{completed.Match.HomeTeam} vs {completed.Match.AwayTeam}");
    table.AddRow("Match ID", completed.Match.Id.ToString(CultureInfo.InvariantCulture));
    table.AddRow("Date", completed.Match.Date.LocalDateTime.ToString("g", CultureInfo.CurrentCulture));
    table.AddRow("Score", completed.Match.Score ?? "-");
    table.AddRow("Finalized", completed.FinalizedAt.LocalDateTime.ToString("g", CultureInfo.CurrentCulture));
    table.AddRow("Players", completed.AllPlayerStats.Count.ToString(CultureInfo.InvariantCulture));
    table.AddRow("Scoring Config", ScoringConfigSourceLabel(scoringConfigSource));
    table.AddRow("Point Config Entries", pointsConfig.Count.ToString(CultureInfo.InvariantCulture));
    AnsiConsole.Write(table);
}

static void RenderSquads(CompletedLiveMatchResult completed, IReadOnlyList<PlayerPoints> playerRows, ScoringConfigSource scoringConfigSource)
{
    var squadTotals = completed.Squads
        .Select(squad => new LiveSquadFinalScoreResponse(
            squad.UserName,
            playerRows.Where(player => string.Equals(player.Player.DraftedBy, squad.UserName, StringComparison.Ordinal)).Sum(player => player.TotalPoints)))
        .ToArray();
    var highScore = squadTotals.Length == 0 ? 0 : squadTotals.Max(squad => squad.TotalPoints);

    var table = new Table().Title($"Squads - {ScoringConfigSourceLabel(scoringConfigSource)}").RoundedBorder();
    table.AddColumn("User");
    table.AddColumn(new TableColumn("Total").RightAligned());
    table.AddColumn("Winner");

    foreach (var squad in squadTotals.OrderByDescending(squad => squad.TotalPoints).ThenBy(squad => squad.UserName, StringComparer.Ordinal))
    {
        table.AddRow(
            Markup.Escape(squad.UserName),
            squad.TotalPoints.ToString(CultureInfo.InvariantCulture),
            squad.TotalPoints == highScore ? "yes" : string.Empty);
    }

    AnsiConsole.Write(table);
}

static ExplorerAction SelectExplorerAction(IReadOnlyList<PlayerPoints> playerRows, ScoringConfigSource scoringConfigSource)
{
    var actions = new List<ExplorerAction>();
    if (playerRows.Count > 0)
    {
        actions.Add(ExplorerAction.ShowPlayerBreakdown);
    }

    actions.Add(scoringConfigSource == ScoringConfigSource.Stored
        ? ExplorerAction.UseCurrentScoringConfig
        : ExplorerAction.ResetToStoredScoringConfig);
    actions.Add(ExplorerAction.Exit);

    return AnsiConsole.Prompt(
        new SelectionPrompt<ExplorerAction>()
            .Title("Next action")
            .UseConverter(ExplorerActionLabel)
            .AddChoices(actions));
}

static string ExplorerActionLabel(ExplorerAction action) => action switch
{
    ExplorerAction.ShowPlayerBreakdown => "Show a player's stat breakdown",
    ExplorerAction.UseCurrentScoringConfig => "Use current LiveScoringConfig",
    ExplorerAction.ResetToStoredScoringConfig => "Reset to stored scoring config",
    _ => "Exit"
};

static string ScoringConfigSourceLabel(ScoringConfigSource scoringConfigSource) => scoringConfigSource switch
{
    ScoringConfigSource.Current => "Current LiveScoringConfig",
    _ => "Stored completed-match config"
};

static void RenderLeaderboard(IReadOnlyList<PlayerPoints> playerRows)
{
    var table = new Table().Title("All Player Points").RoundedBorder();
    table.AddColumn(new TableColumn("#").RightAligned());
    table.AddColumn("Player");
    table.AddColumn("Team");
    table.AddColumn("Drafted By");
    table.AddColumn(new TableColumn("Points").RightAligned());
    table.AddColumn("Scoring Stats");

    var rank = 1;
    foreach (var row in playerRows)
    {
        table.AddRow(
            rank.ToString(CultureInfo.InvariantCulture),
            Markup.Escape(row.Player.Name),
            Markup.Escape(row.Player.TeamName),
            Markup.Escape(row.Player.DraftedBy ?? "-"),
            row.TotalPoints.ToString(CultureInfo.InvariantCulture),
            Markup.Escape(string.Join(", ", row.ScoringStats.Select(stat => $"{stat.Stat.Label} {stat.Points:+#;-#;0}"))));
        rank++;
    }

    AnsiConsole.Write(table);
}

static void RenderPlayerBreakdown(PlayerPoints player)
{
    var table = new Table().Title($"{player.Player.Name} - {player.TotalPoints} pts").RoundedBorder();
    table.AddColumn("Stat");
    table.AddColumn("Key");
    table.AddColumn(new TableColumn("Value").RightAligned());
    table.AddColumn(new TableColumn("Multiplier").RightAligned());
    table.AddColumn(new TableColumn("Points").RightAligned());

    foreach (var stat in player.StatRows.OrderByDescending(stat => Math.Abs(stat.Points)).ThenBy(stat => stat.Stat.Label, StringComparer.Ordinal))
    {
        table.AddRow(
            Markup.Escape(stat.Stat.Label),
            Markup.Escape(stat.Stat.Key),
            stat.Value.ToString(CultureInfo.InvariantCulture),
            stat.Multiplier.ToString(CultureInfo.InvariantCulture),
            stat.Points.ToString(CultureInfo.InvariantCulture));
    }

    AnsiConsole.Write(table);
}

static string RedactRedisConnectionString(string connectionString)
{
    var parts = connectionString.Split(',', StringSplitOptions.TrimEntries);
    for (var index = 0; index < parts.Length; index++)
    {
        if (parts[index].StartsWith("password=", StringComparison.OrdinalIgnoreCase))
        {
            parts[index] = "password=***";
        }
    }

    return string.Join(',', parts);
}

sealed record ExplorerOptions(string? RedisConnectionString, string InstanceName, int? GameId, bool UseCurrentScoringConfig)
{
    public static ExplorerOptions Parse(string[] args)
    {
        string? redisConnectionString = null;
        var instanceName = "FarmersLeague:";
        int? gameId = null;
        var useCurrentScoringConfig = false;

        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--redis" when index + 1 < args.Length:
                    redisConnectionString = args[++index];
                    break;
                case "--instance" when index + 1 < args.Length:
                    instanceName = args[++index];
                    break;
                case "--game" when index + 1 < args.Length && int.TryParse(args[++index], out var parsedGameId):
                    gameId = parsedGameId;
                    break;
                case "--current-scoring-config":
                    useCurrentScoringConfig = true;
                    break;
                case "--help":
                case "-h":
                    AnsiConsole.WriteLine("Usage: dotnet run --project tools/FarmersLeague.StatsExplorer -- [--redis <connection-string>] [--instance FarmersLeague:] [--game <match-id>] [--current-scoring-config]");
                    Environment.Exit(0);
                    break;
            }
        }

        return new ExplorerOptions(redisConnectionString, instanceName, gameId, useCurrentScoringConfig);
    }
}

enum ScoringConfigSource
{
    Stored,
    Current
}

enum ExplorerAction
{
    ShowPlayerBreakdown,
    UseCurrentScoringConfig,
    ResetToStoredScoringConfig,
    Exit
}

sealed record CompletedGameKey(int MatchId, string RedisKey)
{
    public static CompletedGameKey? TryParse(string redisKey, string instanceName)
    {
        var prefix = $"{instanceName}live-matches:";
        const string suffix = ":completed";
        if (!redisKey.StartsWith(prefix, StringComparison.Ordinal) || !redisKey.EndsWith(suffix, StringComparison.Ordinal))
        {
            return null;
        }

        var matchIdText = redisKey[prefix.Length..^suffix.Length];
        return int.TryParse(matchIdText, out var matchId) ? new CompletedGameKey(matchId, redisKey) : null;
    }
}

sealed record PlayerPoints(ArchivedPlayerStatsPlayerResponse Player, IReadOnlyList<StatPoints> StatRows, int TotalPoints)
{
    public IReadOnlyList<StatPoints> ScoringStats => StatRows.Where(stat => stat.Points != 0).ToArray();

    public static PlayerPoints From(ArchivedPlayerStatsPlayerResponse player, IReadOnlyDictionary<string, int> pointsConfig)
    {
        var rows = player.Stats
            .GroupBy(stat => stat.Key, StringComparer.Ordinal)
            .Select(group => group.First())
            .Select(stat =>
            {
                var value = StatValueParser.NumericStatValue(stat.Value);
                var multiplier = pointsConfig.GetValueOrDefault(stat.Key, 0);
                return new StatPoints(stat, value, multiplier, value * multiplier);
            })
            .ToArray();

        return new PlayerPoints(player, rows, rows.Sum(stat => stat.Points));
    }
}

sealed record StatPoints(PlayerStatResponse Stat, int Value, int Multiplier, int Points);

sealed record CompletedLiveMatchResult(
    MatchResponse Match,
    IReadOnlyList<string> Winners,
    IReadOnlyList<LiveSquadFinalScoreResponse> Squads,
    IReadOnlyList<PlayerStatsPlayerResponse> DraftedPlayerStats,
    IReadOnlyList<ArchivedPlayerStatsPlayerResponse> AllPlayerStats,
    IReadOnlyDictionary<string, int> PointsConfig,
    DateTimeOffset FinalizedAt);

sealed record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<object> Lineups, bool HasStarted, bool HasFinished, string? Score);

sealed record LiveSquadFinalScoreResponse(string UserName, int TotalPoints);

sealed record ArchivedPlayerStatsPlayerResponse(
    string Id,
    string? OptaId,
    string Name,
    string TeamId,
    string TeamName,
    string? ShirtNumber,
    bool IsGoalkeeper,
    IReadOnlyList<PlayerStatCategoryResponse> Categories,
    string? DraftedBy,
    string Team,
    IReadOnlyList<PlayerStatResponse> Stats,
    int TotalPoints);

sealed record PlayerStatsPlayerResponse(string Id, string? OptaId, string Name, string TeamId, string TeamName, string? ShirtNumber, bool IsGoalkeeper, IReadOnlyList<PlayerStatCategoryResponse> Categories);

sealed record PlayerStatCategoryResponse(string Key, string Title, IReadOnlyList<PlayerStatResponse> Stats);

sealed record PlayerStatResponse(string Key, string Label, string? SourceGroup, JsonElement Value, JsonElement Total, string? Type);

sealed record CachedHomeMatch(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, bool HasStarted, bool HasFinished, string? Score, JsonElement? Draft);

static class JsonOptions
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}

static class StatValueParser
{
    public static int NumericStatValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Number => value.TryGetInt32(out var intValue) ? intValue : (int)Math.Round(value.GetDouble()),
        JsonValueKind.String => int.TryParse(value.GetString(), out var stringValue) ? stringValue : 0,
        _ => 0
    };
}
