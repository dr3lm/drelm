# Warrant Canary — Operator Guide

This document explains how to sign, update, and publish the
drelm warrant canary.

---

## What is a warrant canary?

A statement published regularly by the operator asserting that
they have NOT received secret legal demands (National Security
Letters, FISA orders, gag orders, etc.). If the statement
disappears or stops being updated, users should assume something
has changed.

The canary is PGP-signed so users can verify it was actually
written by the operator, not substituted by an attacker or
coerced third party.

---

## Files

```
packages/client/public/canary.txt    — the signed canary (served at /canary.txt)
packages/client/canary.html          — the display page (served at /canary.html)
docs/CANARY.md                       — this file
```

---

## Initial setup

### 1. Generate a dedicated PGP key (if you don't have one)

```bash
gpg --full-generate-key
# Choose: RSA and RSA, 4096 bits, does not expire
# Use an email address associated with the project
```

### 2. Publish your public key

```bash
# Export and publish to a keyserver
gpg --keyserver keys.openpgp.org --send-keys AA59B37E3EDD940B4C7E8F762189BF82F518016D

# Also export to a file for the repo (optional)
gpg --armor --export AA59B37E3EDD940B4C7E8F762189BF82F518016D > operator-pubkey.asc
```

### 3. Update the canary template

Edit `packages/client/public/canary.txt`:

1. Replace `XXXX XXXX ...` with your actual PGP key fingerprint
2. Replace `[operator email or secure contact method]` with your
   contact information
3. Update the date to the current date

### 4. Sign the canary

```bash
# Create the cleartext-signed canary
# Write the unsigned statement first:
cat > /tmp/canary-unsigned.txt << 'EOF'
drelm warrant canary
========================

As of YYYY-MM-DD, the operators of this drelm instance:

1. Have NOT received any National Security Letters or FISA court
   orders.

2. Have NOT received any gag orders preventing disclosure of
   government data requests.

3. Have NOT been subject to any searches or seizures of our
   servers or infrastructure.

4. Have NOT been compelled to modify the software to enable
   surveillance, weaken encryption, or insert backdoors.

5. Have NOT provided any user data, traffic logs, metadata,
   or encryption keys to any third party, government or
   otherwise.

6. Have NOT received any court orders requiring the logging
   of connection metadata, message content, or any other
   user-identifying information.

This canary is updated on the first day of each month. If this
statement is not updated for more than 60 days, or if it
disappears entirely, assume that one or more of the above
statements is no longer true.

This canary covers all drelm infrastructure including:
  - The clearnet instance (drelm.org)
  - The .onion instance
  - All associated servers, DNS, and domain registrars

Verification:
  - This statement is PGP-signed by the operator.
  - The signing key fingerprint is published below.
  - Verify the signature, not just the text.

Operator PGP key fingerprint:
  AA59 B37E 3EDD 940B 4C7E  8F76 2189 BF82 F518 016D

Contact: drelmorg@proton.me
EOF

# Sign it
gpg --clearsign --digest-algo SHA512 /tmp/canary-unsigned.txt

# The output is /tmp/canary-unsigned.txt.asc
# Copy it into place:
cp /tmp/canary-unsigned.txt.asc packages/client/public/canary.txt

# Clean up
rm /tmp/canary-unsigned.txt
```

### 5. Verify your own signature

```bash
gpg --verify packages/client/public/canary.txt
# Should show: Good signature from "Your Name <your@email>"
```

### 6. Deploy

The canary is served as a static file. Deploy with the client:

```bash
pnpm --filter @drelm/client build
# canary.txt is copied from public/ to dist/
# canary.html is built alongside index.html
```

---

## Monthly update procedure

Run this on the 1st of each month:

```bash
# 1. Update the date in the unsigned text
#    Change "As of YYYY-MM-DD" to today's date

# 2. Re-read the six statements — can you still truthfully assert
#    every one? If not, DO NOT SIGN. Remove the canary instead.

# 3. Sign
gpg --clearsign --digest-algo SHA512 /tmp/canary-unsigned.txt
cp /tmp/canary-unsigned.txt.asc packages/client/public/canary.txt

# 4. Verify
gpg --verify packages/client/public/canary.txt

# 5. Deploy
pnpm --filter @drelm/client build
# Deploy to production
```

---

## If you can no longer sign

If any of the six statements becomes untrue:

**Do not sign a false canary.** This is the entire point.

Instead:
- Remove `canary.txt` from the server, OR
- Stop updating it (let it go stale past 60 days)

The canary page (`canary.html`) will automatically display a
warning when the canary is older than 60 days or missing.

Do not explain why. Do not hint. The absence of the canary
is the signal.

---

## User verification

Users can verify the canary independently:

```bash
# Download
curl -s https://drelm.org/canary.txt -o canary.txt

# Verify PGP signature
gpg --verify canary.txt

# Check the date is recent (within 60 days)
grep "As of" canary.txt
```

The canary page at `/canary.html` also displays the canary with
a freshness indicator, but users should verify the PGP signature
themselves rather than trusting the page alone.
