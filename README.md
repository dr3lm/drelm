

# <{{< drelm >}}>

ephemeral, blended, encrypted communication.

---

## How it works

A shared phrase is the room address and the key material. The server
never learns the phrase. Messages are end-to-end encrypted with the
Double Ratchet protocol. Every wire packet -- real or noise -- is
indistinguishable from random bytes. When the last person leaves,
the room is deleted from memory. There is no database. There is
nothing to subpoena.

### You open the page

A black screen. A blinking terminal cursor. Nothing has loaded from
any external server. No fonts, no analytics, no tracking pixels.
The entire application is a single HTML file running in your browser.

### You type a phrase

The phrase is the room. Anyone who types the same phrase ends up
in the same room. There is no account, no signup, no password.

The phrase never leaves your browser. Here is what happens to it:

1. **Argon2id hashing** -- the phrase is fed into Argon2id (64MB RAM,
   3 iterations). This produces a 32-byte hash. A separate HKDF
   derivation produces the room identifier sent to the server.
2. **The phrase is erased** -- immediately after hashing, the plaintext
   is cleared from memory. It is not stored anywhere.
3. **The server sees only an HKDF-derived hash** -- it cannot recover
   the phrase, and it cannot derive the room encryption key.

### You enter the room

1. Your browser generates a fresh **X25519 keypair**. The private key
   exists only in memory. Never saved to disk, never sent anywhere.
2. You get a random username like `amber-falcon-7`, generated from
   `crypto.getRandomValues()`, not from anything identifying.
3. Your public key is sent to the server with the room hash. The server
   tells you who else is in the room (their public keys).
4. For each person, your browser performs **ECDH key exchange** -- your
   private key + their public key = a shared secret only you two can compute.
5. Each shared secret feeds into a **Double Ratchet** -- a new unique
   encryption key for every single message. After each key is used,
   it is deleted.

### You send a message

Two layers of encryption before it hits the wire:

1. Your message text and username are bundled into JSON.
2. Encrypted **separately for each person** using their unique ratcheted
   key. 3 people = 3 different one-time keys. Each deleted after use.
   Each encrypted copy becomes its own packet.
3. Each per-peer packet is encrypted **again** with the room transport
   key -- derived from the phrase. The server does not have this key.
4. Each double-encrypted packet replaces a noise packet in the constant
   stream. 3 recipients = 3 packets over 300ms. To the server, the
   stream looks identical.
5. Recipients reverse the process: room-key decrypt, ratchet decrypt,
   read the message. Packets for other recipients are silently discarded.

### The constant noise

From the moment your browser connects -- before you even type a phrase --
it sends a **constant stream of packets**:

- 10 packets per second
- Every packet is exactly 720 characters
- Most are random noise (chaff)
- Real messages replace the next chaff packet

Both chaff and real messages are 720 characters of random-looking base64.
The server cannot tell them apart -- not by parsing (real messages are
encrypted, not JSON), not by pattern matching (AES output is random),
not by timing (constant rate), not by size (identical length).

Even a compromised server operator who writes custom analysis code cannot
distinguish real traffic from noise. This is a mathematical guarantee,
not a policy.

This costs about 19 MB per hour. That is the privacy tax.

### Visual fingerprints

Each person in the sidebar has a small colored grid icon next to their
name -- a deterministic pattern generated from their public key. Compare
out-of-band to detect MITM key substitution.

### You leave

Close the tab. Refresh. Click leave.

- Your private key is gone -- it was only in memory
- Your username is gone -- it was random and not stored
- The room is gone -- if you were the last person, the server deletes it
- The server has no record you were ever there

Nothing persists. That is the point.

---

## Security properties

- Phrase hashed with Argon2id (64MB, 3 iterations) client-side. Never transmitted.
- Two-layer encryption: Double Ratchet (per-message forward secrecy) +
  AES-256-GCM room transport key (server blindness)
- Constant Bitrate Noise: 5.4 KB/s continuous encrypted stream.
  Real messages are indistinguishable from chaff.
- Zero persistence: in-memory only, no logs, no database
- Non-extractable private keys: WebCrypto, memory only, die with the tab
- All randomness from `crypto.getRandomValues()`
- No external requests: zero CDN, zero analytics, zero tracking

---

## Two-layer encryption

Every message passes through two independent encryption layers:

```
Layer 1 -- Room Transport Key (outer)
  Derived from: the phrase, via Argon2id + HKDF
  Algorithm:    AES-256-GCM
  Purpose:      Makes real messages indistinguishable from CBR chaff.
                The server cannot parse, pattern-match, or entropy-analyze
                the payload. It is uniformly random ciphertext.
  Who has it:   Everyone who knows the phrase.

Layer 2 -- Double Ratchet (inner)
  Derived from: pairwise X25519 ECDH per peer pair
  Algorithm:    AES-256-GCM with ratcheted per-message keys
  Purpose:      Per-message forward secrecy. Each message uses a unique key
                that is deleted after use. Compromise of one key reveals
                one message. The DH ratchet provides post-compromise security.
  Who has it:   Only the two peers in the pair.
```

The server sees only the output of Layer 1 -- uniformly random bytes
identical in structure, length, and entropy to CBR chaff.

---

## Defense in depth

```
THREAT                          DEFEATED BY
------------------------------ ------------------------------------------
Server reads messages           AES-256-GCM via Double Ratchet
                                (unique key per message, server sees
                                only ciphertext)

Server sees who said what       Usernames inside encrypted payload
                                (server sees only ephemeral IDs)

Server sees when you talk       CBR constant bitrate noise
                                (10 identical packets/sec, always)

Network observer reads traffic  AES-256-GCM + TLS/Tor transport

Network observer sees timing    CBR noise (flat line, no spikes)

Network observer sees volume    Fixed-size packets (720 chars each)

Server swaps public keys (MITM) Visual fingerprint verification
                                (compare identicons out-of-band)

Phrase brute-force              Argon2id (64MB memory-hard hash)

Forensics on the server         Zero persistence (RAM only, no logs,
                                no disk, dies on restart)

Forensics on the client         No persistent storage (no cookies,
                                no localStorage, no IndexedDB,
                                keys in memory only)

Recorded traffic + later key    Double Ratchet forward secrecy
compromise                      (each message key is derived then
                                deleted -- old keys do not exist)

Temporary device compromise     Double Ratchet post-compromise
                                security (next DH ratchet step
                                mixes fresh randomness, attacker
                                locked out)

Phrase leaking from the UI      Masked input (bullet characters),
                                phrase erased immediately after hash

IP correlation (clearnet)       .onion instance available on
                                separate infrastructure
```

---

## What the wire looks like

```
TIME    PACKET    TYPE         TO THE SERVER, IT ALL LOOKS LIKE THIS
------- --------- ------------ -----------------------------------------
0.0s    pkt #1    chaff        {"type":"MESSAGE","payload":"xK9m..."}  720 chars
0.1s    pkt #2    chaff        {"type":"MESSAGE","payload":"R7fQ..."}  720 chars
0.2s    pkt #3    chaff        {"type":"MESSAGE","payload":"Nw2p..."}  720 chars
0.3s    pkt #4    REAL MSG     {"type":"MESSAGE","payload":"aB3x..."}  720 chars
0.4s    pkt #5    chaff        {"type":"MESSAGE","payload":"kL8v..."}  720 chars
0.5s    pkt #6    chaff        {"type":"MESSAGE","payload":"Ym4h..."}  720 chars
0.6s    pkt #7    chaff        {"type":"MESSAGE","payload":"Pq9r..."}  720 chars
0.7s    pkt #8    REAL MSG     {"type":"MESSAGE","payload":"Wn5t..."}  720 chars
0.8s    pkt #9    chaff        {"type":"MESSAGE","payload":"Jd2k..."}  720 chars
0.9s    pkt #10   chaff        {"type":"MESSAGE","payload":"Tv7m..."}  720 chars

                  ^                                                    ^
                  |                                                    |
            server cannot                                    all packets are
            tell which are                                   the same length
            real
```

---

## What dies when you close the tab

```
DESTROYED:
  X25519 private key (was only in JS memory)
  X25519 public key
  All pairwise AES-256-GCM keys
  All ECDH shared secrets
  Your random username
  The phrase (was already erased after hashing)
  The room hash (was derived, never stored)
  All decrypted message text
  The CBR engine and its queue

NEVER EXISTED:
  No cookies were set
  No localStorage was written
  No sessionStorage was written
  No IndexedDB records were created
  No service workers were registered
  No files were downloaded

ON THE SERVER:
  Room deleted (if you were the last to leave)
  Your connection state is garbage collected
  No logs of your visit exist
  No record of the room hash you joined
  No record of messages relayed
```

---

## Threat model

This section is honest about what drelm protects against,
what it does not, and where the boundaries are.

### What we protect against

**Passive network observer** -- Two layers of AES-256-GCM encryption
plus TLS (clearnet) or Tor (onion). The observer sees a constant
stream of fixed-size encrypted WebSocket frames at a fixed rate.
No timing signal, no volume signal, no structural signal.

**Compromised server operator** -- The server is blind by cryptographic
guarantee. Every MESSAGE payload is 720 characters of AES-256-GCM
ciphertext. The room transport key is derived from the phrase via HKDF,
and the server receives only a separate HKDF-derived room hash -- it
cannot derive the room key. `JSON.parse()` fails. Pattern matching fails.
Entropy analysis is meaningless. The server stores nothing to disk.

**Active MITM (server substitutes public keys)** -- Visual fingerprints.
Deterministic identicons derived from public keys. Compare out-of-band
to detect substitution. Limitation: requires users to actually verify.

**Traffic analysis (timing)** -- CBR. 10 fixed-size packets per second,
continuously. Real messages replace chaff. No timing signal.

**Traffic analysis (volume)** -- Fixed-size packets (720 chars each).
No volume signal.

**Shoulder surfing** -- Phrase input masks each character after 600ms.
Never fully visible. Limitation: screen recording could capture
characters during the flash window.

**Phrase brute-force** -- Argon2id with 64MB memory cost. Strength
ultimately depends on the phrase. Use at least 5 random words.

**Recorded traffic + later key compromise** -- Double Ratchet forward
secrecy. Each message key is derived then deleted. Past keys do not exist.

**Temporary device compromise** -- Double Ratchet post-compromise
security. Next DH ratchet step mixes fresh randomness. Attacker
locked out.

### What we do NOT protect against

**Endpoint compromise** -- If your device is compromised (malware,
keylogger), drelm cannot help. The message is decrypted in
your browser.

**Phrase sharing** -- Anyone who knows the phrase can join. If the
phrase leaks, the room is compromised. There is no identity
verification beyond the phrase.

**Screenshot / copy-paste** -- Cannot prevent a participant from
exfiltrating content. drelm protects messages in transit.
There is no "at rest" -- everything is ephemeral.

**Room membership enumeration** -- The server knows how many clients
are in each room. It cannot read messages, but it knows the room
exists and how many people are in it.

**Correlation via room hash** -- If an attacker knows the phrase,
they can compute the room hash and check if the room exists.

**Browser vulnerabilities** -- A browser zero-day could expose
private keys or the phrase before hashing. We mitigate this by
keeping the client simple and auditable.

### Trust boundaries

```
TRUSTED:        Your browser, your device
UNTRUSTED:      The server, the network, other participants
VERIFIED:       Public keys (via visual fingerprints, if users check them)
NOT VERIFIED:   Identity of other participants (anyone with the phrase can join)
```

---

## What the server knows

The server is blind -- not by policy, but by cryptographic design.

It **can** see:
- Which room hashes have active connections
- How many connections per room
- The public keys of connected clients (sent during JOIN)

It **cannot** see -- and mathematically cannot derive:
- The phrase (only an HKDF-derived hash reaches the server)
- Message contents (two layers of AES-256-GCM encryption)
- Usernames (inside the inner encrypted payload)
- When real messages are sent (CBR: constant rate, constant size)
- Whether any given packet is real or noise (both are AES ciphertext)

It stores nothing to disk. A server restart erases everything.
There is nothing to seize, subpoena, or forensically recover.

---

## Hosting model

Two tiers, identical code:

| | Clearnet | .onion |
|---|---|---|
| Two-layer encryption | Yes | Yes |
| CBR noise | Yes | Yes |
| Zero persistence | Yes | Yes |
| Server-blind guarantee | Yes | Yes |
| IP hidden from server | No | Yes (Tor) |
| IP hidden from network | No | Yes (Tor) |

The clearnet instance is not less secure in terms of message
confidentiality. The only difference is IP visibility.

---

## Stack

TypeScript. Vite. Vanilla DOM. WebCrypto API. Node.js. ws.

No UI framework. No database. No external crypto libraries
except argon2-browser (WASM, bundled inline).

```
packages/
  client/src/crypto/
    random.ts        Randomness (getRandomValues wrapper)
    argon2.ts        Phrase hashing + HKDF room key derivation
    keypair.ts       X25519 key generation
    exchange.ts      ECDH + HKDF key derivation
    aes.ts           AES-256-GCM encrypt/decrypt
    ratchet.ts       Double Ratchet
    cbr.ts           Constant bitrate noise engine
    peers.ts         Pairwise session management
    fingerprint.ts   Visual identity verification
  server/src/
    index.ts         WebSocket server entry
    room.ts          Room lifecycle
    handler.ts       Message handling + rate limiting
  types/src/
    protocol.ts      Shared protocol types + validation
```

~1200 lines of crypto code. You can read all of it in an afternoon.

---

## Verify it yourself

Do not trust us. Verify.

**No external requests in the main bundle:**

```bash
pnpm install && pnpm --filter @drelm/client build
grep -r 'https://' packages/client/dist/index.html
# Must return nothing.
```

**No persistent storage:**

```bash
grep -r 'localStorage\|sessionStorage\|indexedDB\|document.cookie' packages/client/src/
# Must return nothing.
```

**No Math.random (only a comment referencing the rule):**

```bash
grep -rn 'Math.random' packages/client/src/
# Only match is a comment in cbr.ts: "never Math.random()"
```

**Server is blind:**

```bash
grep -r 'console.log' packages/server/src/
# Must return nothing. Only console.error for startup messages.
```

**Run the tests:**

```bash
pnpm -r test    # 134 tests
```

Full verification guide: [docs/VERIFY.md](docs/VERIFY.md)

---

## Development

```
pnpm install
pnpm --filter @drelm/client dev    # :5173
pnpm --filter @drelm/server dev    # :3000
pnpm -r test                           # 134 tests
```

---

## Self-hosting

```
docker run -p 3000:3000 ghcr.io/ctc97/drelm:latest
```

See [docs/SELF_HOST.md](docs/SELF_HOST.md) for production deployment
with HTTPS and Tor.

---

## License

AGPLv3. If you run a modified version as a network service,
you must publish your modifications.
