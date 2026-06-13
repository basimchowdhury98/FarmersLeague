static class DraftStatuses
{
    public const string Open = "open";
    public const string Started = "started";
    public const string Completed = "completed";
}

record HelloResponse(string Message);

record AccessResponse(bool HasAccess, string? UserName);

record TestUser(string Name, string Passkey);

record DraftState(string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<DraftPick> Picks);

record DraftPick(string UserName, string PlayerName);

record DraftPickRequest(string Passkey, string PlayerName);

record DraftLifecycleRequest(string Passkey);

record DraftPickErrorResponse(string Message);

record DraftContextResult(string? UserName, MatchResponse? Match, IResult? Error);

record DraftResponse(MatchResponse Match, string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<DraftPick> Picks, string? CurrentTurn, bool IsComplete);

record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups);

record HomeMatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups, DraftResponse? Draft, bool HasStarted);

record LineupResponse(string TeamName, string Formation, IReadOnlyList<StarterResponse> Starters, IReadOnlyList<StarterResponse> Bench);

record StarterResponse(string Name, int? Number, string? Position, string? Grid, int? GridRow, int? GridColumn);

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
