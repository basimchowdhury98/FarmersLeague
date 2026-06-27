using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

class LiveMatchTrackers(IConfiguration configuration)
{
    private readonly ConcurrentDictionary<int, LiveMatchTracker> trackers = [];

    public LiveMatchTracker Start(int matchId, LiveMatchResponse initialState, Func<CancellationToken, Task<LiveMatchResponse?>> refresh, ILogger logger)
    {
        return trackers.GetOrAdd(matchId, _ => new LiveMatchTracker(
            matchId,
            initialState,
            refresh,
            logger,
            RefreshInterval(),
            IsContinuousRefresh(),
            tracker => trackers.TryRemove(new KeyValuePair<int, LiveMatchTracker>(matchId, tracker))));
    }

    private TimeSpan RefreshInterval()
    {
        var seconds = int.TryParse(configuration["LiveMatches:RefreshIntervalSeconds"], out var configuredSeconds)
            ? configuredSeconds
            : 15;

        return TimeSpan.FromSeconds(Math.Clamp(seconds, 1, 3600));
    }

    private bool IsContinuousRefresh() => string.Equals(configuration["LiveMatches:RefreshMode"], "continuous", StringComparison.OrdinalIgnoreCase);

    public bool TryGetCurrent(int matchId, out LiveMatchResponse? current)
    {
        current = null;
        if (!trackers.TryGetValue(matchId, out var tracker))
        {
            return false;
        }

        current = tracker.Current;
        return current is not null;
    }

    public async Task Subscribe(int matchId, WebSocket socket, CancellationToken cancellationToken)
    {
        if (!trackers.TryGetValue(matchId, out var tracker))
        {
            return;
        }

        await tracker.Subscribe(socket, cancellationToken);
    }

    public void Unsubscribe(int matchId, WebSocket socket)
    {
        if (trackers.TryGetValue(matchId, out var tracker))
        {
            tracker.Unsubscribe(socket);
        }
    }

    public void Remove(int matchId)
    {
        if (trackers.TryRemove(matchId, out var tracker))
        {
            tracker.Stop();
        }
    }
}

class LiveMatchTracker
{
    private const string LiveMatchUpdateType = "liveMatchUpdate";
    private const string LiveMatchHeartbeatType = "liveMatchHeartbeat";
    private readonly int matchId;
    private readonly Func<CancellationToken, Task<LiveMatchResponse?>> refresh;
    private readonly ILogger logger;
    private readonly TimeSpan refreshInterval;
    private readonly bool continuousRefresh;
    private readonly Action<LiveMatchTracker> onStopped;
    private readonly ConcurrentDictionary<WebSocket, string> sockets = [];
    private readonly CancellationTokenSource stop = new();
    private readonly object currentLock = new();
    private int stopped;
    private LiveMatchResponse current;

    public LiveMatchTracker(int matchId, LiveMatchResponse initialState, Func<CancellationToken, Task<LiveMatchResponse?>> refresh, ILogger logger, TimeSpan refreshInterval, bool continuousRefresh, Action<LiveMatchTracker> onStopped)
    {
        this.matchId = matchId;
        current = initialState;
        this.refresh = refresh;
        this.logger = logger;
        this.refreshInterval = refreshInterval;
        this.continuousRefresh = continuousRefresh;
        this.onStopped = onStopped;

        _ = Run();
    }

    public LiveMatchResponse Current
    {
        get
        {
            lock (currentLock)
            {
                return current;
            }
        }
    }

    public async Task Subscribe(WebSocket socket, CancellationToken cancellationToken)
    {
        sockets.TryAdd(socket, string.Empty);
        await SendCurrent(socket, cancellationToken);
    }

    public void Unsubscribe(WebSocket socket)
    {
        sockets.TryRemove(socket, out _);
        if (sockets.IsEmpty)
        {
            Stop();
        }
    }

    public void Stop()
    {
        if (Interlocked.Exchange(ref stopped, 1) == 1)
        {
            return;
        }

        stop.Cancel();
        onStopped(this);
    }

    private async Task Run()
    {
        if (Current.FinalResult is not null)
        {
            Stop();
            return;
        }

        while (!stop.IsCancellationRequested)
        {
            try
            {
                var next = await refresh(stop.Token);
                if (next is not null)
                {
                    lock (currentLock)
                    {
                        current = next;
                    }

                    await Broadcast(sendHeartbeatWhenUnchanged: true, stop.Token);
                    if (next.FinalResult is not null)
                    {
                        Stop();
                        return;
                    }
                }

                await DelayBeforeNextRefresh();
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Live match tracker refresh failed for match {MatchId}", matchId);
                try
                {
                    await DelayBeforeNextRefresh();
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested)
                {
                    return;
                }
            }
        }
    }

    private Task DelayBeforeNextRefresh() => continuousRefresh
        ? Task.CompletedTask
        : Task.Delay(refreshInterval, stop.Token);

    private async Task Broadcast(bool sendHeartbeatWhenUnchanged, CancellationToken cancellationToken)
    {
        foreach (var socket in sockets.Keys)
        {
            await SendCurrent(socket, cancellationToken, sendHeartbeatWhenUnchanged);
        }
    }

    private async Task SendCurrent(WebSocket socket, CancellationToken cancellationToken, bool sendHeartbeatWhenUnchanged = false)
    {
        if (socket.State != WebSocketState.Open)
        {
            Unsubscribe(socket);
            return;
        }

        var current = Current;
        var payload = JsonSerializer.Serialize(current, AppJson.Options);
        if (sockets.TryGetValue(socket, out var lastPayload) && string.Equals(payload, lastPayload, StringComparison.Ordinal))
        {
            if (sendHeartbeatWhenUnchanged)
            {
                try
                {
                    await Send(socket, JsonSerializer.Serialize(new LiveMatchHeartbeatMessage(LiveMatchHeartbeatType), AppJson.Options), cancellationToken);
                }
                catch (WebSocketException)
                {
                    Unsubscribe(socket);
                }
            }

            return;
        }

        var message = new LiveMatchUpdateMessage(LiveMatchUpdateType, current.Match, current.Squads, current.FinalResult);
        try
        {
            await Send(socket, JsonSerializer.Serialize(message, AppJson.Options), cancellationToken);
            sockets[socket] = payload;
        }
        catch (WebSocketException)
        {
            Unsubscribe(socket);
        }
    }

    private async Task Send(WebSocket socket, string message, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(message);
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
    }
}
