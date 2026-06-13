class WorldCupGamesCache(FotMobWorldCupScraper scraper, ILogger<WorldCupGamesCache> logger)
{
    private static readonly TimeSpan MaxCacheAge = TimeSpan.FromHours(24);
    private readonly SemaphoreSlim hydrationLock = new(1, 1);
    private IReadOnlyList<WorldCupGameResponse>? games;
    private DateTimeOffset? lastHydratedUtc;

    public async Task<IReadOnlyList<WorldCupGameResponse>> GetGames(CancellationToken cancellationToken)
    {
        var cachedGames = games;
        if (cachedGames is null)
        {
            logger.LogWarning("World Cup games cache was empty during GET; hydrating synchronously. This should only happen before startup hydration completes or after a cold start.");
            await Hydrate(force: false, cancellationToken);

            return games ?? [];
        }

        if (IsStale())
        {
            _ = Task.Run(() => TryHydrate("stale-cache GET", force: false, CancellationToken.None), CancellationToken.None);
        }

        return cachedGames;
    }

    public async Task TryHydrate(string reason, bool force, CancellationToken cancellationToken)
    {
        try
        {
            await Hydrate(force, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "World Cup games cache hydration failed for {Reason}", reason);
        }
    }

    private async Task Hydrate(bool force, CancellationToken cancellationToken)
    {
        await hydrationLock.WaitAsync(cancellationToken);
        try
        {
            if (!force && games is not null && !IsStale())
            {
                return;
            }

            var refreshedGames = await scraper.GetGames(cancellationToken);
            games = refreshedGames;
            lastHydratedUtc = DateTimeOffset.UtcNow;
            logger.LogInformation("World Cup games cache hydrated with {GameCount} games", refreshedGames.Count);
        }
        finally
        {
            hydrationLock.Release();
        }
    }

    private bool IsStale()
    {
        return lastHydratedUtc is null || DateTimeOffset.UtcNow - lastHydratedUtc > MaxCacheAge;
    }
}
