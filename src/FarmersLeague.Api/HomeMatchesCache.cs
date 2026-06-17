using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

static class HomeMatchesCache
{
    private const string CacheKey = "matches:world-cup-2026";

    public static async Task<IReadOnlyList<CachedHomeMatch>> GetOrHydrate(IDistributedCache cache, IWorldCupScraper scraper, CancellationToken cancellationToken)
    {
        var cachedMatches = await Get(cache, cancellationToken);
        if (cachedMatches.Count > 0)
        {
            return cachedMatches;
        }

        return await Hydrate(cache, scraper, cancellationToken);
    }

    public static async Task<IReadOnlyList<CachedHomeMatch>> Get(IDistributedCache cache, CancellationToken cancellationToken)
    {
        var cached = await cache.GetStringAsync(CacheKey, cancellationToken);

        return cached is null
            ? []
            : JsonSerializer.Deserialize<IReadOnlyList<CachedHomeMatch>>(cached, AppJson.Options) ?? [];
    }

    public static async Task<IReadOnlyList<CachedHomeMatch>> Hydrate(IDistributedCache cache, IWorldCupScraper scraper, CancellationToken cancellationToken)
    {
        var currentMatches = await Get(cache, cancellationToken);
        var draftsByMatchId = currentMatches
            .Where(match => match.Draft is not null)
            .ToDictionary(match => match.Id, match => match.Draft, EqualityComparer<int>.Default);

        var games = await scraper.GetGames(cancellationToken);
        var hydratedMatches = games
            .Select(ToCachedHomeMatch)
            .Where(match => match is not null)
            .Select(match => match!)
            .Select(match => draftsByMatchId.TryGetValue(match.Id, out var draft) ? match with { Draft = draft } : match)
            .OrderBy(match => match.Date)
            .ToArray();

        await Save(cache, hydratedMatches, cancellationToken);

        return hydratedMatches;
    }

    public static async Task<CachedHomeMatch?> GetMatch(IDistributedCache cache, IWorldCupScraper scraper, int matchId, CancellationToken cancellationToken)
    {
        var matches = await GetOrHydrate(cache, scraper, cancellationToken);

        return matches.FirstOrDefault(match => match.Id == matchId);
    }

    public static async Task<DraftState?> GetDraft(IDistributedCache cache, int matchId, CancellationToken cancellationToken)
    {
        var matches = await Get(cache, cancellationToken);
        var draft = matches.FirstOrDefault(match => match.Id == matchId)?.Draft;

        return draft is null ? null : DraftRules.Normalize(draft);
    }

    public static async Task SaveDraft(IDistributedCache cache, int matchId, DraftState draft, CancellationToken cancellationToken)
    {
        await UpdateDraft(cache, matchId, draft, cancellationToken);
    }

    public static async Task RemoveDraft(IDistributedCache cache, int matchId, CancellationToken cancellationToken)
    {
        await UpdateDraft(cache, matchId, null, cancellationToken);
    }

    private static async Task UpdateDraft(IDistributedCache cache, int matchId, DraftState? draft, CancellationToken cancellationToken)
    {
        var matches = await Get(cache, cancellationToken);
        var updatedMatches = matches
            .Select(match => match.Id == matchId ? match with { Draft = draft is null ? null : DraftRules.Normalize(draft) } : match)
            .ToArray();

        await Save(cache, updatedMatches, cancellationToken);
    }

    private static Task Save(IDistributedCache cache, IReadOnlyList<CachedHomeMatch> matches, CancellationToken cancellationToken) =>
        cache.SetStringAsync(CacheKey, JsonSerializer.Serialize(matches, AppJson.Options), cancellationToken);

    private static CachedHomeMatch? ToCachedHomeMatch(WorldCupGameResponse game)
    {
        if (!int.TryParse(game.Id, out var matchId))
        {
            return null;
        }

        return new CachedHomeMatch(
            matchId,
            game.HomeTeam.Name,
            game.AwayTeam.Name,
            "FIFA World Cup",
            game.StartTimeUtc,
            game.Status.Started,
            game.Status.Finished,
            game.Status.Score,
            null);
    }

}
