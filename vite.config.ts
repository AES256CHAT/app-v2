import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			injectRegister: null,
			strategies: 'generateSW',
			kit: { adapterFallback: 'index.html' },
			manifest: {
				id: '/',
				name: 'AES256CHAT',
				short_name: 'AES256CHAT',
				description: 'Serverless end-to-end encrypted messenger. Envelopes travel over any channel.',
				lang: 'de',
				start_url: '/',
				scope: '/',
				display: 'standalone',
				background_color: '#0b0f14',
				theme_color: '#0b0f14',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
					{ src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
				],
				share_target: { action: '/share', method: 'GET', params: { text: 'text', title: 'title', url: 'url' } }
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,webmanifest}'],
				navigateFallback: '/index.html',
				maximumFileSizeToCacheInBytes: 3_000_000,
				cleanupOutdatedCaches: true
			}
		}),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Static SPA: no server, ever. Capacitor loads the same build.
			adapter: adapter({ fallback: 'index.html', strict: false }),
			// No network by default: only same-origin assets. SvelteKit hashes its own inline
			// bootstrap script. STUN (if enabled later) is not HTTP and unaffected by CSP.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self', 'wasm-unsafe-eval'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'media-src': ['self', 'blob:'],
					'connect-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'worker-src': ['self', 'blob:'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'form-action': ['none']
				}
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
