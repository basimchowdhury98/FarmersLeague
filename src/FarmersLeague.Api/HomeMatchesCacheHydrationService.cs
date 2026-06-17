using Microsoft.Extensions.Caching.Distributed;

public class HomeMatchesCacheHydrationService(
    IDistributedCache cache,
    IWorldCupScraper scraper,
    IConfiguration configuration,
    ILogger<HomeMatchesCacheHydrationService> logger) : BackgroundService
{
    private static readonly TimeZoneInfo EasternTimeZone = GetEasternTimeZone();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await TryHydrate("startup", stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = GetDelayUntilNextRefresh();
            logger.LogInformation("Next home matches cache hydration scheduled in {Delay}", delay);

            try
            {
                await Task.Delay(delay, stoppingToken);
                await TryHydrate("scheduled daily refresh", stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task TryHydrate(string reason, CancellationToken cancellationToken)
    {
        try
        {
            var matches = await HomeMatchesCache.Hydrate(cache, scraper, cancellationToken);
            logger.LogInformation("Home matches cache hydrated with {MatchCount} matches for {Reason}", matches.Count, reason);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Home matches cache hydration failed for {Reason}", reason);
        }
    }

    private TimeSpan GetDelayUntilNextRefresh()
    {
        var refreshHour = int.TryParse(configuration["WorldCupGamesCache:RefreshHourEastern"], out var configuredRefreshHour)
            ? configuredRefreshHour
            : 6;
        refreshHour = Math.Clamp(refreshHour, 0, 23);

        var nowEastern = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, EasternTimeZone);
        var nextRunLocal = new DateTime(
            nowEastern.Year,
            nowEastern.Month,
            nowEastern.Day,
            refreshHour,
            0,
            0,
            DateTimeKind.Unspecified);

        if (nextRunLocal <= nowEastern.DateTime)
        {
            nextRunLocal = nextRunLocal.AddDays(1);
        }

        var nextRunEastern = new DateTimeOffset(nextRunLocal, EasternTimeZone.GetUtcOffset(nextRunLocal));

        return nextRunEastern.ToUniversalTime() - DateTimeOffset.UtcNow;
    }

    private static TimeZoneInfo GetEasternTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time");
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time");
        }
    }
}
