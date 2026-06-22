using System.Collections.Concurrent;

public partial class FotMobWorldCupScraper
{
    private const string MockGameId = "1001";
    private const string MockNoLineupGameId = "1002";
    private const string MockPredictedLineupGameId = "1003";
    private const string MockIncompleteBenchGameId = "1004";
    private const string FixtureGameId = "1001";
    private static readonly ConcurrentDictionary<string, WorldCupGameStatusResponse> MockGameStatusOverrides = new(StringComparer.Ordinal);

    public static void ResetMockGameStatus() => MockGameStatusOverrides.Clear();

    public static bool SetMockGameStatus(string gameId, bool started, bool finished, string? score = null)
    {
        if (!MockGames().Any(game => string.Equals(game.Id, gameId, StringComparison.Ordinal)))
        {
            return false;
        }

        MockGameStatusOverrides[gameId] = new WorldCupGameStatusResponse(started, finished, score, MockStatusReason(finished), null);

        return true;
    }

    private static IReadOnlyList<WorldCupGameResponse> MockGames() => ApplyMockStatusOverrides(
    [
        new(
            MockGameId,
            new WorldCupTeamResponse("50", "Canada", "CAN"),
            new WorldCupTeamResponse("42", "Mexico", "MEX"),
            "Group A",
            "1",
            "Group stage",
            DateTimeOffset.UtcNow.AddMinutes(30),
            new WorldCupGameStatusResponse(false, false, null, new WorldCupGameStatusReasonResponse(null, null, "Mock mode", null), null)),
        new(
            MockNoLineupGameId,
            new WorldCupTeamResponse("60", "Brazil", "BRA"),
            new WorldCupTeamResponse("70", "Japan", "JPN"),
            "Group B",
            "1",
            "Group stage",
            DateTimeOffset.UtcNow.AddMinutes(60),
            new WorldCupGameStatusResponse(false, false, null, new WorldCupGameStatusReasonResponse(null, null, "Mock mode", null), null)),
        new(
            MockPredictedLineupGameId,
            new WorldCupTeamResponse("80", "Argentina", "ARG"),
            new WorldCupTeamResponse("90", "Algeria", "ALG"),
            "Group C",
            "1",
            "Group stage",
            DateTimeOffset.UtcNow.AddMinutes(120),
            new WorldCupGameStatusResponse(false, false, null, new WorldCupGameStatusReasonResponse(null, null, "Mock mode", null), null)),
        new(
            MockIncompleteBenchGameId,
            new WorldCupTeamResponse("100", "Iraq", "IRQ"),
            new WorldCupTeamResponse("110", "Norway", "NOR"),
            "Group D",
            "1",
            "Group stage",
            DateTimeOffset.UtcNow.AddMinutes(30),
            new WorldCupGameStatusResponse(false, false, null, new WorldCupGameStatusReasonResponse(null, null, "Mock mode", null), null))
    ]);

    private static IReadOnlyList<WorldCupGameResponse> ApplyMockStatusOverrides(IReadOnlyList<WorldCupGameResponse> games) =>
        games
            .Select(game => MockGameStatusOverrides.TryGetValue(game.Id, out var status) ? game with { Status = status } : game)
            .ToArray();

    private static WorldCupLineupResponse? MockLineup(string gameId) => gameId switch
    {
        MockGameId => MockConfirmedLineup(),
        MockPredictedLineupGameId => MockPredictedLineup(),
        MockIncompleteBenchGameId => MockIncompleteBenchLineup(),
        _ => null
    };

    private static WorldCupLineupResponse MockConfirmedLineup() => CanadaMexicoLineup(MockGameId, "standard", "mock");

    private static WorldCupLineupResponse MockPredictedLineup() => new(
        MockPredictedLineupGameId,
        "predicted",
        "mock",
        new WorldCupLineupTeamResponse("80", "Argentina", "4-3-3", FixtureCanadaStarters(), FixtureCanadaBench()),
        new WorldCupLineupTeamResponse("90", "Algeria", "4-3-3", FixtureMexicoStarters(), FixtureMexicoBench()));

    private static WorldCupLineupResponse MockIncompleteBenchLineup() => new(
        MockIncompleteBenchGameId,
        "standard",
        "mock",
        new WorldCupLineupTeamResponse("100", "Iraq", "4-3-3", FixtureCanadaStarters(), FixtureCanadaBench().Take(5).ToArray()),
        new WorldCupLineupTeamResponse("110", "Norway", "4-3-3", FixtureMexicoStarters(), FixtureMexicoBench().Take(5).ToArray()));

    private WorldCupPlayerStatsResponse MockPlayerStats(string gameId, IReadOnlyList<string> requestedPlayers)
    {
        var step = Math.Min(Interlocked.Increment(ref mockPlayerStatsStep), 10);
        var lineup = MockConfirmedLineup();
        var players = MockLineupPlayers(lineup)
            .Select((player, index) => MockPlayerStatsPlayer(player.Team, player.Player, index, step))
            .ToArray();

        var status = MockGameStatusOverrides.GetValueOrDefault(gameId);

        return SelectRequestedPlayerStats(gameId, players, requestedPlayers, status);
    }

    private static IReadOnlyList<(WorldCupLineupTeamResponse Team, WorldCupLineupPlayerResponse Player)> MockLineupPlayers(WorldCupLineupResponse lineup) =>
    [
        .. lineup.HomeTeam.Starting11.Concat(lineup.HomeTeam.Bench).Select(player => (lineup.HomeTeam, player)),
        .. lineup.AwayTeam.Starting11.Concat(lineup.AwayTeam.Bench).Select(player => (lineup.AwayTeam, player))
    ];

    private static WorldCupPlayerStatsPlayerResponse MockPlayerStatsPlayer(WorldCupLineupTeamResponse team, WorldCupLineupPlayerResponse player, int playerIndex, int step)
    {
        var isGoalkeeper = player.PositionId == 0 || player.UsualPlayingPositionId == 0;
        var isSubstitute = player.PositionId is null;
        var activeStep = isSubstitute ? Math.Max(0, step - 6) : step;
        var scoringPlayerIndex = activeStep == 0 ? 0 : playerIndex;
        var goals = MockGoals(player.Name, step);
        var assists = MockAssists(player.Name, step);
        var shots = goals + (activeStep + scoringPlayerIndex % 4) / 3;
        var passes = isGoalkeeper ? 10 + activeStep * 2 : 12 + activeStep * 5 + playerIndex % 7;
        var tackles = isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex) / 4;
        var duelsWon = isGoalkeeper ? 0 : activeStep / 2 + scoringPlayerIndex % 3;
        var saves = isGoalkeeper ? MockSaves(team.Id, step) : 0;
        var crosses = isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 3) / 4;
        var longBalls = isGoalkeeper ? activeStep + 2 : activeStep / 2 + scoringPlayerIndex % 4;

        var categories = new List<WorldCupPlayerStatCategoryResponse>
        {
            new("attack", "Attack",
            [
                MockStat("goals", "Goals", goals),
                MockStat("expected_goals", "Expected goals", Math.Round(shots * 0.18m + goals * 0.35m, 2)),
                MockStat("expected_goals_on_target_variant", "Expected goals on target", Math.Round((goals + shots / 2) * 0.22m, 2)),
                MockStat("total_shots", "Total shots", shots),
                MockStat("ShotsOnTarget", "Shots on target", goals + shots / 2),
                MockStat("touches_opp_box", "Touches in opposition box", isGoalkeeper ? 0 : activeStep + scoringPlayerIndex % 5),
                MockStat("dribbles_succeeded", "Successful dribbles", isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 2) / 3),
                MockStat("big_chance_missed_title", "Big chances missed", isGoalkeeper ? 0 : activeStep / 8)
            ]),
            new("passes", "Passes",
            [
                MockStat("touches", "Touches", passes + activeStep * 2),
                MockStat("accurate_passes", "Accurate passes", passes),
                MockStat("assists", "Assists", assists),
                MockStat("expected_assists", "Expected assists", Math.Round(assists * 0.5m + activeStep * 0.03m, 2)),
                MockStat("chances_created", "Chances created", assists + activeStep / 4),
                MockStat("passes_into_final_third", "Passes into final third", isGoalkeeper ? activeStep / 5 : activeStep + scoringPlayerIndex % 4),
                MockStat("accurate_crosses", "Accurate crosses", crosses),
                MockStat("long_balls_accurate", "Accurate long balls", longBalls)
            ]),
            new("defense", "Defense",
            [
                MockStat("defensive_actions", "Defensive actions", tackles + activeStep / 2),
                MockStat("matchstats.headers.tackles", "Tackles", tackles),
                MockStat("interceptions", "Interceptions", isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 2) / 5),
                MockStat("shot_blocks", "Shot blocks", isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 3) / 6),
                MockStat("recoveries", "Recoveries", isGoalkeeper ? activeStep / 5 : activeStep / 2 + scoringPlayerIndex % 2),
                MockStat("clearances", "Clearances", isGoalkeeper ? activeStep / 6 : activeStep / 3 + scoringPlayerIndex % 3),
                MockStat("headed_clearance", "Headed clearances", isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 2) / 4),
                MockStat("dribbled_past", "Dribbled past", isGoalkeeper ? 0 : activeStep / 7)
            ]),
            new("duels", "Duels",
            [
                MockStat("duel_won", "Duels won", duelsWon),
                MockStat("duel_lost", "Duels lost", isGoalkeeper ? 0 : activeStep / 3),
                MockStat("ground_duels_won", "Ground duels won", duelsWon),
                MockStat("aerials_won", "Aerial duels won", isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 4) / 4),
                MockStat("fouls", "Fouls", isGoalkeeper ? 0 : activeStep / 5),
                MockStat("was_fouled", "Was fouled", isGoalkeeper ? 0 : (activeStep + 1) / 4),
                MockStat("dribbles_succeeded", "Successful dribbles", isGoalkeeper ? 0 : (activeStep + scoringPlayerIndex % 2) / 3),
                MockStat("matchstats.headers.tackles", "Tackles", tackles)
            ])
        };

        if (isGoalkeeper)
        {
            categories.Add(new("goalkeeping", "Goalkeeping",
            [
                MockStat("saves", "Saves", saves),
                MockStat("goals_conceded", "Goals conceded", MockGoalsConceded(team.Id, step)),
                MockStat("expected_goals_on_target_faced", "Expected goals on target faced", Math.Round(saves * 0.28m + MockGoalsConceded(team.Id, step) * 0.75m, 2)),
                MockStat("goals_prevented", "Goals prevented", Math.Round(saves * 0.15m - MockGoalsConceded(team.Id, step) * 0.1m, 2)),
                MockStat("keeper_sweeper", "Keeper sweeper", activeStep / 5),
                MockStat("keeper_high_claim", "High claims", activeStep / 4),
                MockStat("long_balls_accurate", "Accurate long balls", longBalls),
                MockStat("accurate_passes", "Accurate passes", passes)
            ]));
        }

        return new WorldCupPlayerStatsPlayerResponse(
            player.Id,
            null,
            player.Name,
            team.Id,
            team.Name,
            player.ShirtNumber?.ToString(),
            isGoalkeeper,
            categories);
    }

    private static int MockGoals(string playerName, int step) => playerName switch
    {
        "Jonathan David" when step >= 4 => 1,
        "Raul Jimenez" when step >= 7 => 1,
        "Alphonso Davies" when step >= 10 => 1,
        _ => 0
    };

    private static int MockAssists(string playerName, int step) => playerName switch
    {
        "Tajon Buchanan" when step >= 4 => 1,
        "Roberto Alvarado" when step >= 7 => 1,
        "Stephen Eustaquio" when step >= 10 => 1,
        _ => 0
    };

    private static int MockSaves(string teamId, int step) => teamId switch
    {
        "50" => step / 3,
        "42" => (step + 1) / 4,
        _ => 0
    };

    private static int MockGoalsConceded(string teamId, int step) => teamId switch
    {
        "50" when step >= 7 => 1,
        "42" when step >= 4 && step < 10 => 1,
        "42" when step >= 10 => 2,
        _ => 0
    };

    private static WorldCupPlayerStatResponse MockStat(string key, string label, object value) => new(key, label, "mock", value, null, null);

    private static IReadOnlyList<WorldCupGameResponse> FixtureGames() =>
    [
        new(
            FixtureGameId,
            new WorldCupTeamResponse("50", "Canada", "CAN"),
            new WorldCupTeamResponse("42", "Mexico", "MEX"),
            "Group A",
            "1",
            "Group stage",
            new DateTimeOffset(DateTimeOffset.UtcNow.UtcDateTime.Date, TimeSpan.Zero).AddDays(7),
            new WorldCupGameStatusResponse(false, false, null, null, null))
    ];

    private static WorldCupGameStatusReasonResponse MockStatusReason(bool finished) => finished
        ? new WorldCupGameStatusReasonResponse("FT", "fulltime_short", "Full-Time", "finished")
        : new WorldCupGameStatusReasonResponse(null, null, "Mock mode override", null);

    private static WorldCupLineupResponse FixtureLineup() => CanadaMexicoLineup(FixtureGameId, "confirmed", "fixture");

    private static WorldCupLineupResponse CanadaMexicoLineup(string gameId, string lineupType, string source) => new(
        gameId,
        lineupType,
        source,
        new WorldCupLineupTeamResponse("50", "Canada", "4-3-3", FixtureCanadaStarters(), FixtureCanadaBench()),
        new WorldCupLineupTeamResponse("42", "Mexico", "4-3-3", FixtureMexicoStarters(), FixtureMexicoBench()));

    private static IReadOnlyList<WorldCupLineupPlayerResponse> FixtureCanadaStarters() =>
    [
        FixturePlayer("can-1", "Dayne St. Clair", 1, 0),
        FixturePlayer("can-2", "Alistair Johnston", 2, 2),
        FixturePlayer("can-4", "Kamal Miller", 4, 2),
        FixturePlayer("can-19", "Alphonso Davies", 19, 2),
        FixturePlayer("can-8", "Ismael Kone", 8, 3),
        FixturePlayer("can-21", "Jonathan Osorio", 21, 3),
        FixturePlayer("can-15", "Nathan Saliba", 15, 3),
        FixturePlayer("can-11", "Tajon Buchanan", 11, 4),
        FixturePlayer("can-10", "Jonathan David", 10, 4),
        FixturePlayer("can-17", "Cyle Larin", 17, 4),
        FixturePlayer("can-7", "Stephen Eustaquio", 7, 2)
    ];

    private static IReadOnlyList<WorldCupLineupPlayerResponse> FixtureMexicoStarters() =>
    [
        FixturePlayer("mex-1", "Raul Rangel", 1, 0),
        FixturePlayer("mex-2", "Israel Reyes", 2, 2),
        FixturePlayer("mex-3", "Cesar Montes", 3, 2),
        FixturePlayer("mex-5", "Johan Vasquez", 5, 2),
        FixturePlayer("mex-23", "Jesus Gallardo", 23, 2),
        FixturePlayer("mex-18", "Erik Lira", 18, 3),
        FixturePlayer("mex-8", "Orbelin Pineda", 8, 3),
        FixturePlayer("mex-14", "Brian Gutierrez", 14, 3),
        FixturePlayer("mex-9", "Julian Quinones", 9, 4),
        FixturePlayer("mex-11", "Raul Jimenez", 11, 4),
        FixturePlayer("mex-19", "Roberto Alvarado", 19, 4)
    ];

    private static IReadOnlyList<WorldCupLineupPlayerResponse> FixtureCanadaBench() => Enumerable.Range(1, 15)
        .Select(index => FixturePlayer($"can-sub-{index}", $"Canada Substitute {index}", 30 + index, null))
        .ToArray();

    private static IReadOnlyList<WorldCupLineupPlayerResponse> FixtureMexicoBench() => Enumerable.Range(1, 15)
        .Select(index => FixturePlayer($"mex-sub-{index}", $"Mexico Substitute {index}", 40 + index, null))
        .ToArray();

    private static WorldCupLineupPlayerResponse FixturePlayer(string id, string name, int shirtNumber, int? positionId) =>
        new(id, name, null, null, shirtNumber, positionId, positionId, false, null);
}
