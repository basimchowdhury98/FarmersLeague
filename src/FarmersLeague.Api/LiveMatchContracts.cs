record LiveMatchResponse(MatchResponse Match, IReadOnlyList<LiveSquadResponse> Squads, LiveMatchFinalResultResponse? FinalResult = null);

record LiveMatchUpdateMessage(string Type, MatchResponse Match, IReadOnlyList<LiveSquadResponse> Squads, LiveMatchFinalResultResponse? FinalResult = null);

record LiveMatchHeartbeatMessage(string Type);

record LiveSquadResponse(string UserName, IReadOnlyList<LivePlayerResponse> Players);

record LivePlayerResponse(string Name, string? TeamName, IReadOnlyList<PlayerStatCategoryResponse> Categories);

record LiveMatchFinalResultResponse(IReadOnlyList<string> Winners, IReadOnlyList<LiveSquadFinalScoreResponse> Squads, DateTimeOffset FinalizedAt);

record LiveSquadFinalScoreResponse(string UserName, int TotalPoints);

record CompletedLiveMatchResult(
    MatchResponse Match,
    IReadOnlyList<string> Winners,
    IReadOnlyList<LiveSquadFinalScoreResponse> Squads,
    IReadOnlyList<PlayerStatsPlayerResponse> DraftedPlayerStats,
    IReadOnlyList<ArchivedPlayerStatsPlayerResponse> AllPlayerStats,
    IReadOnlyDictionary<string, int> PointsConfig,
    DateTimeOffset FinalizedAt);

record ArchivedPlayerStatsPlayerResponse(
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

record PlayerStatsRequest(IReadOnlyList<string> Players);

record PlayerStatsResponse(string GameId, IReadOnlyList<PlayerStatsPlayerResponse> Players, IReadOnlyList<string> MissingPlayers);

record PlayerStatsPlayerResponse(string Id, string? OptaId, string Name, string TeamId, string TeamName, string? ShirtNumber, bool IsGoalkeeper, IReadOnlyList<PlayerStatCategoryResponse> Categories);

record PlayerStatCategoryResponse(string Key, string Title, IReadOnlyList<PlayerStatResponse> Stats);

record PlayerStatResponse(string Key, string Label, string? SourceGroup, object? Value, object? Total, string? Type);
