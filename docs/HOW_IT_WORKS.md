# How drelm Works

drelm is an ephemeral, end-to-end encrypted, anonymous group chat.
This document explains what happens when you use it, in plain English.

---

## You open the page

A black screen. A blinking terminal cursor in an empty white-bordered
box. Schools of ASCII fish drifting across the background. The word
"drelm" in the top left. Nothing else.

Nothing has loaded from any external server. No fonts, no analytics,
no tracking pixels. The entire application is a single HTML file
running in your browser. The font is your system's terminal font.

## You type a phrase

The phrase is the room. Anyone who types the same phrase ends up
in the same room. There is no account, no signup, no password.

As you type, each character flashes briefly then turns into a bullet
(•), like a password field on a phone. The phrase is never fully
visible on screen.

The phrase never leaves your browser. Here's what happens to it:

1. **Argon2id hashing** — the phrase is fed into Argon2id (a memory-hard
   hash function) with 64MB of RAM and 3 iterations. This produces a
   32-byte hash. Two separate HKDF derivations then produce the room
   identifier (sent to the server) and the room encryption key (kept
   client-side). The server cannot derive one from the other.

2. **The phrase is erased** — immediately after hashing, both the masked
   display and the internal plaintext are cleared from memory. The
   original text is not stored anywhere.

3. **The server sees only an HKDF-derived hash** — not the raw Argon2
   output. It has no way to recover the original phrase or derive the
   room encryption key.

## You enter the room

When you join:

1. Your browser generates a fresh **X25519 keypair** — a public key and
   a private key. The private key exists only in your browser's memory.
   It is never saved to disk, never sent anywhere.

2. You get a random username like `amber-falcon-7`. It's generated
   from random numbers, not from anything identifying about you.

3. Your public key is sent to the server along with the room hash.
   The server tells you who else is in the room (their public keys).

4. For each person in the room, your browser performs an **ECDH key
   exchange** — your private key + their public key = a shared secret
   that only the two of you can compute. This happens independently
   for every pair of people in the room.

5. Each shared secret feeds into a **Double Ratchet** — a protocol
   (used by Signal, WhatsApp, and others) that derives a new unique
   encryption key for every single message. After each key is used,
   it is deleted. You can't go backwards.

## You send a message

Your message goes through two layers of encryption before it hits
the wire:

1. Your message text and your username are bundled into a JSON object:
   `{sender: "amber-falcon-7", text: "hello"}`.

2. This is encrypted **separately for each person** in the room, using
   their unique ratcheted key. If there are 3 other people, your browser
   encrypts the message 3 times with 3 different one-time keys. Each
   key is deleted after use. Each encrypted copy becomes its own packet.

3. Each per-peer packet is encrypted **again** with the room transport
   key — a key derived from the phrase that only room members have. The
   server does not have this key. The output is random-looking bytes.

4. Each double-encrypted packet replaces a noise packet in the constant
   stream (see below). For 3 recipients, 3 noise packets are replaced
   over the next 300ms. To the server, the stream looks identical —
   random characters, same size, same rate.

5. Each recipient reverses the process: room-key decrypt → ratchet
   decrypt → read the message. Packets meant for other recipients are
   silently discarded.

## The constant noise

From the moment your browser connects to the server — before you even
type a phrase — it starts sending a **constant stream of packets**.

- 10 packets per second
- Every packet is exactly 720 characters
- Most of them are random noise ("chaff")
- When you send a real message, it replaces the next chaff packet

Both chaff and real messages are 720 characters of random-looking
base64. The server cannot tell them apart — not by parsing (real
messages are encrypted, not JSON), not by pattern matching (AES
output is random), not by timing (constant rate), not by size
(identical length).

Even a compromised server operator who writes custom analysis code
cannot distinguish real traffic from noise. This is a mathematical
guarantee, not a policy.

This costs about 19 MB per hour. That's the privacy tax.

## Visual fingerprints

Each person in the sidebar has a small colored grid icon next to their
name. This is a **visual fingerprint** — a deterministic pattern
generated from their public key.

If you and a friend are in the same room, you can verify over a phone
call or in person that you see the same icon for each other. If the
icons don't match, someone is tampering with the key exchange.

## You leave

Close the tab. Refresh the page. Click "leave."

- Your private key is gone — it was only in memory
- Your username is gone — it was random and not stored
- The room is gone — if you were the last person, the server deletes it
- The server has no record you were ever there

Nothing persists. That's the point.

---

## What the server knows

The server is blind — not by policy, but by cryptographic design.

It **can** see:
- Which room hashes have active connections
- How many connections per room
- The public keys of connected clients (sent during JOIN)

It **cannot** see — and mathematically cannot derive:
- The phrase (only an HKDF-derived hash reaches the server)
- Message contents (two layers of AES-256-GCM encryption)
- Usernames (inside the inner encrypted payload)
- When real messages are sent (CBR: constant rate, constant size)
- Whether any given packet is real or noise (both are AES ciphertext)

It stores nothing to disk. A server restart erases everything.
There is nothing to seize, subpoena, or forensically recover.
