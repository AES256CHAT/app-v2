<script lang="ts">
	import QrShow from '$lib/components/QrShow.svelte';
	import { t } from '$lib/i18n/index.svelte';
	import type { ContactRecord } from '$lib/store/contacts.svelte';
	import { live } from '$lib/store/live.svelte';

	let { contact, onclose, onimport }: { contact: ContactRecord; onclose: () => void; onimport: () => void } = $props();

	const status = $derived(live.statusOf(contact.id));
	const pending = $derived(live.pending[contact.id]);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function start() {
		busy = true;
		error = null;
		try {
			await live.offer(contact);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="fixed inset-0 z-40 flex items-end justify-center bg-black/50" role="dialog" aria-modal="true">
	<button class="absolute inset-0 cursor-default" aria-hidden="true" tabindex="-1" onclick={onclose}></button>
	<div class="bg-bg relative max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl p-5 pb-8">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-lg font-semibold">⚡ {t('liveTitle')}</h2>
			<button class="text-muted text-sm" onclick={onclose} data-testid="live-close">{t('cancel')}</button>
		</div>

		{#if status === 'connected'}
			<p class="text-accent font-medium" data-testid="live-connected">● {t('liveConnected')}</p>
			<p class="text-muted mt-1 text-sm">{t('liveConnectedHint')}</p>
			<button class="btn mt-4" onclick={() => live.disconnect(contact.id)}>{t('liveDisconnect')}</button>
		{:else if status === 'connecting'}
			<p class="animate-pulse">{t('liveConnecting')}</p>
		{:else if pending}
			<p class="text-muted mb-3 text-sm">
				{pending.role === 'offer' ? t('liveOfferHint', { name: contact.name }) : t('liveAnswerHint', { name: contact.name })}
			</p>
			<QrShow kind="conn" payload={pending.payload} />
			{#if pending.role === 'offer'}
				<button class="btn mt-4 w-full" onclick={onimport} data-testid="live-import-answer">📥 {t('liveImportAnswer')}</button>
			{/if}
			<button class="text-muted mt-3 w-full text-sm underline" onclick={() => live.disconnect(contact.id)}>{t('liveAbort')}</button>
		{:else}
			<p class="text-muted text-sm">{t('liveIntro')}</p>
			<p class="text-muted mt-2 text-xs">{live.stunEnabled ? t('liveStunOn') : t('liveStunOff')}</p>
			<button class="btn-primary mt-4 w-full" onclick={start} disabled={busy} data-testid="live-offer">{t('liveOffer')}</button>
			<button class="btn mt-2 w-full" onclick={onimport}>📥 {t('liveImportOffer')}</button>
		{/if}
		{#if error}<p class="text-danger mt-3 text-sm" role="alert">{error}</p>{/if}
	</div>
</div>

<style>
	.btn {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.6rem 1rem;
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
