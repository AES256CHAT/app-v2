<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { EnvelopeKind } from '$lib/crypto/envelope';
	import { QR_FRAME_CHARS, QR_FRAME_CHARS_COARSE, qrFrames, type QrFrames } from '$lib/qr/frames';
	import { canShare, copyText, shareText } from '$lib/transport/share';
	import { t } from '$lib/i18n/index.svelte';

	let {
		kind,
		payload,
		hint = '',
		coarse = false,
		compact = false
	}: { kind: EnvelopeKind; payload: Uint8Array; hint?: string; coarse?: boolean; compact?: boolean } = $props();

	let frames = $state<QrFrames | null>(null);
	let index = $state(0);
	let copied = $state(false);
	let timer: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		const p = payload;
		const k = kind;
		let cancelled = false;
		frames = null;
		index = 0;
		qrFrames(k, p, 320, coarse ? QR_FRAME_CHARS_COARSE : QR_FRAME_CHARS).then((f) => {
			if (!cancelled) frames = f;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (timer) clearInterval(timer);
		timer = null;
		const n = frames?.images.length ?? 0;
		if (n > 1) timer = setInterval(() => (index = (index + 1) % n), coarse ? 500 : 700);
	});

	onDestroy(() => {
		if (timer) clearInterval(timer);
	});

	const fullText = $derived(frames ? frames.texts.join('\n') : '');

	async function copy() {
		await copyText(fullText);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="flex flex-col items-center gap-3">
	{#if frames}
		<div class="rounded-2xl bg-white p-3">
			<img src={frames.images[index]} alt="QR" width="320" height="320" class="block h-auto {compact ? 'w-[min(230px,58vw)]' : 'w-[min(320px,80vw)]'}" />
		</div>
		{#if frames.images.length > 1}
			<div class="text-muted text-xs" aria-live="polite">{index + 1} / {frames.images.length}</div>
		{/if}
	{:else}
		<div class="bg-surface-2 animate-pulse rounded-2xl {compact ? 'h-[230px] w-[min(230px,58vw)]' : 'h-[320px] w-[min(320px,80vw)]'}"></div>
	{/if}
	{#if hint}<p class="text-muted max-w-xs text-center text-sm">{hint}</p>{/if}
	<div class="flex gap-2" class:hidden={compact}>
		<button class="btn" onclick={copy} disabled={!frames}>{copied ? t('copied') : t('copyAsText')}</button>
		{#if canShare()}
			<button class="btn" onclick={() => shareText(fullText)} disabled={!frames}>{t('share')}</button>
		{/if}
	</div>
	<textarea class="sr-only" readonly data-testid="envelope-text" value={fullText}></textarea>
</div>

<style>
	.btn {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
	}
	.btn:disabled {
		opacity: 0.5;
	}
</style>
