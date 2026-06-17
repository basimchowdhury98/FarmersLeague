using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

class LiveMatchTrackers
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromSeconds(15);
    private readonly ConcurrentDictionary<int, LiveMatchTracker> trackers = [];

    public LiveMatchTracker Start(int matchId, LiveMatchResponse initialState, Func<CancellationToken, Task<LiveMatchResponse?>> refresh, ILogger logger)
    {
        return trackers.GetOrAdd(matchId, _ => new LiveMatchTracker(matchId, initialState, refresh, logger, RefreshInterval));
    }

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
    private readonly ConcurrentDictionary<WebSocket, string> sockets = [];
    private readonly CancellationTokenSource stop = new();
    private readonly object currentLock = new();
    private LiveMatchResponse current;

    public LiveMatchTracker(int matchId, LiveMatchResponse initialState, Func<CancellationToken, Task<LiveMatchResponse?>> refresh, ILogger logger, TimeSpan refreshInterval)
    {
        this.matchId = matchId;
        current = initialState;
        this.refresh = refresh;
        this.logger = logger;
        this.refreshInterval = refreshInterval;

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
    }

    public void Stop()
    {
        stop.Cancel();
    }

    private async Task Run()
    {
        if (Current.FinalResult is not null)
        {
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
                        stop.Cancel();
                        return;
                    }
                }

                await Task.Delay(refreshInterval, stop.Token);
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
                    await Task.Delay(refreshInterval, stop.Token);
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested)
                {
                    return;
                }
            }
        }
    }

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
