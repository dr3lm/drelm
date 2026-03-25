# Threat Model

This document is honest about what drelm protects against,
what it does not, and where the boundaries are.

---

## Two-Layer Encryption

Before addressing individual threats, it is important to understand
that drelm's encryption is not a single layer. It is two
independent layers, each with a different purpose:

```
Layer 1 — Room Transport Key (outer)
  Derived from: the phrase, via Argon2id + HKDF
  Algorithm:    AES-256-GCM
  Purpose:      Makes real messages indistinguishable from CBR chaff.
                The server cannot parse, pattern-match, or entropy-analyze
                the payload. It is mathematically random-looking ciphertext.
  Who has it:   Everyone who knows the phrase.

Layer 2 — Double Ratchet (inner)
  Derived from: pairwise X25519 ECDH per peer pair
  Algorithm:    AES-256-GCM with ratcheted per-message keys
  Purpose:      Per-message forward secrecy. Each message uses a unique key
                that is deleted after use. Compromise of one key reveals
                one message. The DH ratchet provides post-compromise security.
  Who has it:   Only the two peers in the pair.
```

A message passes through both layers before reaching the wire.
The server sees only the output of Layer 1 — uniformly random bytes
identical in structure, length, and entropy to CBR chaff.

---

## What we protect against

### Passive network observer
An entity monitoring network traffic between you and the server.

**Protection:** Two layers of AES-256-GCM encryption plus TLS (clearnet)
or Tor (onion). The observer sees a constant stream of fixed-size
encrypted WebSocket frames at a fixed rate. There is no timing signal,
no volume signal, and no structural signal.

### Compromised server operator
The server operator, law enforcement with a warrant, or an attacker
who gains root access to the server.

**Protection:** The server is blind — not by policy, but by
cryptographic guarantee. Every MESSAGE payload on the wire is
720 characters of base64-encoded AES-256-GCM ciphertext. The room
transport key is derived from the phrase via HKDF with a dedicated
info string, and the server receives only a separate HKDF-derived
room hash — it cannot reverse HKDF to recover the Argon2 output,
and therefore cannot derive the room key.

A compromised operator who adds code to inspect payloads will find
only random-looking bytes. `JSON.parse()` fails. Pattern matching
fails. Entropy analysis is meaningless — both real messages and chaff
are maximum-entropy AES-256-GCM output. There is no heuristic,
statistical, or cryptanalytic method available to the server to
distinguish real traffic from noise.

The server stores nothing to disk. All state is in-memory. A server
restart erases everything. There is nothing to seize, subpoena, or
forensically recover.

**Limitation:** The server knows which IP addresses are connected to
which room hashes, and how many connections per room. On the clearnet
instance, IP addresses are visible. On the .onion instance, this is
mitigated by Tor's transport-layer anonymity.

### Compromised server performing active MITM
The server substitutes public keys during key exchange.

**Protection:** Visual fingerprints. Each user has a deterministic
identicon derived from their public key. Users can compare these
out-of-band (phone call, in person) to detect key substitution.

**Limitation:** This requires the users to actually verify. If they
don't check fingerprints, a MITM attack succeeds silently.

### Traffic analysis (timing)
An observer correlating message timing to identify participants.

**Protection:** Constant Bitrate Noise Generation. Every client sends
10 fixed-size packets per second, continuously. Real messages replace
chaff in the stream. There is no timing signal to correlate. The
server cannot tell which packets are real even if it inspects every
byte — both are AES-256-GCM ciphertext of identical length.

### Traffic analysis (volume)
An observer correlating message volume or burst patterns.

**Protection:** Fixed-size packets (720 characters each). Every packet
on the wire is exactly the same length, whether it is room-key-encrypted
ciphertext or random chaff bytes. There is no volume signal.

### Shoulder surfing / screen capture
An attacker looking at your screen while you type the phrase.

**Protection:** The phrase input masks each character after a brief
flash (600ms), replacing it with a bullet character. The phrase is
never fully visible on screen at once.

**Limitation:** A screen recording at sufficient frame rate could
capture individual characters during the flash window.

### Phrase brute-force
An attacker trying to guess the phrase to join a room.

**Protection:** Argon2id with 64MB memory cost, 3 iterations. This
makes brute-force computationally expensive. However, the strength
ultimately depends on the phrase. A weak phrase (e.g., "test") is
guessable regardless of the hash function.

**Recommendation:** Use a phrase with at least 5 random words.

### Recorded traffic + later key compromise
An attacker records all encrypted traffic, then later compromises
a participant's device.

**Protection:** Double Ratchet forward secrecy. Each message is
encrypted with a unique key derived from a ratcheting chain. After
encryption, the key is deleted. Past messages used keys that no
longer exist in memory or anywhere else.

### Temporary device compromise
An attacker gains brief access to a participant's ratchet state.

**Protection:** Double Ratchet post-compromise security. The DH
ratchet engages when the conversation direction changes. Each
direction change mixes fresh random key material into the chain.
Even if an attacker captures the current ratchet state, the next
DH ratchet step locks them out.

---

## What we do NOT protect against

### Endpoint compromise
If your device is compromised (malware, keylogger, screen capture),
drelm cannot help. The message is decrypted in your browser —
anything with access to your browser can read it.

### Phrase sharing
The phrase is the entire authentication model. Anyone who knows the
phrase can join the room and read messages. There is no mechanism to
verify someone's identity beyond the phrase itself. If the phrase leaks,
the room is compromised.

### Screenshot / copy-paste
There is nothing preventing a participant from screenshotting messages
or copying text. drelm protects messages in transit and at rest
(there is no "at rest" — everything is ephemeral). It does not and
cannot prevent a participant from exfiltrating content.

### Room membership enumeration
The server knows how many clients are in each room. An attacker with
server access can see that room hash X has N connections. They cannot
read the messages, but they know the room exists and how many people
are in it.

### Correlation via room hash
If an attacker knows the phrase, they can compute the room hash and
check if that room exists on the server. This confirms that someone
is using that phrase right now.

### Browser vulnerabilities
drelm runs in the browser. A browser zero-day could expose
private keys, decrypted messages, or the phrase before it is hashed.
We mitigate this by keeping the client simple and auditable, but we
cannot protect against vulnerabilities in the browser itself.

---

## Trust boundaries

```
TRUSTED:       Your browser, your device
UNTRUSTED:     The server, the network, other participants (beyond the phrase)
VERIFIED:      Public keys (via visual fingerprints, if users check them)
NOT VERIFIED:  Identity of other participants (anyone with the phrase can join)
```

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

The clearnet instance is not "less secure" in terms of message
confidentiality. The only difference is IP visibility.
