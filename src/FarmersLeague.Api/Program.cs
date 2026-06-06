using System.Net.Http.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});

builder.Services.AddHttpClient("FootballApi", client =>
{
    var baseUrl = builder.Configuration["FootballApi:BaseUrl"] ?? "http://localhost:5081";
    client.BaseAddress = new Uri(baseUrl);
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/hello", () => new HelloResponse("Hello from FarmersLeague API"));

app.MapGet("/api/matches", async (IHttpClientFactory httpClientFactory, CancellationToken cancellationToken) =>
{
    var footballApi = httpClientFactory.CreateClient("FootballApi");
    var fixtures = await footballApi.GetFromJsonAsync<ApiFootballFixturesResponse>(
        "/v3/fixtures?league=1&season=2026",
        cancellationToken);

    var matches = fixtures?.Response.Select(fixture => new MatchResponse(
        fixture.Fixture.Id,
        fixture.Teams.Home.Name,
        fixture.Teams.Away.Name,
        fixture.League.Name,
        fixture.Fixture.Date)) ?? [];

    return Results.Ok(matches);
});

app.MapFallbackToFile("index.html");

app.Run();

record HelloResponse(string Message);

record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date);

record ApiFootballFixturesResponse(IReadOnlyList<ApiFootballFixtureItem> Response);

record ApiFootballFixtureItem(ApiFootballFixture Fixture, ApiFootballLeague League, ApiFootballTeams Teams);

record ApiFootballFixture(int Id, DateTimeOffset Date);

record ApiFootballLeague(string Name);

record ApiFootballTeams(ApiFootballTeam Home, ApiFootballTeam Away);

record ApiFootballTeam(string Name);
