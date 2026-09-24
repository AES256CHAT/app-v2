<script lang="ts">
	// Guided pairing. Both people open this screen; the first question decides who shows first.
	//   A ("Ich zeige zuerst"):  1 show code → 2 scan reply → 3 done
	//   B ("Ich scanne zuerst"): 1 scan code → confirm → 2 show reply → 3 done (when A scanned)
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import HandshakeSketch from '$lib/components/HandshakeSketch.svelte';
	import QrScan from '$lib/components/QrScan.svelte';
	import QrShow from '$lib/components/QrShow.svelte';
	import { b64uDecode } from '$lib/crypto/bytes';
	import type { EnvelopeKind } from '$lib/crypto/envelope';
	import { HandshakeError, peekOffer, type Contact } from '$lib/crypto/handshake';
	import { bundleOf, contactId } from '$lib/crypto/identity';
	import { t } from '$lib/i18n/index.svelte';
	import { SessionExistsError, contacts, type ContactRecord, type OfferRecord } from '$lib/store/contacts.svelte';
	import { inbox } from '$lib/store/inbox.svelte';
	import { loadMe, type Me } from '$lib/vault/me';

	type Step =
		| { s: 'both' } // default: my code on screen, "scan" button (back camera), roles by who scans first
		| { s: 'both-scan' }
		| { s: 'role' }
		| { s: 'a-show' }
		| { s: 'a-scan' }
		| { s: 'b-scan' }
		| { s: 'confirm'; contact: Contact; offer: Uint8Array }
		| { s: 'replace'; name: string; retry: () => Promise<void> }
		| { s: 'b-show'; answer: Uint8Array; contact: ContactRecord }
		| { s: 'done'; contact: ContactRecord; side: 'a' | 'b' };

	let me = $state<Me | null>(null);
	const rekeyId = $derived(page.url.searchParams.get('rekey'));
	const rekeyContact = $derived(rekeyId ? contacts.get(rekeyId) : undefined);
	let offer = $state<OfferRecord | null>(null);
	let step = $state<Step>({ s: 'both' });
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
			error = e instanceof HandshakeError ? (/expired/.test(e.message) ? t('addErrExpired') : t('addErrGeneric')) : (e as Error).message;
		}
	}

	async function confirmAdd(replace = false) {
		if (!me || step.s !== 'confirm') return;
		const offerBytes = step.offer;
		const prev = step;
		busy = true;
		try {
			const r = await contacts.acceptOffer(me, offerBytes, replace);
			step = { s: 'b-show', answer: r.answer, contact: r.contact };
		} catch (e) {
			if (e instanceof SessionExistsError) {
				step = { s: 'replace', name: e.contact.name, retry: async () => ((step = prev), confirmAdd(true)) };
				return;
			}
			error = e instanceof HandshakeError ? (/expired/.test(e.message) ? t('addErrExpired') : t('addErrGeneric')) : (e as Error).message;
			step = { s: 'both' };
		} finally {
			busy = false;
		}
	}

	async function finalize(answer: Uint8Array, replace = false) {
		if (!me) return;
		busy = true;
		try {
			const c = await contacts.finalizeAnswer(me, answer, replace || !!rekeyId);
			step = { s: 'done', contact: c, side: 'a' };
		} catch (e) {
			if (e instanceof SessionExistsError) {
				step = { s: 'replace', name: e.contact.name, retry: () => finalize(answer, true) };
				return;
			}
			const msg = (e as Error).message;
			error =
				msg === 'offer-not-found' ? t('addErrOffer') : msg === 'answer-used' ? t('addErrUsed') : e instanceof HandshakeError ? t('addErrGeneric') : msg;
		} finally {
			busy = false;
		}
	}

	const progress = $derived.by(() => {
		switch (step.s) {
			case 'both':
			case 'both-scan':
				return 1;
			case 'a-show':
			case 'b-scan':
			case 'confirm':
				return 1;
			case 'a-scan':
			case 'b-show':
				return 2;
			case 'done':
				return 3;
			default:
				return 0;
		}
	});
	const sketchStep = $derived(progress === 1 ? 1 : progress === 2 ? 2 : 0) as 0 | 1 | 2;
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center gap-3">
		<a href="/" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="flex-1 text-lg font-semibold">{t('addTitle')}</h1>
		{#if progress > 0}<span class="bg-surface-2 text-muted shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap" data-testid="step">{t('stepOf', { n: progress, total: 3 })}</span>{/if}
	</header>

	{#if step.s === 'both'}
		<div class="guide">
			{#if rekeyContact}
				<p class="you">{t('rekeyYou', { name: rekeyContact.name })}</p>
				<p class="them">{t('rekeyThem', { name: rekeyContact.name })}</p>
			{:else}
				<p class="you">{t('bothYou')}</p>
				<p class="them">{t('bothThem')}</p>
			{/if}
		</div>
		{#if offer}
			<QrShow kind="offer" payload={b64uDecode(offer.offer)} />
		{/if}
		<button class="btn-primary" onclick={() => (step = { s: 'both-scan' })} data-testid="both-scan">📷 {t('bothScan')}</button>
		<div class="text-muted flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
			<button class="underline" onclick={newCode}>{t('addNewCode')}</button>
			<button class="underline" onclick={() => (step = { s: 'role' })} data-testid="role-steps">{t('roleStepByStep')}</button>
		</div>
	{:else if step.s === 'both-scan'}
		<div class="guide">
			<p class="you">{t('bothScanYou')}</p>
			<p class="them">{t('bothScanThem')}</p>
		</div>
		<QrScan accept={['offer', 'answer']} onenvelope={onEnvelope} />
		<button class="text-muted self-center text-xs underline" onclick={() => (step = { s: 'both' })}>← {t('bothBack')}</button>
	{:else if step.s === 'role'}
		<section class="bg-surface border-border rounded-2xl border p-4">
			<h2 class="font-semibold">{t('roleHow')}</h2>
			<HandshakeSketch step={0} />
			<ol class="text-muted mt-2 list-decimal space-y-1 pl-5 text-sm">
				<li>{t('roleStep1')}</li>
				<li>{t('roleStep2')}</li>
				<li>{t('roleStep3')}</li>
			</ol>
		</section>
		<p class="text-center font-medium">{t('roleQuestion')}</p>
		<div class="grid gap-3">
			<button class="role" onclick={() => (step = { s: 'a-show' })} data-testid="role-show">
				<span class="text-2xl">📱</span>
				<span><b>{t('roleShow')}</b><br /><span class="text-muted text-sm">{t('roleShowHint')}</span></span>
			</button>
			<button class="role" onclick={() => (step = { s: 'b-scan' })} data-testid="role-scan">
				<span class="text-2xl">📷</span>
				<span><b>{t('roleScan')}</b><br /><span class="text-muted text-sm">{t('roleScanHint')}</span></span>
			</button>
		</div>
		<p class="text-muted text-center text-xs">{t('roleEither')}</p>
	{:else if step.s === 'a-show'}
		<div class="guide">
			<HandshakeSketch step={1} />
			<p class="you">{t('aShowYou')}</p>
			<p class="them">{t('aShowThem')}</p>
		</div>
		{#if offer}
			<QrShow kind="offer" payload={b64uDecode(offer.offer)} />
			<button class="text-muted self-center text-xs underline" onclick={newCode}>{t('addNewCode')}</button>
		{/if}
		<button class="btn-primary" onclick={() => (step = { s: 'a-scan' })} data-testid="a-next">{t('aShowNext')} →</button>
	{:else if step.s === 'a-scan'}
		<div class="guide">
			<HandshakeSketch step={2} />
			<p class="you">{t('aScanYou')}</p>
			<p class="them">{t('aScanThem')}</p>
		</div>
		<QrScan accept={['answer']} onenvelope={onEnvelope} />
		<button class="text-muted self-center text-xs underline" onclick={() => (step = { s: 'a-show' })}>← {t('aScanBack')}</button>
	{:else if step.s === 'b-scan'}
		<div class="guide">
			<HandshakeSketch step={1} />
			<p class="you">{t('bScanYou')}</p>
			<p class="them">{t('bScanThem')}</p>
		</div>
		<QrScan accept={['offer']} onenvelope={onEnvelope} />
	{:else if step.s === 'confirm'}
		<section class="bg-surface border-border flex flex-col gap-4 rounded-2xl border p-5 text-center" data-testid="confirm">
			<h2 class="text-lg font-semibold">{t('addConfirmTitle')}</h2>
			<p>{t('addConfirmBody', { name: step.contact.name })}</p>
			<code class="text-muted font-mono text-sm">{step.contact.id.match(/.{4}/g)?.join('-')}</code>
			<div class="flex justify-center gap-3">
				<button class="btn-secondary" onclick={() => (step = { s: 'both' })}>{t('cancel')}</button>
				<button class="btn-primary" onclick={() => confirmAdd()} disabled={busy}>{t('addConfirmYes')}</button>
			</div>
		</section>
	{:else if step.s === 'replace'}
		<section class="bg-surface border-warn flex flex-col gap-4 rounded-2xl border p-5 text-center" data-testid="replace">
			<h2 class="text-lg font-semibold">{t('addReplaceTitle')}</h2>
			<p class="text-sm">{t('addReplaceBody', { name: step.name })}</p>
			<div class="flex justify-center gap-3">
				<button class="btn-secondary" onclick={() => (step = { s: 'role' })}>{t('cancel')}</button>
				<button class="btn-primary" onclick={() => step.s === 'replace' && step.retry()} disabled={busy}>{t('addReplaceYes')}</button>
			</div>
		</section>
	{:else if step.s === 'b-show'}
		<div class="guide">
			<HandshakeSketch step={2} />
			<p class="you">{t('bShowYou', { name: step.contact.name })}</p>
			<p class="them">{t('bShowThem', { name: step.contact.name })}</p>
		</div>
		<QrShow kind="answer" payload={step.answer} />
		<button class="btn-primary" onclick={() => step.s === 'b-show' && (step = { s: 'done', contact: step.contact, side: 'b' })} data-testid="b-done">
			{t('bShowDone', { name: step.contact.name })} ✓
		</button>
	{:else if step.s === 'done'}
		<section class="bg-surface border-border flex flex-col items-center gap-4 rounded-2xl border p-5 text-center" data-testid="done">
			<div class="text-4xl">✅</div>
			<h2 class="text-lg font-semibold">{t('addDoneTitle')}</h2>
			<p>{step.side === 'a' ? t('addDoneBody', { name: step.contact.name }) : t('addDoneBodyB', { name: step.contact.name })}</p>
			<a class="btn-primary" href={`/chat/${step.contact.id}`} data-testid="open-chat">{t('addOpenChat')}</a>
		</section>
	{/if}

	{#if error}<p class="text-danger text-center text-sm" role="alert">{error}</p>{/if}
</main>

<style>
	.role {
		display: flex;
		gap: 1rem;
		align-items: center;
		text-align: left;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 1rem;
	}
	.role:active {
		border-color: var(--color-accent);
	}
	.guide {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 0.75rem 1rem;
	}
	.you {
		font-weight: 600;
		margin-top: 0.25rem;
	}
	.them {
		color: var(--color-muted);
		font-size: 0.9rem;
		margin-top: 0.25rem;
	}
	.btn-primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.75rem 1.1rem;
		font-weight: 600;
		text-align: center;
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
