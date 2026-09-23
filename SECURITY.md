# Security

## Reporting

Please report vulnerabilities privately via the repository's security advisory feature
(GitHub → Security → Report a vulnerability). Do not open public issues for security bugs.
You will get an answer within 7 days.

## Design goals

1. **Nothing leaves the device except ciphertext.** No server, no analytics, no crash
   reporting, no CDN. The Content-Security-Policy allows same-origin only; the only optional
   network contact is a STUN server (off by default) for direct links.
2. **Nothing is stored unless the user opts in.** Ephemeral mode keeps messages in RAM;
   locking wipes them. Identity, contacts and ratchet state must persist — they are
   encrypted with a key that exists only in memory while unlocked.
3. **Simple enough to reason about.** One protocol, one message format, no fallbacks that
   silently downgrade security.

## Cryptography

| Purpose | Primitive | Notes |
|---|---|---|
| Identity signatures | Ed25519 | `@noble/curves` |
| Key agreement | X25519 | `@noble/curves` |
| Post-quantum KEM | ML-KEM-768 | `@noble/post-quantum`; hybrid with X25519 in the handshake |
| KDF | HKDF-SHA-512 | `@noble/hashes` |
| AEAD | AES-256-GCM, 96-bit nonce, 128-bit tag | Web Crypto |
| Passphrase → key | Argon2id, 64 MiB, t=3, p=1 | `hash-wasm`; parameters stored with the vault |

### Contact handshake (offer / answer)

Alice shows an **offer**: her public bundle (Ed25519 + X25519), her ML-KEM public key, an
ephemeral X25519 key and her name — signed with her Ed25519 key. Bob scans it and answers
with his bundle, his ephemeral key, an ML-KEM ciphertext to Alice's KEM key and the hash of
the offer he is answering — signed. Both derive

```
SK ‖ CK_B0 = HKDF( 0xFF*32 ‖ DH(idA,idB) ‖ DH(ephA,idB) ‖ DH(idA,ephB) ‖ DH(ephA,ephB) ‖ KEM_ss )
```

This is the PQXDH pattern: an attacker must break X25519 *and* ML-KEM-768. Offer codes may
be reused (they are valid for 30 days); each answer still contributes fresh ephemeral and
KEM material.

The contact ID and the 60-digit safety number are derived from the two long-term classical
keys. **Users should compare safety numbers** in person or over a call: the QR/text exchange
itself is authenticated only by the channel it travels through.

### Messages — Double Ratchet

Messages follow the Signal Double Ratchet specification (X25519 ratchet, HKDF root chain,
HMAC symmetric chains, per-message keys) with one addition: the responder receives an
initial sending chain from the handshake so that **either side may send first** — there is no
server to order the first message. Headers are bound as AEAD associated data together with
a hash of both identities. Up to 500 skipped message keys are kept for out-of-order delivery,
which is the normal case when envelopes travel through chat apps.

Consequences: forward secrecy, post-compromise security after one round trip, replay
rejection (a used key is deleted), and no way to decrypt a message with a session other than
the one it was sent in.

### Envelopes

`🛡️MSG:<base64url(header ‖ ciphertext)>`, split into ≤ 3800-character parts for chat apps.
There is **no sender or recipient identifier** on the wire; the receiver trial-decrypts
against every contact (cheap: one HKDF and one AES-GCM per contact). Attachments are the same
ratchet message wrapped as an `.aes256` file (`A256CHAT-F1\n` magic).

### Direct link

WebRTC data channel. Session descriptions are exchanged as ratchet-encrypted `🛡️CONN`
envelopes, so signalling is authenticated and confidential. No ICE servers are configured
by default (host candidates → same LAN, zero third parties). If the user enables STUN, a
public STUN server learns the device's public IP and nothing else. Payloads on the channel
are ordinary ratchet messages: DTLS is an extra layer, not the security boundary.

### Local vault

A random 256-bit DEK encrypts every record (AES-256-GCM, random nonce, associated data =
table name + record id). The DEK is wrapped by a KEK derived from the master passphrase with
Argon2id. Failed unlocks are counted in plaintext metadata (they must be counted while
locked): no delay for the first two, then 30 s doubling up to 30 min. With the opt-in
self-destruct, the tenth failure deletes the database.

The failed-attempt counter is incremented in a database transaction *before* the KDF runs,
so killing the app mid-attempt or racing a second tab cannot skip it. Be clear about what
this buys: the lockout and the self-destruct only defend against guessing **through the app**.
Whoever copies the database can brute-force the passphrase offline at Argon2id speed
(≈ 0.2 s per guess on a desktop, no lockout). The real protection is therefore the passphrase
itself — hence the 12-character minimum, and the recommendation to use a long phrase.

Index columns (`id`, `k1`) are HMAC-SHA-256 values under a separate index key that is wrapped
together with the DEK, and `ts` is rounded to the hour; a forensic reader of the database sees
neither contact IDs nor exact timestamps. A passphrase change rotates the DEK and re-encrypts
every record.

While unlocked the DEK lives in memory only. The app locks after 2 minutes of inactivity
(configurable), 30 s after being hidden, and blurs its content whenever the window loses
focus. On Android `FLAG_SECURE` blocks screenshots, screen recording and the recents
thumbnail; the app is excluded from cloud backup and device transfer.

## Threat model — what is and is not covered

**Protected against**

- Anyone reading the transport channel (Telegram, e-mail, a captured QR photo): they see
  ciphertext and message sizes, nothing else.
- Compromise of long-term keys *after* a conversation: past messages stay secret (forward
  secrecy); future messages recover after one round trip.
- Replay, reordering, tampering: rejected by the ratchet / AEAD.
- Loss or theft of the locked device: Argon2id + lockout + optional self-destruct.
- Harvest-now-decrypt-later by a future quantum computer: the session secret is hybrid
  (X25519 + ML-KEM-768).

**Not protected against**

- **Metadata in the transport channel.** Telegram knows that you sent Bob 1.2 KB at 14:02.
- **A compromised endpoint.** Malware, a rooted phone with a keylogger, or someone watching
  the screen sees plaintext. So does anyone who knows your master passphrase.
- **Man-in-the-middle during the handshake** if the exchange channel is attacker-controlled
  *and* the users never compare safety numbers.
- **Traffic analysis of direct links.** A network observer sees that two IPs exchange
  DTLS traffic.
- **Browser/WebView bugs.** The app runs on the platform's crypto and storage; we do not
  ship our own.

## Legacy passphrase mode

`🛡️QR-ENC:` / `🔐QR:` / `🔒ENC:` / `🔐FILE:` (PBKDF2 + AES-256-GCM with a shared passphrase)
is kept byte-compatible for interoperability with v1 and with the Astoris vault. It has **no
forward secrecy** and its security is exactly the strength of the shared passphrase. It is a
tool in the settings, not part of the messenger protocol.

## Dependencies

Crypto: `@noble/curves`, `@noble/post-quantum`, `@noble/hashes` (audited, pure JS),
`hash-wasm` (Argon2id), Web Crypto (AES-GCM, PBKDF2 for legacy). QR: `qrcode`, `zxing-wasm`
(bundled locally). Storage: `dexie`. All pinned in `pnpm-lock.yaml`; `pnpm audit` runs in CI.
