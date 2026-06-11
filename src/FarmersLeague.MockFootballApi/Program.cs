var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/v3/fixtures", (int? league, int? season) =>
{
    var canada = Team(50, "Canada");
    var mexico = Team(42, "Mexico");
    var kickoff = DateTimeOffset.UtcNow.Date.AddDays(1).AddTicks(-1);

    return Results.Ok(new
    {
        get = "fixtures",
        parameters = new { league, season },
        results = 1,
        response = new[]
        {
            new
            {
                fixture = new
                {
                    id = 1001,
                    date = kickoff
                },
                league = new
                {
                    id = league ?? 1,
                    name = "FIFA World Cup",
                    season = season ?? 2026
                },
                teams = new
                {
                    home = canada,
                    away = mexico
                },
                lineups = new[]
                {
                    Lineup(canada, "4-3-3", [
                        Starter("Dayne St. Clair", 1, "G", "1:1"),
                        Starter("Alistair Johnston", 2, "D", "2:1"),
                        Starter("Kamal Miller", 4, "D", "2:2"),
                        Starter("Alphonso Davies", 19, "D", "2:3"),
                        Starter("Ismaël Koné", 8, "M", "3:1"),
                        Starter("Jonathan Osorio", 21, "M", "3:2"),
                        Starter("Nathan Saliba", 15, "M", "3:3"),
                        Starter("Tajon Buchanan", 11, "F", "4:1"),
                        Starter("Jonathan David", 10, "F", "4:2"),
                        Starter("Cyle Larin", 17, "F", "4:3"),
                        Starter("Stephen Eustáquio", 7, "D", "2:4")
                    ]),
                    Lineup(mexico, "4-3-3", [
                        Starter("Raúl Rangel", 1, "G", "1:1"),
                        Starter("Israel Reyes", 2, "D", "2:1"),
                        Starter("César Montes", 3, "D", "2:2"),
                        Starter("Johan Vásquez", 5, "D", "2:3"),
                        Starter("Jesús Gallardo", 23, "D", "2:4"),
                        Starter("Érik Lira", 6, "M", "3:1"),
                        Starter("Orbelín Pineda", 18, "M", "3:2"),
                        Starter("Brian Gutiérrez", 14, "M", "3:3"),
                        Starter("Julián Quiñones", 9, "F", "4:1"),
                        Starter("Raúl Jiménez", 11, "F", "4:2"),
                        Starter("Roberto Alvarado", 25, "F", "4:3")
                    ])
                }
            }
        }
    });
});

app.Run();

static object Team(int id, string name) => new { id, name };

static MockStarter Starter(string name, int number, string position, string grid) => new(name, number, position, grid);

static object Lineup(object team, string formation, MockStarter[] starters) => new
{
    team,
    formation,
    startXI = starters.Select(starter => new
                    {
                        player = new
                        {
                            name = starter.Name,
                            number = starter.Number,
                            pos = starter.Position,
                            grid = starter.Grid
                        }
                    })
};

record MockStarter(string Name, int Number, string Position, string Grid);
