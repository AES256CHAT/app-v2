<script lang="ts">
	// Legacy passphrase mode: byte-compatible with AES256CHAT v1 and the Astoris vault.
	// Kept as a tool for people who have not upgraded yet; the messenger itself never uses it.
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n/index.svelte';
	import {
		LEGACY,
		LEGACY_MAX_FILE_BYTES,
		legacyDecryptFile,
		legacyDecryptMessage,
		legacyEncryptFile,
		legacyEncryptMessage
	} from '$lib/crypto/legacy';
	import { formatBytes } from '$lib/media/image';
	import { inbox } from '$lib/store/inbox.svelte';
	import { toast } from '$lib/store/toast.svelte';
	import { canShare, copyText, download, shareText } from '$lib/transport/share';

	let mode = $state<'encrypt' | 'decrypt'>('encrypt');
	let pw = $state('');
	let input = $state('');
	let output = $state('');
	let file = $state<File | null>(null);
	let decryptedFile = $state<{ name: string; type: string; data: Uint8Array } | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement>();

	onMount(() => {
		const h = inbox.takeLegacyHandoff();
		if (h) {
			mode = 'decrypt';
			input = h;
		}
	});

	function reset() {
		output = '';
		decryptedFile = null;
		error = null;
	}

	async function run() {
		reset();
		if (!pw) return;
		busy = true;
		try {
			if (mode === 'encrypt') {
				if (file) {
					if (file.size > LEGACY_MAX_FILE_BYTES) throw new Error(t('fileTooLarge', { max: formatBytes(LEGACY_MAX_FILE_BYTES) }));
					const data = new Uint8Array(await file.arrayBuffer());
					output = await legacyEncryptFile(data, { name: file.name, type: file.type, size: file.size }, pw);
				} else if (input.trim()) {
					output = await legacyEncryptMessage(input, pw);
				}
			} else {
				const text = input.trim();
				if (text.startsWith(LEGACY.file)) {
					const r = await legacyDecryptFile(text, pw);
					decryptedFile = { name: r.meta.name, type: r.meta.type, data: r.data };
				} else if (text) {
					output = await legacyDecryptMessage(text, pw);
				}
			}
		} catch (e) {
			error = mode === 'decrypt' ? t('pwDecryptFailed') : (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function copyOut() {
		await copyText(output);
		toast.show(t('copied'));
	}

	function onFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		file = f;
		if (f) input = '';
	}

	function saveFile() {
		if (!decryptedFile) return;
		download(new Blob([decryptedFile.data as BlobPart], { type: decryptedFile.type || 'application/octet-stream' }), decryptedFile.name);
	}
</script>

<main class="flex flex-1 flex-col gap-4 p-6">
	<header class="flex items-center gap-3">
		<a href="/settings" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="text-xl font-semibold">{t('pwTitle')}</h1>
	</header>
	<p class="text-muted text-sm">{t('pwIntro')}</p>

	<div class="bg-surface-2 flex rounded-xl p-1" role="tablist">
		<button role="tab" aria-selected={mode === 'encrypt'} class="tab" class:active={mode === 'encrypt'} onclick={() => ((mode = 'encrypt'), reset())}>{t('pwEncrypt')}</button>
		<button role="tab" aria-selected={mode === 'decrypt'} class="tab" class:active={mode === 'decrypt'} onclick={() => ((mode = 'decrypt'), reset(), (file = null))}>{t('pwDecrypt')}</button>
	</div>

	<input class="field" type="password" bind:value={pw} placeholder={t('pwPassword')} autocomplete="off" data-testid="pw-key" />

	{#if mode === 'encrypt'}
		<textarea class="field h-32" bind:value={input} placeholder={t('pwPlainPlaceholder')} disabled={!!file} data-testid="pw-input"></textarea>
		<div class="flex items-center gap-3 text-sm">
			<input bind:this={fileInput} type="file" class="hidden" onchange={onFile} data-testid="pw-file" />
			<button class="btn" onclick={() => fileInput?.click()}>📎 {t('pwPickFile')}</button>
			{#if file}<span class="truncate">{file.name} · {formatBytes(file.size)}</span><button class="text-muted underline" onclick={() => (file = null)}>{t('cancel')}</button>{/if}
		</div>
	{:else}
		<textarea class="field h-32 font-mono text-xs" bind:value={input} placeholder="🛡️QR-ENC:… / 🔐FILE:…" data-testid="pw-input"></textarea>
	{/if}

	<button class="btn-primary" onclick={run} disabled={busy || !pw || (!input.trim() && !file)} data-testid="pw-run">
		{busy ? '…' : mode === 'encrypt' ? t('pwEncrypt') : t('pwDecrypt')}
	</button>

	{#if error}<p class="text-danger text-sm" role="alert">{error}</p>{/if}

	{#if output}
		<section class="bg-surface border-border rounded-xl border p-3">
			<textarea class="field h-32 w-full font-mono text-xs" readonly value={output} data-testid="pw-output"></textarea>
			<div class="mt-2 flex gap-2">
				<button class="btn" onclick={copyOut}>{t('copy')}</button>
				{#if canShare()}<button class="btn" onclick={() => shareText(output)}>{t('share')}</button>{/if}
			</div>
		</section>
	{/if}
	{#if decryptedFile}
		<section class="bg-surface border-border flex items-center justify-between gap-3 rounded-xl border p-3" data-testid="pw-file-out">
			<span class="truncate">📎 {decryptedFile.name} · {formatBytes(decryptedFile.data.length)}</span>
			<button class="btn" onclick={saveFile}>{t('fileSave')}</button>
		</section>
	{/if}
</main>

<style>
	.tab {
		flex: 1;
		padding: 0.5rem;
		border-radius: 0.6rem;
		font-size: 0.9rem;
		color: var(--color-muted);
	}
	.tab.active {
		background: var(--color-surface);
		color: var(--color-fg);
		font-weight: 600;
	}
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.6rem 0.75rem;
	}
	.btn {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
	}
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.7rem 1rem;
		font-weight: 600;
	}
	.btn-primary:disabled {
		opacity: 0.5;
	}
</style>
