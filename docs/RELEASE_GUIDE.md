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

```bash
export JAVA_HOME=~/.jdks/jdk-21 ANDROID_HOME=~/Android/Sdk
npx cap sync android
cd android && ./gradlew assembleRelease
```

Sign and align (or configure `signingConfigs` in `android/app/build.gradle` reading the
keystore path/password from environment variables — never from the repo):

```bash
$ANDROID_HOME/build-tools/35.0.0/zipalign -v -p 4 \
  app/build/outputs/apk/release/app-release-unsigned.apk app-release-aligned.apk
$ANDROID_HOME/build-tools/35.0.0/apksigner sign --ks ~/keys/aes256chat-release.jks \
  --ks-key-alias aes256chat --out AES256CHAT-vX.Y.Z.apk app-release-aligned.apk
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs AES256CHAT-vX.Y.Z.apk
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
