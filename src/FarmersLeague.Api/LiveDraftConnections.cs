using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

class LiveDraftConnections
{
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<WebSocket, byte>> socketsByMatch = [];

    public void Add(int matchId, WebSocket socket)
    {
        var sockets = socketsByMatch.GetOrAdd(matchId, _ => []);
        sockets.TryAdd(socket, 0);
    }

    public void Remove(int matchId, WebSocket socket)
    {
        if (socketsByMatch.TryGetValue(matchId, out var sockets))
        {
            sockets.TryRemove(socket, out _);
        }
    }

    public async Task Broadcast(int matchId, DraftResponse draft, CancellationToken cancellationToken)
    {
        if (!socketsByMatch.TryGetValue(matchId, out var sockets))
        {
            return;
        }

        foreach (var socket in sockets.Keys)
        {
            await Send(socket, draft, cancellationToken);
        }
    }

    public async Task Send(WebSocket socket, DraftResponse draft, CancellationToken cancellationToken)
    {
        if (socket.State != WebSocketState.Open)
        {
            return;
        }

        var payload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(draft, AppJson.Options));
        await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
    }
}
