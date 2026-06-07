using System.Net.Http.Json;
using Microsoft.Extensions.Caching.Distributed;

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

builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration["Redis:ConnectionString"] ?? "localhost:6379";
    options.InstanceName = "FarmersLeague:";
});

var app = builder.Build();

await SeedLocalUsers(app.Services);

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/hello", () => new HelloResponse("Hello from FarmersLeague API"));

app.MapGet("/api/access/{passkey}", async (string passkey, IDistributedCache cache, CancellationToken cancellationToken) =>
{
    var userName = await cache.GetStringAsync(UserPasskeyCacheKey(passkey), cancellationToken);

    return userName is null
        ? Results.NotFound(new AccessResponse(false, null))
        : Results.Ok(new AccessResponse(true, userName));
});

app.MapGet("/api/matches", async (IHttpClientFactory httpClientFactory, CancellationToken cancellationToken) =>
{
    var footballApi = httpClientFactory.CreateClient("FootballApi");
    var fixtures = await footballApi.GetFromJsonAsync<ApiFootballFixturesResponse>(
        "/v3/fixtures?league=1&season=2026",
        cancellationToken);

    var matches = fixtures?.Response.Select(ToMatchResponse) ?? [];

    return Results.Ok(matches);
});

app.MapFallbackToFile("index.html");

app.Run();

static async Task SeedLocalUsers(IServiceProvider services)
{
    using var scope = services.CreateScope();
    var cache = scope.ServiceProvider.GetRequiredService<IDistributedCache>();

    var users = new[]
    {
        new TestUser("Alice", "11111111-1111-1111-1111-111111111111"),
        new TestUser("Bob", "22222222-2222-2222-2222-222222222222")
    };

    foreach (var user in users)
    {
        await cache.SetStringAsync(UserPasskeyCacheKey(user.Passkey), user.Name);
    }
}

static string UserPasskeyCacheKey(string passkey) => $"users:passkeys:{passkey}";

static MatchResponse ToMatchResponse(ApiFootballFixtureItem fixture) => new(
    fixture.Fixture.Id,
    fixture.Teams.Home.Name,
    fixture.Teams.Away.Name,
    fixture.League.Name,
    fixture.Fixture.Date,
    fixture.Lineups.Select(ToLineupResponse).ToArray());

static LineupResponse ToLineupResponse(ApiFootballLineup lineup) => new(
    lineup.Team.Name,
    lineup.StartXI.Select(starter => starter.Player.Name).ToArray());

record HelloResponse(string Message);

record AccessResponse(bool HasAccess, string? UserName);

record TestUser(string Name, string Passkey);

record MatchResponse(int Id, string HomeTeam, string AwayTeam, string League, DateTimeOffset Date, IReadOnlyList<LineupResponse> Lineups);

record LineupResponse(string TeamName, IReadOnlyList<string> Starters);

record ApiFootballFixturesResponse(IReadOnlyList<ApiFootballFixtureItem> Response);

record ApiFootballFixtureItem(ApiFootballFixture Fixture, ApiFootballLeague League, ApiFootballTeams Teams, IReadOnlyList<ApiFootballLineup> Lineups);

record ApiFootballFixture(int Id, DateTimeOffset Date);

record ApiFootballLeague(string Name);

record ApiFootballTeams(ApiFootballTeam Home, ApiFootballTeam Away);

record ApiFootballTeam(string Name);

record ApiFootballLineup(ApiFootballTeam Team, IReadOnlyList<ApiFootballStarter> StartXI);

record ApiFootballStarter(ApiFootballPlayer Player);

record ApiFootballPlayer(string Name);
