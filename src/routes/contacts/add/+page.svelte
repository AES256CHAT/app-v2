<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import QrScan from '$lib/components/QrScan.svelte';
	import QrShow from '$lib/components/QrShow.svelte';
	import { b64uDecode } from '$lib/crypto/bytes';
	import type { EnvelopeKind } from '$lib/crypto/envelope';
	import { HandshakeError, peekOffer, type Contact } from '$lib/crypto/handshake';
	import { bundleOf, contactId } from '$lib/crypto/identity';
	import { t } from '$lib/i18n/index.svelte';
	import { contacts, type ContactRecord, type OfferRecord } from '$lib/store/contacts.svelte';
	import { inbox } from '$lib/store/inbox.svelte';
	import { loadMe, type Me } from '$lib/vault/me';

	type Step =
		| { s: 'tabs' }
		| { s: 'confirm'; contact: Contact; offer: Uint8Array }
		| { s: 'answer'; answer: Uint8Array; contact: ContactRecord }
		| { s: 'done'; contact: ContactRecord };

	let me = $state<Me | null>(null);
	let tab = $state<'show' | 'scan'>('show');
	let offer = $state<OfferRecord | null>(null);
	let step = $state<Step>({ s: 'tabs' });
	let error = $state<string | null>(null);
	let busy = $state(false);

	onMount(async () => {
		me = await loadMe();
		if (me) offer = await contacts.currentOffer(me);
		// A handshake envelope imported elsewhere (inbox sheet) lands here.
		const h = inbox.takeHandoff();
		if (h) onEnvelope(h.kind, h.payload);
	});

	async function newCode() {
		if (!me) return;
		offer = await contacts.newOffer(me);
	}

	function onEnvelope(kind: EnvelopeKind, payload: Uint8Array) {
		error = null;
		if (!me) return;
		try {
			if (kind === 'offer') {
				const c = peekOffer(payload);
				if (c.id === contactId(bundleOf(me.identity))) return (error = t('addSelf'));
				step = { s: 'confirm', contact: c, offer: payload };
			} else if (kind === 'answer') {
				void finalize(payload);
			}
		} catch (e) {
			error = e instanceof HandshakeError ? t('addErrGeneric') : (e as Error).message;
		}
	}

	async function confirmAdd() {
		if (!me || step.s !== 'confirm') return;
		busy = true;
		try {
			const r = await contacts.acceptOffer(me, step.offer);
			step = { s: 'answer', answer: r.answer, contact: r.contact };
		} catch (e) {
			error = e instanceof HandshakeError ? t('addErrGeneric') : (e as Error).message;
			step = { s: 'tabs' };
		} finally {
			busy = false;
		}
	}

	async function finalize(answer: Uint8Array) {
		if (!me) return;
		busy = true;
		try {
			const c = await contacts.finalizeAnswer(me, answer);
			step = { s: 'done', contact: c };
		} catch (e) {
			const msg = (e as Error).message;
			error = msg === 'offer-not-found' ? t('addErrOffer') : e instanceof HandshakeError ? t('addErrGeneric') : msg;
		} finally {
			busy = false;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center gap-3">
		<a href="/" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="text-xl font-semibold">{t('addTitle')}</h1>
	</header>

	{#if step.s === 'tabs'}
		<div class="bg-surface-2 flex rounded-xl p-1" role="tablist">
			<button role="tab" aria-selected={tab === 'show'} class="tab" class:active={tab === 'show'} onclick={() => (tab = 'show')}>
				{t('addShowTab')}
			</button>
			<button role="tab" aria-selected={tab === 'scan'} class="tab" class:active={tab === 'scan'} onclick={() => (tab = 'scan')}>
				{t('addScanTab')}
			</button>
		</div>

		{#if tab === 'show'}
			{#if offer}
				<QrShow kind="offer" payload={b64uDecode(offer.offer)} hint={t('addShowHint')} />
				<button class="text-muted self-center text-xs underline" onclick={newCode}>{t('addNewCode')}</button>
			{/if}
		{:else}
			<p class="text-muted text-center text-sm">{t('addScanHint')}</p>
			<QrScan accept={['offer', 'answer']} onenvelope={onEnvelope} />
		{/if}
	{:else if step.s === 'confirm'}
		<section class="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-5 text-center" data-testid="confirm">
			<h2 class="text-lg font-semibold">{t('addConfirmTitle')}</h2>
			<p>{t('addConfirmBody', { name: step.contact.name })}</p>
			<code class="text-muted font-mono text-sm">{step.contact.id.match(/.{4}/g)?.join('-')}</code>
			<div class="flex justify-center gap-3">
				<button class="btn-secondary" onclick={() => (step = { s: 'tabs' })}>{t('cancel')}</button>
				<button class="btn-primary" onclick={confirmAdd} disabled={busy}>{t('addConfirmYes')}</button>
			</div>
		</section>
	{:else if step.s === 'answer'}
		<section class="flex flex-col items-center gap-4" data-testid="answer">
			<h2 class="text-lg font-semibold">{t('addAnswerTitle')}</h2>
			<QrShow kind="answer" payload={step.answer} hint={t('addAnswerHint', { name: step.contact.name })} />
			<button class="btn-primary" onclick={() => goto(`/contacts/${step.s === 'answer' ? step.contact.id : ''}`)}>
				{t('addOpenChat')}
			</button>
		</section>
	{:else if step.s === 'done'}
		<section class="bg-surface border-border flex flex-col items-center gap-4 rounded-2xl border p-5 text-center" data-testid="done">
			<div class="text-4xl">✅</div>
			<h2 class="text-lg font-semibold">{t('addDoneTitle')}</h2>
			<p>{t('addDoneBody', { name: step.contact.name })}</p>
			<a class="btn-primary" href={`/contacts/${step.contact.id}`}>{t('addOpenChat')}</a>
		</section>
	{/if}

	{#if error}<p class="text-danger text-center text-sm" role="alert">{error}</p>{/if}
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
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.6rem 1.1rem;
		font-weight: 600;
	}
	.btn-primary:disabled {
		opacity: 0.5;
	}
	.btn-secondary {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.6rem 1.1rem;
	}
</style>
