public interface IWorldCupScraper
{
    Task<IReadOnlyList<WorldCupGameResponse>> GetGames(CancellationToken cancellationToken);

    Task<WorldCupLineupResponse?> GetLineup(string gameId, CancellationToken cancellationToken);

    Task<WorldCupPlayerStatsResponse?> GetPlayerStats(string gameId, IReadOnlyList<string> requestedPlayers, CancellationToken cancellationToken);
}

record FotMobFixtureMatch(WorldCupGameResponse Game, string PageUrl);

record PlayerStatCategoryDefinition(string Key, string Title, IReadOnlyList<string> StatKeys);

public record WorldCupGameResponse(
    string Id,
    WorldCupTeamResponse HomeTeam,
    WorldCupTeamResponse AwayTeam,
    string? Group,
    string? Round,
    string? RoundName,
    DateTimeOffset StartTimeUtc,
    WorldCupGameStatusResponse Status);

public record WorldCupTeamResponse(string Id, string Name, string? ShortName);

public record WorldCupGameStatusResponse(bool Started, bool Finished, string? Score, string? Reason, string? LiveTime);

public record WorldCupLineupResponse(
    string GameId,
    string? LineupType,
    string? Source,
    WorldCupLineupTeamResponse HomeTeam,
    WorldCupLineupTeamResponse AwayTeam);

public record WorldCupLineupTeamResponse(
    string Id,
    string Name,
    string? Formation,
    IReadOnlyList<WorldCupLineupPlayerResponse> Starting11,
    IReadOnlyList<WorldCupLineupPlayerResponse> Bench);

public static class WorldCupLineupRules
{
    public const int StartingPlayerCount = 11;

    public static bool IsConfirmed(string? lineupType, int homeStarterCount, int homeBenchCount, int awayStarterCount, int awayBenchCount) =>
        !string.Equals(lineupType, "predicted", StringComparison.OrdinalIgnoreCase)
        && HasConfirmedStarters(homeStarterCount)
        && HasConfirmedStarters(awayStarterCount);

    public static bool HasConfirmedStarters(int starterCount) =>
        starterCount == StartingPlayerCount;
}

public record WorldCupLineupPlayerResponse(
    string Id,
    string Name,
    string? FirstName,
    string? LastName,
    int? ShirtNumber,
    int? PositionId,
    int? UsualPlayingPositionId,
    bool IsCaptain,
    WorldCupFormationPositionResponse? FormationPosition);

public record WorldCupFormationPositionResponse(WorldCupLayoutResponse? Horizontal, WorldCupLayoutResponse? Vertical);

public record WorldCupLayoutResponse(decimal X, decimal Y, decimal Height, decimal Width);

public record WorldCupPlayerStatsRequest(IReadOnlyList<string> Players);

public record WorldCupPlayerStatsResponse(
    string GameId,
    IReadOnlyList<WorldCupPlayerStatsPlayerResponse> Players,
    IReadOnlyList<string> MissingPlayers);

public record WorldCupPlayerStatsPlayerResponse(
    string Id,
    string? OptaId,
    string Name,
    string TeamId,
    string TeamName,
    string? ShirtNumber,
    bool IsGoalkeeper,
    IReadOnlyList<WorldCupPlayerStatCategoryResponse> Categories);

public record WorldCupPlayerStatCategoryResponse(
    string Key,
    string Title,
    IReadOnlyList<WorldCupPlayerStatResponse> Stats);

public record WorldCupPlayerStatResponse(
    string Key,
    string Label,
    string? SourceGroup,
    object? Value,
    object? Total,
    string? Type);

public class FotMobScrapeException(string message) : Exception(message);
