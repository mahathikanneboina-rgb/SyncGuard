import { WebSocketServer, WebSocket } from "ws";
import http from "http";

const PORT = parseInt(process.env.WS_PORT || "3001", 10);
const clients = new Set();

const server = http.createServer((req, res) => {
  // Allow internal HTTP POST requests to broadcast to all WebSocket clients
  if (req.method === "POST" && req.url === "/broadcast") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const event = JSON.parse(body);
        const payloadStr = JSON.stringify(event);
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(payloadStr);
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, clientCount: clients.size }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "SyncGuard WebSocket Server Active", port: PORT, clients: clients.size }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.send(
    JSON.stringify({
      type: "connected",
      timestamp: new Date().toISOString(),
      data: { message: "Connected to SyncGuard Real-Time WebSocket Server", port: PORT },
    })
  );

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        return;
      }

      // Broadcast received client event to all other clients
      const payloadStr = JSON.stringify(msg);
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(payloadStr);
        }
      }
    } catch {
      // ignore
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });

  ws.on("error", () => {
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`[SyncGuard] Real-Time WebSocket Server running on ws://localhost:${PORT}`);
});
