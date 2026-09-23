<script lang="ts">
	import { FILE_MIME } from '$lib/crypto/fileenvelope';
	import { t } from '$lib/i18n/index.svelte';
	import { formatBytes, isImage } from '$lib/media/image';
	import { messages, type ChatMessage } from '$lib/store/messages.svelte';
	import { toast } from '$lib/store/toast.svelte';
	import { download, shareOrDownload } from '$lib/transport/share';

	let { msg }: { msg: ChatMessage } = $props();

	let preview = $state<string | null>(null);

	$effect(() => {
		if (msg.file && isImage(msg.file.mime)) messages.previewUrl(msg).then((u) => (preview = u));
	});

	async function saveDecrypted() {
		const att = await messages.attachment(msg.id);
		if (!att || !msg.file) return;
		download(new Blob([att.plain as BlobPart], { type: msg.file.mime }), msg.file.name);
	}

	/** Outgoing: hand the encrypted .aes256 file out again. */
	async function sendAgain() {
		const att = await messages.attachment(msg.id);
		if (!att?.envelope || !msg.envelopeFile) return;
		const how = await shareOrDownload(att.envelope, msg.envelopeFile, FILE_MIME);
		if (how === 'shared') await messages.setStatus(msg, 'shared');
		if (how === 'downloaded') {
			await messages.setStatus(msg, 'downloaded');
			toast.show(t('fileDownloaded', { name: msg.envelopeFile }));
		}
	}
</script>

{#if msg.file}
	<div class="flex flex-col gap-2" data-testid="file-bubble">
		{#if preview}
			<img src={preview} alt={msg.file.name} class="max-h-64 w-auto max-w-full rounded-lg object-contain" />
		{:else}
			<div class="flex items-center gap-2">
				<span class="text-2xl" aria-hidden="true">📎</span>
				<span class="min-w-0">
					<span class="block truncate font-medium" data-testid="file-name">{msg.file.name}</span>
					<span class="text-muted text-xs">{formatBytes(msg.file.size)}</span>
				</span>
			</div>
		{/if}
		<div class="flex flex-wrap gap-3 text-xs">
			<button class="underline" onclick={saveDecrypted} data-testid="file-save">{t('fileSave')}</button>
			{#if msg.dir === 'out'}
				<button class="underline" onclick={sendAgain} data-testid="file-send-again">{t('fileSendAgain')}</button>
			{/if}
		</div>
	</div>
{/if}
