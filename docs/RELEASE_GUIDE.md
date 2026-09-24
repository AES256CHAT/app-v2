# Release guide

## Prerequisites

- Node 22, pnpm 10
- JDK 21 (`~/.jdks/jdk-21` on the build box) and Android SDK 35 + build-tools 35 (`~/Android/Sdk`)
- A release keystore **outside the repository** (never commit it):

```bash
keytool -genkeypair -v -keystore ~/keys/aes256chat-release.jks -alias aes256chat \
  -keyalg RSA -keysize 4096 -validity 10000
```

## 1. Verify

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
npx playwright test
pnpm audit --prod
```

All green, or no release.

## 2. Web / PWA

`build/` is the complete app. Deploy it to any static host over HTTPS (Dokploy static site,
Caddy `file_server`, GitHub Pages, …). Required headers are already in the HTML (CSP via
meta tag). Nothing else to configure — there is no backend.

## 3. Android

**Every APK that leaves the building is a release build.** Debug builds are `debuggable`,
which on Android means `adb run-as` can read the app's private files and the WebView opens a
DevTools socket that exposes the *unlocked* app over USB — regardless of app settings
(verified on device). Release builds have neither.

CI (`.github/workflows/android.yml`) builds `assembleRelease` on every push to `main` and
signs it with the distribution key:

- keystore: `~/keys/aes256chat-release.jks` on the build box (RSA 4096, alias `aes256chat`),
  passphrase in `~/keys/aes256chat-release.pass` (mode 600) — **back both up offline**;
  losing the key means existing installs can never be updated again
- injected as repository secrets `RELEASE_KEYSTORE_B64` / `RELEASE_KEYSTORE_PASS`
- certificate SHA-256: `F2:C9:30:19:78:45:FE:74:4B:74:18:99:D0:64:00:0E:1F:E5:36:FB:79:92:24:26:45:40:F7:A8:20:4D:E2:E7`

Download the artifact `AES256CHAT-apk` from the run and verify before distributing:

```bash
gh run download <run-id> --repo AES256CHAT/app-v2 -n AES256CHAT-apk
java -jar $ANDROID_HOME/build-tools/35.0.0/lib/apksigner.jar verify --print-certs AES256CHAT.apk
```

Local build (x86 host, Google's AAPT2 does not run on ARM64):

```bash
export JAVA_HOME=~/.jdks/jdk-21 ANDROID_HOME=~/Android/Sdk
export RELEASE_KEYSTORE=~/keys/aes256chat-release.jks RELEASE_KEYSTORE_PASS="$(cat ~/keys/aes256chat-release.pass)"
npx cap sync android && cd android && ./gradlew assembleRelease
```

## 4. Checksums

```bash
scripts/generate-checksums.sh AES256CHAT-vX.Y.Z.apk build
```

writes `CHECKSUMS.txt` (SHA-256 and SHA-512 for the APK and every file in `build/`).
Publish it next to the APK and in the release notes; users verify with
`sha256sum -c CHECKSUMS.txt`.

## 5. Tag and publish

```bash
git tag -s vX.Y.Z -m "AES256CHAT vX.Y.Z"
git push origin main --tags && git push github main --tags
gh release create vX.Y.Z AES256CHAT-vX.Y.Z.apk CHECKSUMS.txt --notes-file RELEASE_NOTES.md
```

## Compatibility rules

- Envelope markers (`🛡️MSG:`, `🛡️ID:`, `🛡️OK:`, `🛡️CONN:`, `🛡️FILE:`) and the binary body
  framing are versioned (`v` byte / body type). Never change the meaning of an existing
  version; add a new one.
- The legacy passphrase format must stay byte-compatible with v1 and the Astoris vault —
  covered by `src/lib/crypto/legacy.test.ts` with reference vectors generated from v1 code.
