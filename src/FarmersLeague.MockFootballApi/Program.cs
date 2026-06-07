var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/v3/fixtures", (int? league, int? season) =>
{
    var canada = Team(50, "Canada");
    var mexico = Team(42, "Mexico");

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
                    date = "2026-06-11T20:00:00+00:00"
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
                    Lineup(canada, [
                        "Dayne St. Clair",
                        "Alistair Johnston",
                        "Kamal Miller",
                        "Alphonso Davies",
                        "Ismaël Koné",
                        "Jonathan Osorio",
                        "Nathan Saliba",
                        "Tajon Buchanan",
                        "Jonathan David",
                        "Cyle Larin",
                        "Stephen Eustáquio"
                    ]),
                    Lineup(mexico, [
                        "Raúl Rangel",
                        "Israel Reyes",
                        "César Montes",
                        "Johan Vásquez",
                        "Jesús Gallardo",
                        "Érik Lira",
                        "Orbelín Pineda",
                        "Brian Gutiérrez",
                        "Julián Quiñones",
                        "Raúl Jiménez",
                        "Roberto Alvarado"
                    ])
                }
            }
        }
    });
});

app.Run();

static object Team(int id, string name) => new { id, name };

static object Lineup(object team, string[] starters) => new
{
    team,
    startXI = starters.Select(name => new
                    {
                        player = new { name }
                    })
};
