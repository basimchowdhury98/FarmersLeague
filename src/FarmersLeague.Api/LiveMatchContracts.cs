record LiveMatchResponse(MatchResponse Match, IReadOnlyList<LiveSquadResponse> Squads, LiveMatchFinalResultResponse? FinalResult = null);

record LiveMatchUpdateMessage(string Type, MatchResponse Match, IReadOnlyList<LiveSquadResponse> Squads, LiveMatchFinalResultResponse? FinalResult = null);

record LiveMatchHeartbeatMessage(string Type);

record LiveSquadResponse(string UserName, IReadOnlyList<LivePlayerResponse> Players);

record LivePlayerResponse(string Name, string? TeamName, IReadOnlyList<PlayerStatCategoryResponse> Categories, LivePlayerSubstitutionResponse? Substitution = null, string? FantasySubstitutionStatus = null, int? PointsOverride = null);

record LivePlayerSubstitutionResponse(int Minute, string PlayerOnName, bool InjuredPlayerOut);

record LiveMatchFinalResultResponse(IReadOnlyList<string> Winners, IReadOnlyList<LiveSquadFinalScoreResponse> Squads, DateTimeOffset FinalizedAt);

record LiveSquadFinalScoreResponse(string UserName, int TotalPoints);

record CompletedLiveMatchResult(
    MatchResponse Match,
    IReadOnlyList<string> Winners,
    IReadOnlyList<LiveSquadFinalScoreResponse> Squads,
    IReadOnlyList<PlayerStatsPlayerResponse> DraftedPlayerStats,
    IReadOnlyList<ArchivedPlayerStatsPlayerResponse> AllPlayerStats,
    IReadOnlyDictionary<string, int> PointsConfig,
    IReadOnlyList<LiveFantasySubstitution> FantasySubstitutions,
    DateTimeOffset FinalizedAt);

record LiveFantasyMatchState(IReadOnlyList<LiveFantasySubstitution> Substitutions);

record LiveFantasySubstitution(
    string UserName,
    string PlayerOutName,
    string PlayerInName,
    DateTimeOffset CreatedAt,
    int PlayerOutPointsAtSubstitution,
    int PlayerInPointsAtSubstitution,
    IReadOnlyList<PlayerStatCategoryResponse> PlayerOutStatsAtSubstitution,
    IReadOnlyList<PlayerStatCategoryResponse> PlayerInStatsAtSubstitution);

record LiveFantasySubstitutionRequest(string Passkey, string PlayerInName, string PlayerOutName);

record LiveFantasySquadEntry(string UserName, string PlayerName, string? FantasySubstitutionStatus, int? PointsOverride, int PointsBaseline = 0);

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

record PlayerStatsResponse(string GameId, IReadOnlyList<PlayerStatsPlayerResponse> Players, IReadOnlyList<string> MissingPlayers, IReadOnlyList<MatchSubstitutionResponse> Substitutions, PlayerStatsMatchStatusResponse? Status = null);

record MatchSubstitutionResponse(int Minute, bool IsHome, string PlayerOnId, string PlayerOnName, string PlayerOffId, string PlayerOffName, bool InjuredPlayerOut);

record PlayerStatsMatchStatusResponse(bool Started, bool Finished, string? Score, PlayerStatsMatchStatusReasonResponse? Reason, string? LiveTime);

record PlayerStatsMatchStatusReasonResponse(string? Short, string? ShortKey, string? Long, string? LongKey);

record PlayerStatsPlayerResponse(string Id, string? OptaId, string Name, string TeamId, string TeamName, string? ShirtNumber, bool IsGoalkeeper, IReadOnlyList<PlayerStatCategoryResponse> Categories);

record PlayerStatCategoryResponse(string Key, string Title, IReadOnlyList<PlayerStatResponse> Stats);

record PlayerStatResponse(string Key, string Label, string? SourceGroup, object? Value, object? Total, string? Type, int Points);
