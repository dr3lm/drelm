# Defense in Depth — How drelm Protects You

A visual walkthrough of every defensive layer, from the moment
you open the page to the moment you close the tab.

---

## The Full Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                             │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐  │
│  │  Phrase   │──▶│ Argon2id │──▶│ Room Hash│──▶│  Server    │  │
│  │  Input    │   │ 64MB,3it │   │ (32 byte)│   │  sees this │  │
│  └──────────┘   └──────────┘   └──────────┘   └────────────┘  │
│       │                                                         │
│       │ phrase erased from memory immediately                   │
│       ▼                                                         │
│  ┌──────────┐                                                   │
│  │ CLEARED  │  the phrase exists nowhere after this point       │
│  └──────────┘                                                   │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────────┐   │
│  │ X25519   │──▶│  ECDH    │──▶│ Double Ratchet session  │   │
│  │ Keypair  │   │ per peer │   │ per peer pair            │   │
│  └──────────┘   └──────────┘   └──────────────────────────┘   │
│       │                              │                          │
│       │ private key: memory only     │ every message gets a     │
│       │ never extractable            │ unique key, then the     │
│       │ never persisted              │ key is deleted           │
│       │                              ▼                          │
│       │                        ┌──────────┐                     │
│       │                        │ Encrypt  │                     │
│       │                        │ N times  │ (once per peer,     │
│       │                        │          │  unique key each)   │
│       │                        └──────────┘                     │
│       │                              │                          │
│       │                              ▼                          │
│       │                   ┌─────────────────┐                   │
│       │                   │ CBR Noise Engine │                   │
│       │                   │ 10 pkts/s fixed  │                  │
│       │                   │ 720 chars/pkt    │                  │
│       │                   └─────────────────┘                   │
│       │                         │    │                          │
│       │              ┌──────────┘    └──────────┐               │
│       │              ▼                          ▼               │
│       │     ┌──────────────┐          ┌──────────────┐          │
│       │     │ Real message │          │    Chaff     │          │
│       │     │ AES-GCM with │          │  (random)    │          │
│       │     │ room key     │          │  720 chars   │          │
│       │     │ = random b64 │          │  = random b64│          │
│       │     │ 720 chars    │          │              │          │
│       │     └──────────────┘          └──────────────┘          │
│       │              │                          │               │
│       │              └──────────┬───────────────┘               │
│       │                         │                               │
│       │                  BOTH are uniformly random              │
│       │                  base64 of identical length.            │
│       │                  JSON.parse, entropy analysis,          │
│       │                  pattern matching — none works.         │
│       │                         ▼                               │
└───────│─────────────────────────│───────────────────────────────┘
        │                         │
        │                         │  WebSocket
        │                         │  (TLS on clearnet,
        │                         │   Tor on .onion)
        │                         │
┌───────│─────────────────────────│───────────────────────────────┐
│       │         SERVER          │                               │
│       │                         ▼                               │
│       │    ┌──────────────────────────────┐                     │
│       │    │     Blind Relay              │                     │
│       │    │                              │                     │
│       │    │  • Cannot read messages      │                     │
│       │    │  • Cannot see usernames      │                     │
│       │    │  • Cannot tell real vs chaff │                     │
│       │    │  • Cannot see timing         │                     │
│       │    │  • Stores nothing to disk    │                     │
│       │    │  • Logs nothing              │                     │
│       │    │  • RAM only, dies on restart │                     │
│       │    │                              │                     │
│       │    │  Knows only:                 │                     │
│       │    │  • Room hashes (not phrases) │                     │
│       │    │  • Public keys               │                     │
│       │    │  • Connection count per room │                     │
│       │    └──────────────────────────────┘                     │
│       │                    │                                    │
│       │                    │ relays all packets                 │
│       │                    │ (real + chaff, indistinguishable)  │
│       │                    ▼                                    │
└───────│────────────────────│────────────────────────────────────┘
        │                    │
        │                    │  WebSocket
        │                    │
┌───────│────────────────────│────────────────────────────────────┐
│       │   OTHER USER'S     │   BROWSER                          │
│       │                    ▼                                    │
│       │       ┌─────────────────────┐                           │
│       │       │ Strip CBR padding   │                           │
│       │       └─────────────────────┘                           │
│       │                    │                                    │
│       │            ┌───────┴───────┐                            │
│       │            ▼               ▼                            │
│       │   ┌──────────────┐  ┌──────────────┐                   │
│       │   │ Decrypt with │  │ Decrypt fail │                   │
│       │   │ pairwise key │  │ = chaff      │                   │
│       │   │ ✓ success    │  │ silently     │                   │
│       │   └──────────────┘  │ discarded    │                   │
│       │            │        └──────────────┘                    │
│       │            ▼                                            │
│       │   ┌──────────────┐                                      │
│       │   │ Display msg  │                                      │
│       │   │ + username   │  (username was inside ciphertext)    │
│       │   └──────────────┘                                      │
│       │                                                         │
│       │   ┌──────────────┐                                      │
│       └──▶│ Fingerprint  │  deterministic identicon from        │
│           │ Verification │  public key — compare out-of-band    │
│           └──────────────┘  to detect MITM key substitution     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## What Each Layer Defeats

```
THREAT                          LAYER THAT DEFEATS IT
─────────────────────────────── ──────────────────────────────────
Server reads messages           AES-256-GCM via Double Ratchet
                                (unique key per message, server
                                sees only ciphertext)

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
                                deleted — old keys don't exist)

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

## The Lifecycle of a Message

```
YOU TYPE: "hello"
    │
    ▼
┌─────────────────────────────────────────────┐
│ 1. ENVELOPE                                 │
│    {sender: "arctic-bloom-3", text: "hello"} │
│    (your random username + message)          │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 2. ENCRYPT (per peer, Double Ratchet)       │
│    For each person in the room:             │
│    ratchet.encrypt(envelope) →              │
│    derives a unique one-time key from the   │
│    ratchet chain, encrypts with AES-256-GCM │
│    then DELETES the key. Cannot go back.    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 3. PER-PEER PACKETS                         │
│    One packet per recipient:                │
│    {                                        │
│      f: "sender_public_key_hex",            │
│      t: "recipient_public_key_hex",         │
│      m: ratchet_ciphertext                  │
│    }                                        │
│    N peers = N separate packets             │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 4. ROOM-KEY ENCRYPT (camouflage layer)      │
│    AES-GCM(roomKey, per_peer_json)          │
│    → random-looking base64 of exactly       │
│      720 characters                         │
│    The room key is derived from the phrase   │
│    via HKDF. Server doesn't have it.        │
│    This makes real messages indistinguishable│
│    from chaff at the application layer.     │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 5. QUEUE IN CBR                             │
│    Each per-peer packet replaces a chaff    │
│    packet in the constant 10-packet/sec     │
│    stream. N peers = N ticks to send all.   │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 6. ON THE WIRE                              │
│    {"type":"MESSAGE","payload":"<400chars>"} │
│                                             │
│    720 chars of base64 = random bytes.      │
│    Identical to chaff. Server cannot:       │
│    • JSON.parse it (it's ciphertext)        │
│    • Pattern-match it (AES output is random)│
│    • Measure entropy (both are max entropy) │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 7. SERVER                                   │
│    Relays payload to all room members       │
│    Cannot read it. Cannot tell it's real.   │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 8. RECIPIENT                                │
│    Room-key decrypt (AES-GCM) →             │
│    parse WirePayload JSON →                 │
│    find their ratchet ciphertext →          │
│    ratchet decrypt (unique per-msg key) →   │
│    read username + message                  │
│                                             │
│    Displays: arctic-bloom-3  hello          │
└─────────────────────────────────────────────┘
```

---

## The Lifecycle of a Chaff Packet

```
CBR TIMER FIRES (every 100ms)
    │
    │ no real message queued
    ▼
┌─────────────────────────────────────────────┐
│ 1. GENERATE                                 │
│    720 characters of cryptographically      │
│    random data (crypto.getRandomValues)     │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 2. SEND                                     │
│    {"type":"MESSAGE","payload":"<400chars>"} │
│                                             │
│    Identical structure to a real message    │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 3. SERVER                                   │
│    If client is in a room: relays to peers  │
│    If client is not in a room: silently     │
│    discarded (no room to relay to)          │
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ 4. RECIPIENT                                │
│    Room-key decrypt (AES-GCM) → FAILS       │
│    (random bytes are not valid ciphertext)  │
│    → returns null → silently discarded      │
│                                             │
│    User never knows this packet existed.    │
└─────────────────────────────────────────────┘
```

---

## What the Wire Looks Like

```
TIME    PACKET    TYPE         TO SERVER, IT ALL LOOKS LIKE THIS
─────── ───────── ──────────── ─────────────────────────────────
0.0s    pkt #1    chaff        {"type":"MESSAGE","payload":"xK9m..."}  720 chars
0.1s    pkt #2    chaff        {"type":"MESSAGE","payload":"R7fQ..."}  720 chars
0.2s    pkt #3    chaff        {"type":"MESSAGE","payload":"Nw2p..."}  720 chars
0.3s    pkt #4    REAL MSG     {"type":"MESSAGE","payload":"aB3x..."}  720 chars  ← "hello"
0.4s    pkt #5    chaff        {"type":"MESSAGE","payload":"kL8v..."}  720 chars
0.5s    pkt #6    chaff        {"type":"MESSAGE","payload":"Ym4h..."}  720 chars
0.6s    pkt #7    chaff        {"type":"MESSAGE","payload":"Pq9r..."}  720 chars
0.7s    pkt #8    REAL MSG     {"type":"MESSAGE","payload":"Wn5t..."}  720 chars  ← "how are you"
0.8s    pkt #9    chaff        {"type":"MESSAGE","payload":"Jd2k..."}  720 chars
0.9s    pkt #10   chaff        {"type":"MESSAGE","payload":"Tv7m..."}  720 chars

                  ▲                                                    ▲
                  │                                                    │
            server cannot                                    all packets are
            tell which are                                   the same length
            real
```

---

## What Dies When You Close the Tab

```
DESTROYED:
  ✗  X25519 private key (was only in JS memory)
  ✗  X25519 public key
  ✗  All pairwise AES-256-GCM keys
  ✗  All ECDH shared secrets
  ✗  Your random username
  ✗  The phrase (was already erased after hashing)
  ✗  The room hash (was derived, never stored)
  ✗  All decrypted message text
  ✗  The CBR engine and its queue

NEVER EXISTED:
  ✗  No cookies were set
  ✗  No localStorage was written
  ✗  No sessionStorage was written
  ✗  No IndexedDB records were created
  ✗  No service workers were registered
  ✗  No files were downloaded

ON THE SERVER:
  ✗  Room deleted (if you were the last to leave)
  ✗  Your connection state is garbage collected
  ✗  No logs of your visit exist
  ✗  No record of the room hash you joined
  ✗  No record of messages relayed
```

---

## Two Hosting Tiers

```
┌──────────────────────┐         ┌──────────────────────┐
│   CLEARNET           │         │   .ONION             │
│   drelm.org       │         │   abc...xyz.onion    │
│                      │         │                      │
│ ┌──────────────────┐ │         │ ┌──────────────────┐ │
│ │ E2E encryption ✓ │ │         │ │ E2E encryption ✓ │ │
│ │ CBR noise      ✓ │ │         │ │ CBR noise      ✓ │ │
│ │ Zero persist   ✓ │ │         │ │ Zero persist   ✓ │ │
│ │ Phrase hashing ✓ │ │         │ │ Phrase hashing ✓ │ │
│ │ Fingerprints   ✓ │ │         │ │ Fingerprints   ✓ │ │
│ │ Masked input   ✓ │ │         │ │ Masked input   ✓ │ │
│ └──────────────────┘ │         │ └──────────────────┘ │
│                      │         │                      │
│ IP visible to server │         │ IP hidden by Tor     │
│                      │         │                      │
│ Separate             │         │ Separate             │
│ infrastructure       │         │ infrastructure       │
│ & jurisdiction       │         │ & jurisdiction       │
└──────────────────────┘         └──────────────────────┘
          │                                │
          │      IDENTICAL CODE            │
          └────────────────────────────────┘
```
