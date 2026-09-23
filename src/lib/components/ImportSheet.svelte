<script lang="ts">
	// Bottom sheet for bringing an envelope in: clipboard, paste, or camera.
	import { goto } from '$app/navigation';
	import QrScan from '$lib/components/QrScan.svelte';
	import { encodeEnvelope, type EnvelopeKind } from '$lib/crypto/envelope';
	import { t } from '$lib/i18n/index.svelte';
	import { inbox, type ImportResult } from '$lib/store/inbox.svelte';
	import { toast } from '$lib/store/toast.svelte';

	let { onclose, currentContactId = null }: { onclose: () => void; currentContactId?: string | null } = $props();

	let mode = $state<'menu' | 'paste' | 'scan'>('menu');
	let text = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function handle(result: ImportResult) {
		switch (result.type) {
			case 'message':
				toast.show(t('inboxReceived', { name: result.contact.name }));
				onclose();
				if (result.contact.id !== currentContactId) goto(`/chat/${result.contact.id}`);
				break;
			case 'handshake':
				onclose();
				goto('/contacts/add');
				break;
			case 'live':
				toast.show(result.role === 'offer' ? t('liveOfferReceived', { name: result.contact.name }) : t('liveAnswerReceived'));
				onclose();
				if (result.contact.id !== currentContactId) goto(`/chat/${result.contact.id}`);
				break;
			case 'partial':
				error = null;
				toast.show(t('scanProgress', { have: result.have, total: result.total }));
				text = '';
				break;
			case 'no-contact':
				error = t('inboxNoContact');
				break;
			case 'legacy':
				error = t('inboxLegacy');
				break;
			case 'unknown':
				error = t('scanPasteInvalid');
				break;
			case 'error':
				error = result.message;
		}
	}

	async function fromClipboard() {
		busy = true;
		const clip = await inbox.readClipboard();
		busy = false;
		if (clip === null) {
			mode = 'paste';
			error = t('inboxClipboardDenied');
			return;
		}
		await handle(await inbox.importText(clip));
	}

	async function submitPaste() {
		busy = true;
		try {
			await handle(await inbox.importText(text));
		} finally {
			busy = false;
		}
	}

	let fileInput = $state<HTMLInputElement>();

	async function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busy = true;
		try {
			await handle(await inbox.importFile(file));
		} finally {
			busy = false;
		}
	}

	async function onScanned(kind: EnvelopeKind, payload: Uint8Array) {
		// QrScan already reassembled the frames; hand the complete envelope to the inbox.
		await handle(await inbox.importText(encodeEnvelope(kind, payload, Number.MAX_SAFE_INTEGER)[0]));
	}
</script>

<div class="fixed inset-0 z-40 flex items-end justify-center bg-black/50" role="dialog" aria-modal="true">
	<button class="absolute inset-0 cursor-default" aria-hidden="true" tabindex="-1" onclick={onclose}></button>
	<div class="bg-bg relative w-full max-w-xl rounded-t-3xl p-5 pb-8">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-lg font-semibold">{t('inboxTitle')}</h2>
			<button class="text-muted text-sm" onclick={onclose} data-testid="inbox-close">{t('cancel')}</button>
		</div>

		{#if mode === 'menu'}
			<div class="flex flex-col gap-2">
				<button class="item" onclick={fromClipboard} disabled={busy}>📋 {t('inboxFromClipboard')}</button>
				<button class="item" onclick={() => (mode = 'paste')} data-testid="inbox-paste">✍️ {t('inboxPaste')}</button>
				<button class="item" onclick={() => (mode = 'scan')}>📷 {t('inboxScan')}</button>
				<button class="item" onclick={() => fileInput?.click()} data-testid="inbox-file">📎 {t('inboxFile')}</button>
				<input bind:this={fileInput} type="file" class="hidden" accept=".aes256,.txt,*/*" onchange={onFile} data-testid="inbox-file-input" />
			</div>
		{:else if mode === 'paste'}
			<textarea class="field h-32 w-full font-mono text-xs" bind:value={text} placeholder="🛡️MSG:…" data-testid="inbox-field"></textarea>
			<button class="btn-primary mt-3 w-full" onclick={submitPaste} disabled={busy || !text.trim()} data-testid="inbox-submit">
				{t('inboxImport')}
			</button>
		{:else}
			<QrScan accept={['msg', 'offer', 'answer']} onenvelope={onScanned} />
		{/if}

		{#if error}<p class="text-danger mt-3 text-sm" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.item {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.9rem;
		padding: 0.9rem 1rem;
		text-align: left;
		font-size: 1rem;
	}
	.item:disabled {
		opacity: 0.5;
	}
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.6rem 0.75rem;
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
