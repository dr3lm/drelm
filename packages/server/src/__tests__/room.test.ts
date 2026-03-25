import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../room.js';

// Minimal mock WebSocket for room tests
const mockWs = {} as never;

function makeClient(id: string, pubKey: string) {
  return { ws: mockWs, publicKey: pubKey, ephemeralId: id };
}

describe('RoomManager', () => {
  let rooms: RoomManager;

  beforeEach(() => {
    rooms = new RoomManager();
  });

  it('creates a room on first join', () => {
    const client = makeClient('a', 'pk-a');
    const room = rooms.joinRoom('room1', client);
    expect(room).not.toBeNull();
    expect(room!.clients.size).toBe(1);
    expect(rooms.getRoomCount()).toBe(1);
  });

  it('joins existing room', () => {
    rooms.joinRoom('room1', makeClient('a', 'pk-a'));
    const room = rooms.joinRoom('room1', makeClient('b', 'pk-b'));
    expect(room).not.toBeNull();
    expect(room!.clients.size).toBe(2);
    expect(rooms.getRoomCount()).toBe(1);
  });

  it('leaves room and cleans up empty rooms', () => {
    rooms.joinRoom('room1', makeClient('a', 'pk-a'));
    rooms.joinRoom('room1', makeClient('b', 'pk-b'));

    rooms.leaveRoom('room1', 'a');
    expect(rooms.getRoom('room1')?.clients.size).toBe(1);

    rooms.leaveRoom('room1', 'b');
    expect(rooms.getRoom('room1')).toBeUndefined();
    expect(rooms.getRoomCount()).toBe(0);
  });

  it('handles leave from nonexistent room', () => {
    rooms.leaveRoom('nonexistent', 'a');
    expect(rooms.getRoomCount()).toBe(0);
  });

  it('manages multiple rooms independently', () => {
    rooms.joinRoom('room1', makeClient('a', 'pk-a'));
    rooms.joinRoom('room2', makeClient('b', 'pk-b'));
    expect(rooms.getRoomCount()).toBe(2);

    rooms.leaveRoom('room1', 'a');
    expect(rooms.getRoomCount()).toBe(1);
    expect(rooms.getRoom('room2')?.clients.size).toBe(1);
  });
});
