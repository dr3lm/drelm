import type { WebSocket } from 'ws';

export interface Client {
  ws: WebSocket;
  publicKey: string;
  ephemeralId: string;
}

export interface Room {
  clients: Map<string, Client>;
}

/** Maximum clients per room — prevents O(N^2) relay amplification. */
export const MAX_CLIENTS_PER_ROOM = 50;

/** Maximum total rooms — prevents memory exhaustion via room creation. */
export const MAX_ROOMS = 10000;

/**
 * Server state — the entire state of the application.
 * In-memory only. No database. No filesystem writes.
 */
export class RoomManager {
  private rooms: Map<string, Room> = new Map();

  getRoom(roomHash: string): Room | undefined {
    return this.rooms.get(roomHash);
  }

  /**
   * Join a room. Returns the Room on success, or null if limits are exceeded.
   */
  joinRoom(roomHash: string, client: Client): Room | null {
    let room = this.rooms.get(roomHash);

    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) return null;
      room = { clients: new Map() };
      this.rooms.set(roomHash, room);
    }

    if (room.clients.size >= MAX_CLIENTS_PER_ROOM) return null;

    room.clients.set(client.ephemeralId, client);
    return room;
  }

  leaveRoom(roomHash: string, ephemeralId: string): void {
    const room = this.rooms.get(roomHash);
    if (!room) return;

    room.clients.delete(ephemeralId);

    // Delete room if empty — ephemeral by design
    if (room.clients.size === 0) {
      this.rooms.delete(roomHash);
    }
  }

  getRoomCount(): number {
    return this.rooms.size;
  }
}
