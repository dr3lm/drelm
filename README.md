

# <{{< drelm >}}>

ephemeral, blended, encrypted communication.

---

## What this is

A group chat that leaves no trace. No accounts. No history. No metadata.

You type a phrase. Anyone who types the same phrase is in the same room.
Every message is end-to-end encrypted with a unique key that's deleted
after use. The server relays packets but cannot read them, cannot tell
when you're talking, and cannot even distinguish real messages from noise.
When the last person leaves, the room is deleted from memory. There is
no database. There is nothing to recover.

---

## How it works

### The phrase

You see a black screen with a blinking cursor. You type a phrase.

The phrase is the room. It is also the key material. Here's exactly
what happens to it:

1. **Hashed with Argon2id** — a memory-hard function that requires 64MB
   of RAM per computation. This runs in your browser via WebAssembly.
   The output is a 32-byte hash. An attacker trying to brute-force
   phrases would need 64MB per guess — GPUs can't parallelize this cheaply.

2. **Split into two independent keys via HKDF** — the hash is derived
   into a *room address* (sent to the server so it knows which room you
   want) and a *room encryption key* (used to encrypt messages — the
   server never gets this). These two outputs are cryptographically
   independent. Knowing one gives zero information about the other.

3. **Erased** — the plaintext phrase is cleared from memory immediately
   after hashing. It existed for about 500 milliseconds.

The phrase is masked as you type — each character briefly visible, then
replaced with a bullet. The real value is held in a JavaScript closure
that the DOM cannot access. After hashing, even the closure is emptied.

### The keys

When you press Enter, your browser generates a fresh **X25519 keypair**.
The private key is created with `extractable: false` — even JavaScript
cannot read it out. It lives only inside the browser's WebCrypto engine.

Your public key is sent to the server along with the room hash. The
server tells you who else is in the room (their public keys). For each
peer, your browser performs **X25519 ECDH** — your private key combined
with their public key produces a shared secret that only you two can
compute. The server relayed the public keys but cannot derive the secret.

The shared secret is immediately fed into a **Double Ratchet** session,
then zeroed from memory.

### The Double Ratchet

This is the same core protocol Signal uses. drelm implements it from
scratch using WebCrypto primitives — no external library.

Every message gets its own unique encryption key, derived by advancing
a chain:

```
HMAC(chainKey, 0x01) → messageKey    (encrypt this message, then delete)
HMAC(chainKey, 0x02) → nextChainKey  (replace the old chain key)
```

You can't go backwards. Compromising the current key reveals nothing
about past messages — those keys no longer exist. This is **forward
secrecy**.

When the conversation direction changes (you were receiving, now you're
sending), the ratchet generates a **fresh X25519 keypair** and performs
a new ECDH exchange. This mixes completely fresh randomness into the
key chain. Even if an attacker compromised your session state, the next
direction change locks them out. This is **post-compromise security**.

### Sending a message

You type "hello" and press Enter. Here's what happens:

1. Your text and username are JSON-encoded:
   `{"sender":"amber-falcon-7","text":"hello"}`

2. This is encrypted **separately for each peer** with their unique
   ratcheted key. 3 peers = 3 encryptions with 3 different one-time
   keys. Each key is deleted after use. Each encrypted copy becomes
   its own packet.

3. Each per-peer packet is encrypted **again** with the room transport
   key (Layer 1). The plaintext is padded with random bytes to a fixed
   size, then AES-256-GCM encrypted. The output is 720 characters of
   base64 — uniformly random, identical in structure to noise.

4. Each packet enters the constant bitrate stream, replacing the next
   scheduled noise packet. 3 peers = 3 packets over 300ms. The server
   sees no burst, no size change, no timing change.

5. Recipients decrypt Layer 1 (room key), check if the packet is
   addressed to them, decrypt Layer 2 (ratchet), and display the
   message. Packets for other recipients are silently discarded.

The server never sees: the message text, the sender's username,
which recipient each packet is for, or whether any given packet
contains a real message at all.

### The constant noise

This is the feature that almost no other encrypted chat implements.

Even with perfect encryption, a passive observer can learn a lot from
**traffic analysis**: when you send a message, how long it is, how
often you're talking, when a conversation gets heated. Signal doesn't
hide this. Matrix doesn't. WhatsApp doesn't.

drelm does. From the moment your browser connects — before you even
type a phrase — it sends a **constant stream of packets**:

```
10 packets per second
720 characters each
~5.4 KB/s = ~19 MB per hour
```

When you're silent, it sends noise. When you send a message, the
message replaces a noise packet. The stream never changes shape.

Both noise and real messages are 720 characters of random-looking
base64. The server cannot tell them apart:

- **Same size** — exactly 720 characters, always
- **Same encoding** — base64
- **Same content** — both are uniformly random (real = AES ciphertext, noise = `crypto.getRandomValues()`)
- **Same rate** — 10 per second, continuously

There is no statistical, structural, or cryptanalytic method to
distinguish them. This is a mathematical guarantee, not a promise.

```
TIME    PACKET    TYPE         SERVER SEES THIS
------- --------- ------------ -----------------------------------------
0.0s    pkt #1    noise        {"type":"MESSAGE","payload":"xK9m..."}  720 chars
0.1s    pkt #2    noise        {"type":"MESSAGE","payload":"R7fQ..."}  720 chars
0.2s    pkt #3    noise        {"type":"MESSAGE","payload":"Nw2p..."}  720 chars
0.3s    pkt #4    REAL MSG     {"type":"MESSAGE","payload":"aB3x..."}  720 chars
0.4s    pkt #5    noise        {"type":"MESSAGE","payload":"kL8v..."}  720 chars
0.5s    pkt #6    noise        {"type":"MESSAGE","payload":"Ym4h..."}  720 chars

                  ^                                                    ^
                  |                                                    |
            server cannot                                    all packets are
            tell which                                       the same length
```

19 MB per hour is the privacy tax. On desktop, it's negligible.
On mobile, it's honest about the cost.

### Visual fingerprints

Each person in the sidebar has a small colored grid next to their name.
This is a **deterministic identicon** derived from their X25519 public
key via SHA-256 with a domain separation prefix.

If the server were substituting public keys (man-in-the-middle attack),
the fingerprints would be different. Compare them out-of-band — in
person, over a phone call, via screenshot — to verify the server hasn't
tampered with the key exchange.

### Leaving

Close the tab. Refresh. Click leave. It doesn't matter how.

```
DESTROYED:
  X25519 private key (only in WebCrypto memory)
  All pairwise ratchet keys
  All ECDH shared secrets
  Your random username
  The phrase (erased after hashing)
  All decrypted messages

NEVER EXISTED:
  No cookies, no localStorage, no sessionStorage
  No IndexedDB, no service workers
  No files downloaded, no cache entries

ON THE SERVER:
  Room deleted (if you were the last to leave)
  No logs of your visit
  No record of the room
  No record of any message
```

Nothing persists. That is the point.

---

## What the server knows

The server is blind — not by policy, but by math.

**It can see:**
- That a WebSocket connection exists
- Which room hash it joined (a 64-character hex string, irreversible)
- How many connections per room
- The public keys exchanged during join

**It cannot see — and cannot derive:**
- The phrase (only an HKDF output reached the server)
- Message contents (two layers of AES-256-GCM)
- Usernames (inside the inner encrypted payload)
- When real messages were sent (constant bitrate stream)
- Whether any packet is real or noise (both are random ciphertext)

It stores nothing to disk. A server restart erases everything.
There is nothing to seize, subpoena, or forensically recover.

---

## Security at a glance

```
THREAT                          DEFENSE
------------------------------ ------------------------------------------
Server reads messages           Two-layer AES-256-GCM (ratchet + room key)
Server sees who said what       Usernames inside encrypted payload
Server sees when you talk       Constant bitrate noise (10 pkts/s, always)
Network observer reads traffic  AES-256-GCM + TLS (clearnet) or Tor (.onion)
Network observer sees timing    CBR (flat line, no spikes)
Network observer sees volume    Fixed-size packets (720 chars each)
Server swaps public keys        Visual fingerprint verification
Phrase brute-force              Argon2id (64MB memory-hard)
Forensics on the server         Zero persistence (RAM only, no logs)
Forensics on the client         No persistent storage (keys in memory only)
Recorded traffic + key leak     Forward secrecy (each key derived then deleted)
Temporary device compromise     Post-compromise security (DH ratchet)
Phrase visible on screen        Masked input, erased after hash
IP correlation (clearnet)       .onion instance on separate infrastructure
```

### What we do NOT protect against

**Compromised device** — malware on your machine can read your screen
and your memory. No software can protect against this.

**Phrase sharing** — anyone with the phrase can join. If it leaks,
the room is compromised.

**Screenshot / copy-paste** — a participant can exfiltrate content.
drelm protects messages on the wire, not on the screen.

**Room existence** — the server knows a room exists and how many
connections it has. It cannot read the room's contents.

**Browser vulnerabilities** — a zero-day could expose keys in memory.
Mitigated by keeping the client minimal and auditable.

---

## Hosting

Two tiers, identical code:

| | Clearnet | .onion |
|---|---|---|
| Two-layer encryption | Yes | Yes |
| Constant bitrate noise | Yes | Yes |
| Zero persistence | Yes | Yes |
| Server-blind guarantee | Yes | Yes |
| IP hidden from server | No | Yes (Tor) |

The clearnet instance is not less secure for message confidentiality.
The only difference is IP visibility.

---

## Stack

TypeScript everywhere. No framework. No database.

```
packages/
  client/src/crypto/
    random.ts        Randomness (getRandomValues only)
    argon2.ts        Phrase hashing + HKDF key derivation
    keypair.ts       X25519 key generation
    exchange.ts      ECDH shared secret derivation
    aes.ts           AES-256-GCM encrypt/decrypt
    ratchet.ts       Double Ratchet (Signal protocol)
    cbr.ts           Constant bitrate noise engine
    peers.ts         Pairwise session management
    fingerprint.ts   Visual identity verification
  server/src/
    index.ts         WebSocket server
    room.ts          Room lifecycle (in-memory only)
    handler.ts       Message relay + rate limiting
  types/src/
    protocol.ts      Shared wire protocol + validation
```

~1,500 lines of functional code. 134 tests.
You can read the entire crypto path in an afternoon.

---

## Verify it yourself

Do not trust us. Read the code.

```bash
# No external requests in the production bundle
pnpm install && pnpm --filter @drelm/client build
grep -r 'https://' packages/client/dist/index.html
# Must return nothing.

# No persistent storage
grep -r 'localStorage\|sessionStorage\|indexedDB\|document.cookie' packages/client/src/
# Must return nothing.

# No Math.random
grep -rn 'Math.random' packages/client/src/
# Only match is a comment: "never Math.random()"

# Server logs nothing about users
grep -r 'console.log' packages/server/src/
# Must return nothing. Only console.error for startup message.

# Run the tests
pnpm -r test    # 134 tests across crypto, integration, and security
```

Full verification guide: [docs/VERIFY.md](docs/VERIFY.md)

---

## Run it

```bash
pnpm install
pnpm --filter @drelm/client dev    # localhost:5173
pnpm --filter @drelm/server dev    # localhost:3000
pnpm -r test                       # 134 tests
```

---

## Self-host

```bash
docker run -p 3000:3000 ghcr.io/dr3lm/drelm:latest
```

Production deployment with HTTPS and Tor:
[docs/SELF_HOST.md](docs/SELF_HOST.md)

---

## License

AGPLv3. If you run a modified version as a network service,
you must publish your modifications.
