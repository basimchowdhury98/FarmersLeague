record FotMobFixtureMatch(WorldCupGameResponse Game, string PageUrl);

record PlayerStatCategoryDefinition(string Key, string Title, IReadOnlyList<string> StatKeys);

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

record WorldCupPlayerStatsRequest(IReadOnlyList<string> Players);

record WorldCupPlayerStatsResponse(
    string GameId,
    IReadOnlyList<WorldCupPlayerStatsPlayerResponse> Players,
    IReadOnlyList<string> MissingPlayers);

record WorldCupPlayerStatsPlayerResponse(
    string Id,
    string? OptaId,
    string Name,
    string TeamId,
    string TeamName,
    string? ShirtNumber,
    bool IsGoalkeeper,
    IReadOnlyList<WorldCupPlayerStatCategoryResponse> Categories);

record WorldCupPlayerStatCategoryResponse(
    string Key,
    string Title,
    IReadOnlyList<WorldCupPlayerStatResponse> Stats);

record WorldCupPlayerStatResponse(
    string Key,
    string Label,
    string? SourceGroup,
    object? Value,
    object? Total,
    string? Type);

class FotMobScrapeException(string message) : Exception(message);
