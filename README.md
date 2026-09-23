<div align="center">

# 🛡️ AES256CHAT v2

**Serverless, end-to-end encrypted messenger. No account, no server, no data anywhere but on your device.**

Messages are encrypted envelopes that travel over *any* channel — Telegram, WhatsApp, e-mail,
QR code, clipboard — or straight from device to device over a direct link. The app never
talks to a server. Not ours, not anyone's.

![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2-orange)
![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF)
![PWA](https://img.shields.io/badge/PWA-offline-5A0FC8)

</div>

---

## What it does

- **Contacts by QR.** Two scans (or two pasted codes) and both sides hold each other's keys.
  Compare the 60-digit safety number to rule out a man in the middle.
- **Chats.** Write a message → the app encrypts it → an envelope like `🛡️MSG:…` is copied or
  handed to the share sheet → you paste it into Telegram or wherever. The other side pastes
  it into AES256CHAT and reads it. Attachments travel as encrypted `.aes256` files.
- **Direct link.** When both are online, the devices connect peer-to-peer (WebRTC data
  channel) and messages arrive instantly. Same LAN by default; an optional STUN toggle
  enables internet paths. The connection code is itself an encrypted envelope.
- **Nothing is stored unless you say so.** Default mode keeps messages in memory only;
  locking the app wipes them. Opt-in history is encrypted on the device with auto-delete.
- **Access control.** Master passphrase (Argon2id), auto-lock, lock on app switch, blur
  when unfocused, exponential lockout, optional self-destruct after 10 wrong attempts,
  no screenshots on Android.
- **Legacy tool.** The v1 passphrase format (`🛡️QR-ENC:`, `🔐FILE:`) is still supported for
  people who have not upgraded.

## How it works

| Layer | What |
|---|---|
| Identity | Ed25519 (signatures) + X25519 (DH) + ML-KEM-768 (post-quantum KEM), generated on the device |
| Contact handshake | PQXDH-style: 4 × X25519 + ML-KEM-768 encapsulation, signed offer/answer, exchanged as QR frames or text |
| Messages | Double Ratchet (X25519, HKDF-SHA-512, AES-256-GCM) — forward secrecy and post-compromise security; either side may send first |
| Envelope | `🛡️MSG:<base64url>`, auto-split for chat apps; no sender identifier on the wire (the receiver trial-decrypts against its contacts) |
| Attachments | Same ratchet message, wrapped as an `.aes256` file; images are downscaled and re-encoded (drops EXIF) |
| Direct link | WebRTC data channel, no ICE servers by default; payloads are the ordinary ratchet messages (E2E + DTLS) |
| Local vault | Argon2id (64 MiB) → KEK wraps a random DEK; every record is AES-256-GCM in IndexedDB |

Details and the threat model: [SECURITY.md](SECURITY.md).

## Install

**Web / PWA** — serve the `build/` folder from any static host over HTTPS (camera and
clipboard need a secure context) and “Add to home screen”. The app works offline afterwards.
There is no backend to deploy.

**Android** — `pnpm build && npx cap sync android && cd android && ./gradlew assembleDebug`
(Java 17, Android SDK 35). Signed release builds: see `docs/RELEASE_GUIDE.md`.

**iOS** — `npx cap add ios && npx cap open ios`, then build in Xcode.

## Develop

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm test                # unit tests (crypto, vault) — vitest
pnpm build               # static build → build/
npx playwright test      # end-to-end: two isolated "devices" in one browser
SHOTS_DIR=/tmp/shots npx playwright test screenshots   # every screen, 390/820/1440 × light/dark
```

Project layout: `src/lib/crypto` (identity, handshake, ratchet, envelope, legacy),
`src/lib/vault` (Argon2id vault, access control), `src/lib/store` (contacts, messages,
inbox, live link), `src/lib/transport` (share, clipboard, WebRTC), `src/routes` (screens).

## Honest limitations

- No server means **no offline delivery and no push**. If your contact is offline, the
  envelope waits wherever you sent it (e.g. in Telegram) until they paste it.
- The transport channel (Telegram, e-mail, …) still sees **who sends what to whom and when** —
  it just cannot read it. Metadata protection is not a goal of this design.
- A compromised device (malware, someone reading over your shoulder) defeats every messenger.
- Direct links without STUN only work on the same network. With STUN, the STUN server
  learns your public IP — nothing else.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
