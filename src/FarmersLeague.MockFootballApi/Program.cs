var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/v3/fixtures", (int? league, int? season) => Results.Ok(new
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
                home = new { id = 50, name = "Canada" },
                away = new { id = 42, name = "Mexico" }
            }
        }
    }
}));

app.Run();
