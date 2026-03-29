import type { ServerMessage } from '@drelm/types';
import { phraseToRoomHash, deriveRoomKey } from './crypto/argon2.js';
import { generateKeypair } from './crypto/keypair.js';
import { generateUsername } from './data/wordlists.js';
import { Connection } from './net/websocket.js';
import { PeerManager } from './crypto/peers.js';
import { generateFingerprint } from './crypto/fingerprint.js';
import { hexToBytes } from './crypto/random.js';
import { encryptForWire, decryptFromWire } from './crypto/cbr.js';
import type { UIElements } from './ui.js';
import {
  showLanding,
  showRoom,
  addMessage,
  updateUserCount,
  showJoinError,
  hideJoinError,
  renderUserList,
  updatePhraseHint,
} from './ui.js';
import { attachPhraseMask } from './phrase-mask.js';

function getWebSocketUrl(): string {
  const host = window.location.hostname;
  const isOnion = host.endsWith('.onion');
  const isSecure = window.location.protocol === 'https:';

  if (isOnion) return `ws://${host}/ws`;
  if (isSecure) return `wss://${host}/ws`;
  if (host === 'localhost' || host === '127.0.0.1') return `ws://${host}:3000`;
  return `ws://${host}/ws`;
}

const WS_URL = getWebSocketUrl();

interface AppState {
  username: string;
  connection: Connection | null;
  peers: PeerManager | null;
  roomKey: CryptoKey | null;
  ownFingerprint: string | null;
}

function refreshUserList(state: AppState, el: UIElements): void {
  if (!state.peers) return;
  const sessions = state.peers.getAllSessions();
  const named = sessions.filter((s) => s.name !== null);
  const anonymousCount = sessions.length - named.length;

  renderUserList(
    el,
    state.username,
    state.ownFingerprint,
    named.map((s) => ({ name: s.name as string, fingerprint: s.fingerprint })),
    anonymousCount,
  );
  updateUserCount(el, sessions.length + 1);
}

export function createApp(el: UIElements): void {
  const state: AppState = {
    username: generateUsername(),
    connection: null,
    peers: null,
    roomKey: null,
    ownFingerprint: null,
  };

  const phraseMask = attachPhraseMask(el.phraseInput);

  el.phraseInput.addEventListener('input', () => {
    updatePhraseHint(el, phraseMask.getValue().length);
  });

  el.phraseInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const phrase = phraseMask.getValue().trim();
      if (phrase.length === 0) return;

      hideJoinError(el);
      phraseMask.clear();
      el.phraseInput.blur();
      el.landingContent.classList.add('fading');
      joinRoom(phrase, state, el);
    }
  });

  el.messageInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = el.messageInput.value.trim();
      if (text.length === 0 || !state.connection || !state.peers) return;
      sendMessage(text, state, el);
    }
  });

  el.brandButton.addEventListener('click', () => {
    leaveRoom(state, el);
  });

  showLanding(el);
}

async function sendMessage(
  text: string,
  state: AppState,
  el: UIElements,
): Promise<void> {
  if (!state.connection || !state.peers || !state.roomKey) return;
  if (state.peers.peerCount === 0) {
    addMessage(el, state.username, text, false, true);
    el.messageInput.value = '';
    return;
  }

  // 1. Ratchet-encrypt the message per peer (one payload per recipient)
  const perPeerPayloads = await state.peers.encryptForPeers(state.username, text);

  // 2. Room-key encrypt each per-peer payload and enqueue into CBR stream.
  //    Each peer's packet replaces a chaff packet over the next N ticks.
  for (const payload of perPeerPayloads) {
    const encrypted = await encryptForWire(state.roomKey, payload);
    if (encrypted) {
      state.connection.sendMessage(encrypted);
    }
  }
  addMessage(el, state.username, text, false, true);
  el.messageInput.value = '';
}

async function joinRoom(
  phrase: string,
  state: AppState,
  el: UIElements,
): Promise<void> {
  hideJoinError(el);

  try {
    // Derive room hash and room transport key from the phrase
    const [roomHash, roomKey] = await Promise.all([
      phraseToRoomHash(phrase),
      deriveRoomKey(phrase),
    ]);

    const keypair = await generateKeypair();
    const peers = await PeerManager.create(keypair);

    const connection = new Connection(
      (msg: ServerMessage) => handleServerMessage(msg, state, el),
      () => {
        if (state.connection) {
          state.connection = null;
          state.peers?.clear();
          state.peers = null;
          state.roomKey = null;
          showLanding(el);
        }
      },
    );

    await connection.connect(WS_URL);

    state.connection = connection;
    state.peers = peers;
    state.roomKey = roomKey;
    state.username = generateUsername();
    state.ownFingerprint = await generateFingerprint(hexToBytes(peers.ownPubKeyHex));

    connection.send({
      type: 'JOIN',
      roomHash,
      publicKey: peers.ownPubKeyHex,
    });
  } catch {
    showJoinError(el, 'failed to connect');
  }
}

function handleServerMessage(
  msg: ServerMessage,
  state: AppState,
  el: UIElements,
): void {
  switch (msg.type) {
    case 'ROOM_JOINED': {
      showRoom(el);
      Promise.all(msg.peers.map((p) => state.peers?.addPeer(p.publicKey))).then(
        () => {
          refreshUserList(state, el);
          if (msg.peers.length > 0) {
            addMessage(
              el,
              '',
              `${msg.peers.length.toString()} other${msg.peers.length === 1 ? '' : 's'} in the room`,
              true,
            );
          }
        },
      );
      break;
    }

    case 'PEER_JOINED': {
      state.peers?.addPeer(msg.publicKey).then(() => {
        refreshUserList(state, el);
        addMessage(el, '', 'someone joined', true);
      });
      break;
    }

    case 'PEER_LEFT': {
      if (state.peers) {
        const session = state.peers.getSession(msg.publicKey);
        const name = session?.name;
        state.peers.removePeer(msg.publicKey);
        refreshUserList(state, el);
        addMessage(el, '', name ? `${name} left` : 'someone left', true);
      }
      break;
    }

    case 'MESSAGE': {
      decryptAndDisplay(msg.payload, state, el);
      break;
    }

    case 'ERROR': {
      addMessage(el, '', `error: ${msg.code}`, true);
      break;
    }
  }
}

async function decryptAndDisplay(
  wirePayload: string,
  state: AppState,
  el: UIElements,
): Promise<void> {
  if (!state.peers || !state.roomKey) return;

  // 1. Room-key decrypt — strips the CBR camouflage layer.
  //    Returns null for chaff (random bytes, not valid AES-GCM).
  const inner = await decryptFromWire(state.roomKey, wirePayload);
  if (!inner) return; // chaff — silently discard

  // 2. Ratchet decrypt — per-peer forward-secret decryption.
  const result = await state.peers.decryptMessage(inner);
  if (!result) return;

  addMessage(el, result.message.sender, result.message.text, false);
  refreshUserList(state, el);
}

function leaveRoom(state: AppState, el: UIElements): void {
  if (state.connection) {
    state.connection.send({ type: 'LEAVE' });
    state.connection.close();
    state.connection = null;
  }
  if (state.peers) {
    state.peers.clear();
    state.peers = null;
  }
  state.roomKey = null;
  showLanding(el);
}
