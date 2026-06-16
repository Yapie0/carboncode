import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { submitSolution } from "./game-engine.js";
import { createRoom, getRoom, joinRoom, listRooms, setPlayerSubmission, resetRoom } from "./room-manager.js";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const clientDir = join(import.meta.dirname, "..", "client");

const httpServer = createServer((_req, res) => {
  const url = _req.url === "/" ? "/index.html" : _req.url ?? "/index.html";
  try {
    const filePath = join(clientDir, url);
    const ext = url.slice(url.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "text/plain" });
    res.end(readFileSync(filePath));
  } catch { res.writeHead(404); res.end("Not Found"); }
});

const wss = new WebSocketServer({ server: httpServer });
const connections = new Map<string, WebSocket>();

wss.on("connection", (ws) => {
  let playerId: string | null = null;

  ws.on("message", (raw) => {
    let msg: { type: string; payload?: Record<string, unknown> };
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "create_room": {
        const name = (msg.payload?.name as string) ?? "玩家";
        const room = createRoom(name);
        playerId = room.players[0]!.id;
        connections.set(playerId, ws);
        send(ws, "room_created", { room: sanitizeRoom(room), playerId });
        break;
      }
      case "join_room": {
        const code = (msg.payload?.code as string) ?? "";
        const name = (msg.payload?.name as string) ?? "玩家";
        const room = joinRoom(code, name);
        if (!room) { send(ws, "error", { message: "房间不存在、已满或已开始" }); return; }
        playerId = room.players[1]!.id;
        connections.set(playerId, ws);
        send(ws, "room_joined", { room: sanitizeRoom(room), playerId });
        broadcastRoom(room.code, "game_start", { room: sanitizeRoom(room) });
        break;
      }
      case "list_rooms": { send(ws, "room_list", { rooms: listRooms().map(sanitizeRoom) }); break; }
      case "submit": {
        if (!playerId) return;
        const expr = (msg.payload?.expr as string) ?? "";
        const roomCode = (msg.payload?.code as string) ?? "";
        const room = getRoom(roomCode);
        if (!room) return;
        const result = submitSolution(expr, room.puzzle, room.startedAt ?? Date.now());
        setPlayerSubmission(room, playerId, result);
        broadcastRoom(roomCode, "player_submitted", { playerId, playerName: room.players.find(p => p.id === playerId)?.name, result, expr });
        if (result.solved) {
          broadcastRoom(roomCode, "game_over", { winnerId: playerId, winnerName: room.players.find(p => p.id === playerId)?.name, room: sanitizeRoom(room) });
        }
        break;
      }
      case "rematch": {
        const roomCode = (msg.payload?.code as string) ?? "";
        const room = getRoom(roomCode);
        if (!room) return;
        resetRoom(room);
        broadcastRoom(roomCode, "rematch", { room: sanitizeRoom(room) });
        break;
      }
      case "chat": {
        if (!playerId) return;
        const text = (msg.payload?.text as string) ?? "";
        const roomCode = (msg.payload?.code as string) ?? "";
        const room = getRoom(roomCode);
        if (!room) return;
        const player = room.players.find(p => p.id === playerId);
        broadcastRoom(roomCode, "chat", { playerId, playerName: player?.name ?? "未知", text, time: Date.now() });
        break;
      }
    }
  });

  ws.on("close", () => { if (playerId) connections.delete(playerId); });
});

function send(ws: WebSocket, type: string, payload: Record<string, unknown> = {}): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, payload }));
}

function broadcastRoom(code: string, type: string, payload: Record<string, unknown>): void {
  const room = getRoom(code);
  if (!room) return;
  for (const player of room.players) {
    const ws = connections.get(player.id);
    if (ws) send(ws, type, payload);
  }
}

function sanitizeRoom(room: ReturnType<typeof getRoom> extends infer R ? R : never) {
  if (!room) return null;
  return {
    id: room.id, code: room.code,
    players: room.players.map(p => ({ id: p.id, name: p.name, solved: p.solved, solvedAt: p.solvedAt,
      submission: p.submission ? { passGreen: p.submission.passGreen, totalGreen: p.submission.totalGreen, hitRed: p.submission.hitRed, error: p.submission.error } : null,
    })),
    puzzle: room.puzzle, status: room.status, startedAt: room.startedAt,
  };
}

const PORT = 3000;
httpServer.listen(PORT, () => { console.log(`\n🔢 函数棋服务器已启动: http://localhost:${PORT}\n`); });
