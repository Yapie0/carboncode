import { randomUUID } from "node:crypto";
import { generatePuzzle } from "./puzzle-gen.js";
import { clearSubmissionCache, type Point, type SubmitResult } from "./game-engine.js";

export interface Player {
  id: string; name: string; joinedAt: number;
  submission?: SubmitResult; solved: boolean; solvedAt?: number;
}
export interface Puzzle { greenDots: Point[]; redDots: Point[]; }
export interface GameRoom {
  id: string; code: string; players: Player[]; puzzle: Puzzle;
  status: "waiting" | "playing" | "finished";
  createdAt: number; startedAt?: number; finishedAt?: number; winnerId?: string;
}

const rooms = new Map<string, GameRoom>();
const ROOM_CODE_LENGTH = 6;
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoom(playerName: string): GameRoom {
  const code = generateRoomCode();
  const room: GameRoom = {
    id: randomUUID(), code,
    players: [{ id: randomUUID(), name: playerName, joinedAt: Date.now(), solved: false }],
    puzzle: generatePuzzle(), status: "waiting", createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(code: string, playerName: string): GameRoom | null {
  const room = rooms.get(code.toUpperCase());
  if (!room || room.status !== "waiting" || room.players.length >= 2) return null;
  const player: Player = { id: randomUUID(), name: playerName, joinedAt: Date.now(), solved: false };
  room.players.push(player);
  room.status = "playing";
  room.startedAt = Date.now();
  clearSubmissionCache();
  return room;
}

export function getRoom(code: string): GameRoom | undefined { return rooms.get(code.toUpperCase()); }

export function listRooms(): GameRoom[] {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > 30 * 60 * 1000) rooms.delete(code);
  }
  return [...rooms.values()].filter(r => r.status === "waiting");
}

export function getPlayer(room: GameRoom, playerId: string): Player | undefined {
  return room.players.find(p => p.id === playerId);
}

export function setPlayerSubmission(room: GameRoom, playerId: string, result: SubmitResult): Player | undefined {
  const player = getPlayer(room, playerId);
  if (!player) return undefined;
  player.submission = result;
  if (result.solved) { player.solved = true; player.solvedAt = Date.now(); room.status = "finished"; room.finishedAt = Date.now(); room.winnerId = playerId; }
  return player;
}

export function resetRoom(room: GameRoom): void {
  room.puzzle = generatePuzzle(); room.status = "waiting";
  room.startedAt = undefined; room.finishedAt = undefined; room.winnerId = undefined;
  for (const p of room.players) { p.submission = undefined; p.solved = false; p.solvedAt = undefined; }
  clearSubmissionCache();
}

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  if (rooms.has(code)) return generateRoomCode();
  return code;
}
