import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	retries: 0,
	use: {
		baseURL: 'http://127.0.0.1:4173',
		headless: true,
		trace: 'retain-on-failure'
	},
	// Playwright owns the server: run `pnpm build` first. A busy port fails loudly instead of
	// silently testing a stale build.
	webServer: {
		command: 'pnpm preview --port 4173 --host 127.0.0.1 --strictPort',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: false,
		timeout: 60_000
	}
});
