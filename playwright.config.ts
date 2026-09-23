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
	webServer: {
		command: 'pnpm build && pnpm preview --port 4173 --host 127.0.0.1',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: true,
		timeout: 120_000
	}
});
