# Contributing

Thanks for helping. A few rules keep this project trustworthy.

## Ground rules

- **No network.** Pull requests that add any request to a server, CDN, analytics or crash
  reporter will not be merged. The CSP enforces same-origin; keep it that way.
- **No new crypto.** Use the primitives already in `src/lib/crypto` (`@noble/*`, Web Crypto,
  `hash-wasm`). Protocol changes need a written rationale in `SECURITY.md` and tests.
- **Formats are contracts.** Envelope markers, body types and the legacy format are
  versioned; never change an existing version's meaning.
- **Honest UI.** Status texts say what the app knows ("kopiert", "geteilt", "direkt
  zugestellt") — never a "delivered" the app cannot verify.

## Workflow

```bash
pnpm install
pnpm dev
pnpm test            # unit tests must stay green
pnpm build           # not just svelte-check — the build is what ships
npx playwright test  # end-to-end
```

Every feature comes with:
1. unit tests for pure logic (`*.test.ts` next to the code),
2. an end-to-end test when a screen or flow changes (`e2e/`),
3. screenshots at 390/820/1440 × light/dark for UI changes
   (`SHOTS_DIR=/tmp/shots npx playwright test screenshots`).

## Code style

Prettier defaults (tabs), TypeScript strict, Svelte 5 runes. Comments explain *why*, in
English. Commit messages: conventional (`feat(scope): …`, `fix(scope): …`).

## Security issues

See [SECURITY.md](SECURITY.md) — report privately, not as a public issue.
