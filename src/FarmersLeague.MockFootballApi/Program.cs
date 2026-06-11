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
                    ], [
                        Starter("Maxime Crépeau", 16, "G", null),
                        Starter("Thomas McGill", 18, "G", null),
                        Starter("Luc de Fougerolles", 3, "D", null),
                        Starter("Moïse Bombito", 5, "D", null),
                        Starter("Richie Laryea", 22, "D", null),
                        Starter("Ali Ahmed", 20, "D", null),
                        Starter("Samuel Piette", 6, "M", null),
                        Starter("Mathieu Choinière", 13, "M", null),
                        Starter("Liam Millar", 23, "M", null),
                        Starter("Jacob Shaffelburg", 14, "M", null),
                        Starter("Thelonius Bair", 24, "F", null),
                        Starter("Iké Ugbo", 12, "F", null),
                        Starter("Tani Oluwaseyi", 25, "F", null),
                        Starter("Junior Hoilett", 11, "F", null),
                        Starter("Joel Waterman", 26, "D", null)
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
                    ], [
                        Starter("Luis Malagón", 12, "G", null),
                        Starter("Julio González", 13, "G", null),
                        Starter("Gerardo Arteaga", 6, "D", null),
                        Starter("Jorge Sánchez", 19, "D", null),
                        Starter("Jesús Orozco", 4, "D", null),
                        Starter("Luis Romo", 7, "M", null),
                        Starter("Edson Álvarez", 14, "M", null),
                        Starter("Erick Sánchez", 16, "M", null),
                        Starter("Carlos Rodríguez", 8, "M", null),
                        Starter("Alexis Vega", 10, "F", null),
                        Starter("Uriel Antuna", 15, "F", null),
                        Starter("Santiago Giménez", 20, "F", null),
                        Starter("Henry Martín", 21, "F", null),
                        Starter("César Huerta", 22, "F", null),
                        Starter("Marcelo Flores", 24, "M", null)
                    ])
                }
            }
        }
    });
});

app.Run();

static object Team(int id, string name) => new { id, name };

static MockStarter Starter(string name, int number, string position, string? grid) => new(name, number, position, grid);

static object Lineup(object team, string formation, MockStarter[] starters, MockStarter[] substitutes) => new
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
                    }),
    substitutes = substitutes.Select(starter => new
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

record MockStarter(string Name, int Number, string Position, string? Grid);
