public partial class FotMobWorldCupScraper
{
    private const string FixtureGameId = "1001";

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

    private static WorldCupLineupResponse FixtureLineup() => new(
        FixtureGameId,
        "confirmed",
        "fixture",
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
