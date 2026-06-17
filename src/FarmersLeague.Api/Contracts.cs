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

static class DraftRules
{
    public const int MaxPicksPerUser = 3;

    public static DraftState Normalize(DraftState? draft)
    {
        if (draft is null)
        {
            return new DraftState(DraftStatuses.Open, [], [], null, []);
        }

        var draftOrder = draft.DraftOrder ?? [];
        var rawJoinedUsers = draft.JoinedUsers ?? [];
        var joinedUsers = rawJoinedUsers.Count > 0 ? rawJoinedUsers : draftOrder;
        var status = string.IsNullOrWhiteSpace(draft.Status)
            ? draftOrder.Count > 0 ? DraftStatuses.Started : DraftStatuses.Open
            : draft.Status;

        var draftTurnOrder = draft.DraftTurnOrder is { Count: > 0 }
            ? draft.DraftTurnOrder
            : CreateTurnOrder(draftOrder, DraftOrderModes.RoundRobin);

        var normalized = draft with
        {
            Status = status,
            JoinedUsers = joinedUsers,
            DraftOrder = draftOrder,
            DraftTurnOrder = draftTurnOrder,
            Picks = draft.Picks ?? []
        };

        return IsComplete(normalized) ? normalized with { Status = DraftStatuses.Completed } : normalized;
    }

    public static bool IsComplete(DraftState draft)
    {
        var totalTurnCount = Turns(draft).Count;
        return totalTurnCount > 0 && draft.Picks.Count >= totalTurnCount;
    }

    public static IReadOnlyList<string> CreateTurnOrder(IReadOnlyList<string> draftOrder, string? mode)
    {
        if (draftOrder.Count == 0)
        {
            return [];
        }

        var normalizedMode = string.IsNullOrWhiteSpace(mode) ? DraftOrderModes.RoundRobin : mode;
        var turns = new List<string>(draftOrder.Count * MaxPicksPerUser);

        for (var round = 0; round < MaxPicksPerUser; round++)
        {
            var roundOrder = string.Equals(normalizedMode, DraftOrderModes.Abba, StringComparison.OrdinalIgnoreCase) && round % 2 == 1
                ? draftOrder.Reverse()
                : draftOrder;
            turns.AddRange(roundOrder);
        }

        return turns;
    }

    public static IReadOnlyList<string> Turns(DraftState draft) =>
        draft.DraftTurnOrder is { Count: > 0 } ? draft.DraftTurnOrder : CreateTurnOrder(draft.DraftOrder, DraftOrderModes.RoundRobin);
}

record HelloResponse(string Message);

record AccessResponse(bool HasAccess, string? UserName, bool IsAdmin);

record LeagueUser(string Name, string Passkey, bool IsAdmin);

record DraftState(string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<string>? DraftTurnOrder, IReadOnlyList<DraftPick> Picks);

record DraftViewState(DraftState Draft, string Status, string? CurrentTurn, bool IsComplete);

record DraftPick(string UserName, string PlayerName);

record DraftPickRequest(string Passkey, string PlayerName);

record DraftAccessRequest(string Passkey);

record DraftStartRequest(string Passkey, string? DraftOrderMode);

record TestingGameStatusRequest(bool Started, bool Finished, string? Score = null);

record DraftPickErrorResponse(string Message);

record DraftLiveClientMessage(string? Type, int? RevealedCount);

record DraftOrderRevealMessage(string Type, int RevealedCount);

record DraftOrderRevealCompleteMessage(string Type);

record DraftUpdateMessage(string Type, string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<string> DraftTurnOrder, IReadOnlyList<DraftPick> Picks, string? CurrentTurn, bool IsComplete);

record DraftContextResult(string? UserName, bool IsAdmin, MatchResponse? Match, IResult? Error);

record LiveMatchResult(LiveMatchResponse? LiveMatch, IResult? Error);

record DraftResponse(MatchResponse Match, string Status, IReadOnlyList<string> JoinedUsers, IReadOnlyList<string> DraftOrder, IReadOnlyList<string> DraftTurnOrder, IReadOnlyList<DraftPick> Picks, string? CurrentTurn, bool IsComplete);

record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups, bool HasStarted, bool HasFinished, string? Score = null);

record HomeMatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups, DraftResponse? Draft, bool HasStarted, bool HasFinished, string? Score = null);

record CachedHomeMatch(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, bool HasStarted, bool HasFinished, string? Score, DraftState? Draft);

record LineupResponse(string TeamName, string Formation, IReadOnlyList<StarterResponse> Starters, IReadOnlyList<StarterResponse> Bench);

record StarterResponse(string Name, int? Number, string? Position, string? Grid, int? GridRow, int? GridColumn);
