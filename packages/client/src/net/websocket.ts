import type { ClientMessage, ServerMessage } from '@drelm/types';
import { CBREngine } from '../crypto/cbr.js';

export type MessageHandler = (msg: ServerMessage) => void;
export type CloseHandler = () => void;

export class Connection {
  private ws: WebSocket | null = null;
  private handler: MessageHandler;
  private closeHandler: CloseHandler | null = null;
  private cbr: CBREngine;

  constructor(handler: MessageHandler, onClose?: CloseHandler) {
    this.handler = handler;
    this.closeHandler = onClose ?? null;

    this.cbr = new CBREngine((payload: string) => {
      this.sendRaw({ type: 'MESSAGE', payload });
    });
  }

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.cbr.start();
        resolve();
      };
      this.ws.onerror = () => reject(new Error('WebSocket connection failed'));

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.handler(msg);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.cbr.stop();
        this.ws = null;
        this.closeHandler?.();
      };
    });
  }

  /**
   * Send a control message (JOIN, LEAVE) directly — not through CBR.
   */
  send(msg: ClientMessage): void {
    if (msg.type === 'MESSAGE') {
      // Real messages MUST go through CBR
      this.cbr.enqueue(msg.payload);
      return;
    }
    this.sendRaw(msg);
  }

  /**
   * Enqueue a pre-encrypted payload into the CBR stream.
   * The payload must already be room-key encrypted via encryptForWire
   * (exactly WIRE_PAYLOAD_SIZE characters of base64).
   */
  sendMessage(encryptedPayload: string): void {
    this.cbr.enqueue(encryptedPayload);
  }

  close(): void {
    this.cbr.stop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
