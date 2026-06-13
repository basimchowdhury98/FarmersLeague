class WorldCupGamesCacheHydrationService(
    WorldCupGamesCache gamesCache,
    IConfiguration configuration,
    ILogger<WorldCupGamesCacheHydrationService> logger) : BackgroundService
{
    private static readonly TimeZoneInfo EasternTimeZone = GetEasternTimeZone();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await gamesCache.TryHydrate("startup", force: true, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = GetDelayUntilNextRefresh();
            logger.LogInformation("Next World Cup games cache hydration scheduled in {Delay}", delay);

            try
            {
                await Task.Delay(delay, stoppingToken);
                await gamesCache.TryHydrate("scheduled daily refresh", force: true, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
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
