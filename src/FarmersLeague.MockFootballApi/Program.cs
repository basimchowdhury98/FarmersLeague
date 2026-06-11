var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

const int EventId = 1001;

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/api/v1/unique-tournament/{tournamentId:int}/season/{seasonId:int}/events/next/{page:int}", (int tournamentId, int seasonId, int page) =>
{
    if (page > 0)
    {
        return Results.Ok(new { events = Array.Empty<object>() });
    }

    var canada = Team(50, "Canada", "CAN");
    var mexico = Team(42, "Mexico", "MEX");
    var kickoff = new DateTimeOffset(DateTimeOffset.UtcNow.UtcDateTime.Date, TimeSpan.Zero).AddDays(1).AddTicks(-1);

    return Results.Ok(new
    {
        events = new[]
        {
            new
            {
                id = EventId,
                slug = "canada-mexico",
                customId = "mock-can-mex",
                startTimestamp = kickoff.ToUnixTimeSeconds(),
                status = new { code = 0, description = "Not started", type = "notstarted" },
                tournament = new
                {
                    id = 3954,
                    name = "FIFA World Cup, Group A",
                    slug = "world-championship-gr-a",
                    uniqueTournament = new { id = tournamentId, name = "FIFA World Cup", slug = "world-championship" }
                },
                season = new { id = seasonId, name = "World Cup 2026", year = "2026" },
                roundInfo = new { round = 1 },
                homeTeam = canada,
                awayTeam = mexico
            }
        }
    });
});

app.MapGet("/api/v1/event/{eventId:int}/lineups", (int eventId) =>
{
    if (eventId != EventId)
    {
        return Results.NotFound();
    }

    return Results.Ok(new
    {
        confirmed = true,
        home = Lineup("4-3-3", [
            Starter("Dayne St. Clair", 1, "G", false),
            Starter("Alistair Johnston", 2, "D", false),
            Starter("Kamal Miller", 4, "D", false),
            Starter("Alphonso Davies", 19, "D", false),
            Starter("Ismaël Koné", 8, "M", false),
            Starter("Jonathan Osorio", 21, "M", false),
            Starter("Nathan Saliba", 15, "M", false),
            Starter("Tajon Buchanan", 11, "F", false),
            Starter("Jonathan David", 10, "F", false),
            Starter("Cyle Larin", 17, "F", false),
            Starter("Stephen Eustáquio", 7, "D", false),
            Starter("Maxime Crépeau", 16, "G", true),
            Starter("Thomas McGill", 18, "G", true),
            Starter("Luc de Fougerolles", 3, "D", true),
            Starter("Moïse Bombito", 5, "D", true),
            Starter("Richie Laryea", 22, "D", true),
            Starter("Ali Ahmed", 20, "D", true),
            Starter("Samuel Piette", 6, "M", true),
            Starter("Mathieu Choinière", 13, "M", true),
            Starter("Liam Millar", 23, "M", true),
            Starter("Jacob Shaffelburg", 14, "M", true),
            Starter("Thelonius Bair", 24, "F", true),
            Starter("Iké Ugbo", 12, "F", true),
            Starter("Tani Oluwaseyi", 25, "F", true),
            Starter("Junior Hoilett", 11, "F", true),
            Starter("Joel Waterman", 26, "D", true)
        ]),
        away = Lineup("4-3-3", [
            Starter("Raúl Rangel", 1, "G", false),
            Starter("Israel Reyes", 2, "D", false),
            Starter("César Montes", 3, "D", false),
            Starter("Johan Vásquez", 5, "D", false),
            Starter("Jesús Gallardo", 23, "D", false),
            Starter("Érik Lira", 6, "M", false),
            Starter("Orbelín Pineda", 18, "M", false),
            Starter("Brian Gutiérrez", 14, "M", false),
            Starter("Julián Quiñones", 9, "F", false),
            Starter("Raúl Jiménez", 11, "F", false),
            Starter("Roberto Alvarado", 25, "F", false),
            Starter("Luis Malagón", 12, "G", true),
            Starter("Julio González", 13, "G", true),
            Starter("Gerardo Arteaga", 6, "D", true),
            Starter("Jorge Sánchez", 19, "D", true),
            Starter("Jesús Orozco", 4, "D", true),
            Starter("Luis Romo", 7, "M", true),
            Starter("Edson Álvarez", 14, "M", true),
            Starter("Erick Sánchez", 16, "M", true),
            Starter("Carlos Rodríguez", 8, "M", true),
            Starter("Alexis Vega", 10, "F", true),
            Starter("Uriel Antuna", 15, "F", true),
            Starter("Santiago Giménez", 20, "F", true),
            Starter("Henry Martín", 21, "F", true),
            Starter("César Huerta", 22, "F", true),
            Starter("Marcelo Flores", 24, "M", true)
        ])
    });
});

app.Run();

static object Team(int id, string name, string nameCode) => new
{
    id,
    name,
    slug = name.ToLowerInvariant().Replace(' ', '-'),
    shortName = name,
    nameCode,
    national = true
};

static object Lineup(string formation, MockStarter[] players) => new
{
    players = players.Select(starter => new
    {
        player = new
        {
            name = starter.Name,
            shortName = starter.Name,
            position = starter.Position,
            jerseyNumber = starter.Number.ToString(),
            id = Math.Abs(starter.Name.GetHashCode())
        },
        shirtNumber = starter.Number,
        jerseyNumber = starter.Number.ToString(),
        position = starter.Position,
        substitute = starter.Substitute
    }),
    formation
};

static MockStarter Starter(string name, int number, string position, bool substitute) => new(name, number, position, substitute);

record MockStarter(string Name, int Number, string Position, bool Substitute);
