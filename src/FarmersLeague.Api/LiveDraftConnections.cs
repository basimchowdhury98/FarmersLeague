using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

class LiveDraftConnections
{
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<WebSocket, LiveDraftConnection>> socketsByMatch = [];

    public void Add(int matchId, WebSocket socket, string userName, bool isAdmin)
    {
        var sockets = socketsByMatch.GetOrAdd(matchId, _ => []);
        sockets.TryAdd(socket, new LiveDraftConnection(userName, isAdmin));
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

    public async Task BroadcastDraftOrderReveal(int matchId, int revealedCount, CancellationToken cancellationToken)
    {
        await BroadcastMessage(matchId, new DraftOrderRevealMessage("draftOrderReveal", revealedCount), cancellationToken);
    }

    public async Task BroadcastDraftOrderRevealComplete(int matchId, CancellationToken cancellationToken)
    {
        await BroadcastMessage(matchId, new DraftOrderRevealCompleteMessage("draftOrderRevealComplete"), cancellationToken);
    }

    private async Task BroadcastMessage<T>(int matchId, T message, CancellationToken cancellationToken)
    {
        if (!socketsByMatch.TryGetValue(matchId, out var sockets))
        {
            return;
        }

        foreach (var socket in sockets.Keys)
        {
            await SendMessage(socket, message, cancellationToken);
        }
    }

    public async Task Send(WebSocket socket, DraftResponse draft, CancellationToken cancellationToken)
    {
        if (socket.State != WebSocketState.Open)
        {
            return;
        }

        await SendMessage(socket, draft, cancellationToken);
    }

    private static async Task SendMessage<T>(WebSocket socket, T message, CancellationToken cancellationToken)
    {
        if (socket.State != WebSocketState.Open)
        {
            return;
        }

        var payload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(message, AppJson.Options));
        await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken);
    }

    public bool IsAdmin(int matchId, WebSocket socket)
    {
        return socketsByMatch.TryGetValue(matchId, out var sockets)
            && sockets.TryGetValue(socket, out var connection)
            && connection.IsAdmin;
    }
}

record LiveDraftConnection(string UserName, bool IsAdmin);
