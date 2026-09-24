<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import FileBubble from '$lib/components/FileBubble.svelte';
	import ImportSheet from '$lib/components/ImportSheet.svelte';
	import LiveSheet from '$lib/components/LiveSheet.svelte';
	import QrShow from '$lib/components/QrShow.svelte';
	import { b64uDecode } from '$lib/crypto/bytes';
	import { PREFIX } from '$lib/crypto/envelope';
	import { FILE_MIME } from '$lib/crypto/fileenvelope';
	import { MAX_FILE_BYTES } from '$lib/crypto/message';
	import { t } from '$lib/i18n/index.svelte';
	import { downscaleImage, formatBytes, isImage } from '$lib/media/image';
	import { contacts } from '$lib/store/contacts.svelte';
	import { live } from '$lib/store/live.svelte';
	import { messages, type ChatMessage } from '$lib/store/messages.svelte';
	import { toast } from '$lib/store/toast.svelte';
	import { canShare, copyText, shareOrDownload, shareOrDownloadBlob, shareText } from '$lib/transport/share';
	import { qrSheetPng } from '$lib/qr/sheet';
	import { vault } from '$lib/vault/vault.svelte';

	const id = $derived(page.params.id ?? '');
	const contact = $derived(contacts.get(id));
	const list = $derived(messages.list(id));
	const ephemeral = $derived(vault.info?.history !== 'persist');

	let draft = $state('');
	let busy = $state(false);
	let showImport = $state(false);
	let showLive = $state(false);
	const liveStatus = $derived(live.statusOf(id));
	let qrFor = $state<ChatMessage | null>(null);
	let scroller: HTMLElement;
	let fileInput: HTMLInputElement;

	onMount(async () => {
		if (!contacts.loaded) await contacts.refresh();
		await messages.load(id);
		messages.markRead(id);
		scrollDown();
	});

	$effect(() => {
		list.length;
		scrollDown();
	});

	async function scrollDown() {
		await tick();
		scroller?.scrollTo({ top: scroller.scrollHeight });
	}

	async function send() {
		const body = draft.trim();
		if (!body || !contact || busy) return;
		busy = true;
		try {
			const msg = await messages.send(contact, body, live.transportFor(contact.id));
			draft = '';
			if (msg.status !== 'delivered') await deliver(msg, 'auto');
		} finally {
			busy = false;
		}
	}

	async function deliver(msg: ChatMessage, how: 'auto' | 'copy' | 'share') {
		const text = msg.envelope?.join('\n') ?? '';
		if (how === 'share' || (how === 'auto' && canShare())) {
			const shared = await shareText(text);
			if (shared) {
				await messages.setStatus(msg, 'shared');
				return;
			}
			if (how === 'share') return;
		}
		await copyText(text);
		await messages.setStatus(msg, 'copied');
		toast.show(msg.envelope && msg.envelope.length > 1 ? t('chatCopiedParts', { n: msg.envelope.length }) : t('chatCopied'));
	}

	async function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !contact || busy) return;
		busy = true;
		try {
			const blob = isImage(file.type) ? await downscaleImage(file) : file;
			if (blob.size > MAX_FILE_BYTES) return toast.show(t('fileTooLarge', { max: formatBytes(MAX_FILE_BYTES) }));
			const data = new Uint8Array(await blob.arrayBuffer());
			const mime = blob.type || file.type || 'application/octet-stream';
			const name = blob !== file && mime === 'image/jpeg' ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name;
			const msg = await messages.sendFile(contact, data, { name, mime, size: data.length }, live.transportFor(contact.id));
			if (msg.status === 'delivered') return;
			const att = await messages.attachment(msg.id);
			if (!att?.envelope || !msg.envelopeFile) return;
			const how = await shareOrDownload(att.envelope, msg.envelopeFile, FILE_MIME);
			if (how === 'shared') await messages.setStatus(msg, 'shared');
			if (how === 'downloaded') {
				await messages.setStatus(msg, 'downloaded');
				toast.show(t('fileDownloaded', { name: msg.envelopeFile }));
			}
		} finally {
			busy = false;
		}
	}

	async function shareAsImage(m: ChatMessage) {
		const sheet = await qrSheetPng('msg', payloadOf(m), { title: t('sheetTitle'), hint: t('sheetHint'), ts: m.ts });
		const how = await shareOrDownloadBlob(sheet.blob, sheet.fileName);
		if (how === 'shared') await messages.setStatus(m, 'shared');
		if (how === 'downloaded') {
			await messages.setStatus(m, 'downloaded');
			toast.show(t('sheetSaved', { name: sheet.fileName }));
		}
	}

	function statusLabel(m: ChatMessage): string {
		switch (m.status) {
			case 'copied':
				return t('statusCopied');
			case 'shared':
				return t('statusShared');
			case 'downloaded':
				return t('statusDownloaded');
			case 'delivered':
				return t('statusDelivered');
			case 'encrypted':
				return t('statusEncrypted');
			default:
				return '';
		}
	}

	function payloadOf(m: ChatMessage): Uint8Array {
		// Rebuild the raw payload from the stored envelope parts (single- or multi-part).
		const parts = m.envelope ?? [];
		const data = parts
			.map((p) => p.slice(PREFIX.msg.length))
			.map((p) => (p.includes(':') ? p.slice(p.indexOf(':') + 1) : p))
			.join('');
		return b64uDecode(data);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
	}

	const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<div class="flex h-dvh flex-col">
	<header class="border-border flex items-center gap-3 border-b px-4 py-3">
		<a href="/" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<a href={`/contacts/${id}`} class="flex-1">
			<div class="font-semibold">{contact?.name ?? '…'}{#if contact?.verified}<span class="text-accent ml-1 text-xs">✔</span>{/if}</div>
			<div class="text-muted text-xs">{ephemeral ? t('chatEphemeral') : t('chatPersist')}</div>
		</a>
		<button class="text-sm" onclick={() => (showLive = true)} aria-label={t('liveTitle')} data-testid="chat-live">
			{#if liveStatus === 'connected'}<span class="text-accent" data-testid="live-dot">●</span>{:else if liveStatus !== 'idle'}<span class="text-warn animate-pulse">●</span>{/if} ⚡
		</button>
		<button class="text-sm" onclick={() => (showImport = true)} aria-label={t('inboxTitle')} data-testid="chat-import">📥</button>
	</header>

	<section bind:this={scroller} class="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3" data-testid="thread">
		{#if list.length === 0}
			<p class="text-muted m-auto max-w-xs text-center text-sm">{t('chatEmpty')}</p>
		{/if}
		{#each list as m (m.id)}
			<div class="flex flex-col {m.dir === 'out' ? 'items-end' : 'items-start'}">
				<div class="bubble {m.dir === 'out' ? 'mine' : 'theirs'}" data-testid={m.dir === 'out' ? 'msg-out' : 'msg-in'}>
					{#if m.file}
						<FileBubble msg={m} />
					{:else}
						<div class="whitespace-pre-wrap break-words">{m.body}</div>
					{/if}
					<div class="text-muted mt-1 flex flex-wrap items-center gap-2 text-[11px]">
						<span>{fmtTime(m.ts)}</span>
						{#if m.dir === 'out'}
							<span>· 🔒 {statusLabel(m)}</span>
							{#if !m.file && m.status !== 'delivered'}
								<button class="underline" onclick={() => deliver(m, 'copy')}>{t('copy')}</button>
								{#if canShare()}<button class="underline" onclick={() => deliver(m, 'share')}>{t('share')}</button>{/if}
								<button class="underline" onclick={() => (qrFor = m)}>QR</button>
								<button class="underline" onclick={() => shareAsImage(m)} data-testid="msg-image">{t('shareImage')}</button>
							{/if}
						{/if}
					</div>
				</div>
			</div>
		{/each}
	</section>

	<footer class="border-border flex items-end gap-2 border-t px-3 py-2">
		<input bind:this={fileInput} type="file" class="hidden" onchange={onFilePicked} data-testid="file-input" />
		<button class="text-xl" onclick={() => fileInput.click()} aria-label={t('attach')} disabled={busy} data-testid="attach">📎</button>
		<textarea
			class="field max-h-40 min-h-[2.75rem] flex-1 resize-none"
			rows="1"
			bind:value={draft}
			onkeydown={onKey}
			placeholder={t('chatPlaceholder')}
			data-testid="composer"
		></textarea>
		<button class="btn-primary" onclick={send} disabled={busy || !draft.trim()} data-testid="send">{t('chatSend')}</button>
	</footer>
</div>

{#if showImport}
	<ImportSheet onclose={() => (showImport = false)} currentContactId={id} />
{/if}

{#if showLive && contact}
	<LiveSheet {contact} onclose={() => (showLive = false)} onimport={() => ((showLive = false), (showImport = true))} />
{/if}

{#if qrFor}
	<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
		<div class="bg-bg w-full max-w-sm rounded-2xl p-5">
			<QrShow kind="msg" payload={payloadOf(qrFor)} hint={t('chatQrHint')} />
			<button class="text-muted mt-4 w-full text-sm underline" onclick={() => (qrFor = null)}>{t('cancel')}</button>
		</div>
	</div>
{/if}

<style>
	.bubble {
		max-width: 85%;
		border-radius: 1rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.95rem;
	}
	.mine {
		background: var(--color-mine);
		border-bottom-right-radius: 0.25rem;
	}
	.theirs {
		background: var(--color-theirs);
		border-bottom-left-radius: 0.25rem;
	}
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 0.6rem 0.9rem;
		font-size: 1rem;
	}
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 1rem;
		padding: 0.65rem 1rem;
		font-weight: 600;
	}
	.btn-primary:disabled {
		opacity: 0.5;
	}
</style>
