static class DraftStatuses
{
    public const string Open = "open";
    public const string Started = "started";
    public const string Completed = "completed";
}

static class DraftOrderModes
{
    public const string RoundRobin = "roundRobin";
    public const string Abba = "abba";
}

record HelloResponse(string Message);

record AccessResponse(bool HasAccess, string? UserName, bool IsAdmin);

record LeagueUser(string Name, string Passkey, bool IsAdmin);

record DraftState(string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<string>? DraftTurnOrder, IReadOnlyList<DraftPick> Picks);

record DraftPick(string UserName, string PlayerName);

record DraftPickRequest(string Passkey, string PlayerName);

record DraftAccessRequest(string Passkey);

record DraftStartRequest(string Passkey, string? DraftOrderMode);

record TestingGameStatusRequest(bool Started, bool Finished, string? Score = null);

record DraftPickErrorResponse(string Message);

record DraftLiveClientMessage(string? Type, int? RevealedCount);

record DraftOrderRevealMessage(string Type, int RevealedCount);

record DraftOrderRevealCompleteMessage(string Type);

record DraftContextResult(string? UserName, bool IsAdmin, MatchResponse? Match, IResult? Error);

record LiveMatchResult(LiveMatchResponse? LiveMatch, IResult? Error);

record DraftResponse(MatchResponse Match, string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<string> DraftTurnOrder, IReadOnlyList<DraftPick> Picks, string? CurrentTurn, bool IsComplete);

record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups, bool HasStarted, bool HasFinished, string? Score = null);

record HomeMatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups, DraftResponse? Draft, bool HasStarted, bool HasFinished, string? Score = null);

record LineupResponse(string TeamName, string Formation, IReadOnlyList<StarterResponse> Starters, IReadOnlyList<StarterResponse> Bench);

record StarterResponse(string Name, int? Number, string? Position, string? Grid, int? GridRow, int? GridColumn);
