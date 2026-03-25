# How to Verify drelm

This document tells you how to audit the code yourself.
You should not trust us. You should verify.

---

## The codebase is small

The entire security-critical code is in `packages/client/src/crypto/`.
There are 9 files. You can read all of them in an afternoon.

```
random.ts        ~30 lines    Randomness (getRandomValues wrapper)
argon2.ts        ~95 lines    Phrase hashing + HKDF room key derivation
keypair.ts       ~27 lines    X25519 key generation
exchange.ts      ~55 lines    ECDH + HKDF key derivation
aes.ts           ~59 lines    AES-256-GCM encrypt/decrypt
ratchet.ts       ~414 lines   Double Ratchet with skipped-key limits
cbr.ts           ~209 lines   Constant bitrate noise engine
peers.ts         ~191 lines   Pairwise session management
fingerprint.ts   ~79 lines    Visual identity verification
```

Total: ~1200 lines of crypto code. No external crypto libraries
except argon2-browser (WASM build of the reference C implementation).

---

## Step 1: Verify no external requests

Build the client and check the output:

```bash
pnpm install
pnpm --filter @drelm/client build

# Search for any external URLs in the bundle
grep -r 'https://' packages/client/dist/
# Must return nothing.

# Search for any http:// URLs (except localhost patterns)
grep -r 'http://' packages/client/dist/ | grep -v 'localhost' | grep -v '127.0.0.1'
# Must return nothing.
```

Open the built `packages/client/dist/index.html` in a browser with
the network tab open. You should see exactly one request: the page
itself. No fonts, no scripts, no tracking.

---

## Step 2: Verify phrase is never stored

In `packages/client/src/phrase-mask.ts`, verify that:

1. The real phrase is held in a local `let` variable, not a global
2. The `clear()` function zeros it to empty string
3. `clear()` is called before the phrase is passed to `joinRoom()`
4. The input field displays only bullet characters (•) after masking

In `packages/client/src/app.ts`, verify that:

1. `phraseMask.clear()` is called before `joinRoom()`
2. The phrase string is passed directly to `phraseToRoomHash()` and
   not stored in any state object

---

## Step 3: Verify no persistent storage


Search the entire client codebase for storage APIs:

```bash
grep -r 'localStorage' packages/client/src/
grep -r 'sessionStorage' packages/client/src/
grep -r 'IndexedDB\|indexedDB' packages/client/src/
grep -r 'document.cookie' packages/client/src/
```

All of these must return nothing.

---

## Step 4: Verify randomness source

```bash
grep -r 'Math.random' packages/client/src/
# Must return nothing.

grep -r 'getRandomValues' packages/client/src/
# Should show usage in random.ts and cbr.ts only.
```

All randomness must come from `crypto.getRandomValues()`.

---

## Step 5: Verify the server is blind

Read `packages/server/src/handler.ts`. The entire server logic is
~200 lines (includes rate limiting). Verify that:

1. The MESSAGE handler (`handleChatMessage`) relays `payload` without
   reading, parsing, or logging it.
2. No message content is ever written to `console.log`, a file, or
   a database.
3. The only state is `rooms: Map<string, Room>` — in-memory.
4. There are no `require('fs').writeFile` or equivalent calls.

```bash
grep -r 'writeFile\|appendFile\|createWriteStream' packages/server/src/
# Must return nothing (except the Tor hostname reader in index.ts, which only reads).

grep -r 'console.log' packages/server/src/
# Must return nothing. Only console.error is used, for startup messages only.
```

---

## Step 6: Verify two-layer encryption and CBR indistinguishability

This is the most critical verification. The server must not be able
to distinguish real messages from chaff — not just by size and timing,
but by content structure.

In `packages/client/src/crypto/cbr.ts`, verify:

1. `encryptForWire()` encrypts the payload with AES-256-GCM using
   the room key before it enters the CBR stream.
2. The plaintext is padded with random bytes (not a fixed character)
   to `INNER_PLAINTEXT_SIZE` before encryption.
3. The output is exactly `WIRE_PAYLOAD_SIZE` base64 characters.
4. `generateChaff()` produces random bytes of the same base64 length.
5. Both outputs are uniformly random base64 — no JSON structure visible.

In `packages/client/src/app.ts`, verify:

1. `sendMessage()` calls `encryptForWire(roomKey, payload)` before
   enqueuing into CBR.
2. `decryptAndDisplay()` calls `decryptFromWire(roomKey, payload)`
   and silently discards `null` results (chaff).

```bash
# Run the CBR tests — specifically the indistinguishability tests
pnpm --filter @drelm/client test -- --grep "cbr"
```

The tests verify:
- `generateChaff()` produces exactly `WIRE_PAYLOAD_SIZE` characters
- `encryptForWire()` output is exactly `WIRE_PAYLOAD_SIZE` characters
- Both are valid base64 (neither starts with `{` or any JSON marker)
- Chaff fails room-key decryption (returns null)
- Wrong key fails decryption (returns null)
- Round-trip encrypt/decrypt preserves the payload
- Short and long payloads produce identical wire sizes

---

## Step 7: Verify the crypto

```bash
# Run all crypto tests
pnpm --filter @drelm/client test
```

The test suite covers:
- Randomness: output length, uniqueness, type correctness
- Keypair: generation, export format, round-trip import
- ECDH: both parties derive the same key, different parties get different keys
- AES-GCM: round-trip encryption, wrong key fails, tampered ciphertext fails
- Double Ratchet: single message, multi-message, ping-pong, out-of-order, wrong session
- CBR: packet uniformity, timing, queue behavior

---

## Step 8: Verify the Argon2 parameters

In `packages/client/src/crypto/argon2.ts`, verify:

```
salt:        'drelm-v1'     (fixed, public domain separator)
time:        3                  (iterations)
mem:         65536              (64MB)
parallelism: 1
hashLen:     32                 (256 bits)
type:        Argon2id
```

These match or exceed the OWASP minimum recommendations for password
hashing. They are hardcoded constants, not configurable.

---

## Step 9: Check dependencies

```bash
# List all production dependencies
pnpm ls --prod --depth 0

# Expected (client):
#   argon2-browser
#
# Expected (server):
#   ws
```

That's it. Two runtime dependencies. Both are well-audited, widely
used, and do not make network requests.

---

## Step 10: Verify the Argon2 WASM binary

The only external cryptographic dependency is `argon2-browser` v1.18.0,
a WebAssembly build of the [reference Argon2 C implementation](https://github.com/nicbarker/argon2-browser).
The WASM binary is bundled inline — not loaded from a CDN.

Verify the integrity of the installed module:

```bash
# SHA-256 of the bundled JS file (contains embedded WASM)
# This is the file imported by packages/client/src/crypto/argon2.ts
shasum -a 256 node_modules/.pnpm/argon2-browser@1.18.0/node_modules/argon2-browser/dist/argon2-bundled.min.js
# Expected: 77c64b946baf1a5116dc591f4b9965d636b1b455f75edd2d4a587cb75e01687b

# SHA-256 of the standalone WASM binaries
shasum -a 256 node_modules/.pnpm/argon2-browser@1.18.0/node_modules/argon2-browser/dist/argon2.wasm
# Expected: 0c2149886c13e4eae4a6ca25ee71d47423c5c8740a874cf04ff816d1b2c901d7

shasum -a 256 node_modules/.pnpm/argon2-browser@1.18.0/node_modules/argon2-browser/dist/argon2-simd.wasm
# Expected: b1a948019a8f4a798401f3f6abc669d8ed5b2ffb3f6b59d08b7f74b6834f8620
```

If these hashes do not match, the installed module has been tampered with
or replaced. Do not use it. Reinstall from a trusted registry and verify again.

To rebuild from source and compare:

```bash
git clone https://github.com/nicbarker/argon2-browser.git
cd argon2-browser
git checkout v1.18.0
# Follow the build instructions in their README
# Compare the output WASM hashes against the values above
```

---

## What to look for if you don't trust us

1. **Does the phrase ever appear in a network request?** It should not.
   Only the HKDF-derived room hash is sent to the server — not the raw
   Argon2 output. The room transport key is derived via a separate HKDF
   call with different parameters, so the server cannot derive it.

2. **Does the private key get exported or sent anywhere?** It should not.
   It's generated with `extractable: false`.

3. **Does the server log anything identifying?** It should not.
   Grep for `console.log` — there should be none.

4. **Can the server read message content?** It should not.
   The payload is AES-256-GCM ciphertext, not JSON. The server does
   not have the room transport key (derived from the phrase).

5. **Can the server tell real messages from chaff?** It should not.
   Both are 720 characters of base64-encoded random-looking bytes.
   Real messages are AES-GCM ciphertext. Chaff is raw random bytes.
   Both are uniformly random, same length, same encoding. There is
   no structural, statistical, or cryptanalytic distinguisher.

6. **Are all packets the same size?** They should be.
   Every CBR packet is exactly `WIRE_PAYLOAD_SIZE` characters.

7. **Is there any `Math.random()` usage?** There should not be.
   All randomness is from `crypto.getRandomValues()`.

8. **Is the plaintext padded with random bytes before encryption?**
   It should be. In `encryptForWire()`, the payload is padded to
   `INNER_PLAINTEXT_SIZE` with `randomBytes()`, not a fixed character.
   This ensures the ciphertext reveals nothing about the payload length.

If any of these checks fail, something is wrong. File an issue.
