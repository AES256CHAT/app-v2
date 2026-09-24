import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'com.aes256chat.app',
	appName: 'AES256CHAT',
	webDir: 'build',
	// No remote server, ever: the WebView loads the bundled build.
	server: { androidScheme: 'https' },
	// webContentsDebuggingEnabled would expose the unlocked app over USB (chrome://inspect) — never.
	android: { allowMixedContent: false, backgroundColor: '#0b0f14', webContentsDebuggingEnabled: false },
	ios: { backgroundColor: '#0b0f14', contentInset: 'always' }
};

export default config;
