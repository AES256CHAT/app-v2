<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { PartAssembler, parseEnvelope, type EnvelopeKind } from '$lib/crypto/envelope';
	import { QrScanner } from '$lib/qr/scanner';
	import { t } from '$lib/i18n/index.svelte';

	let {
		accept,
		onenvelope
	}: { accept: EnvelopeKind[]; onenvelope: (kind: EnvelopeKind, payload: Uint8Array) => void } = $props();

	let video: HTMLVideoElement;
	let scanner: QrScanner | null = null;
	let cameraError = $state<string | null>(null);
	let progress = $state<{ have: number; total: number } | null>(null);
	let pasted = $state('');
	let pasteError = $state<string | null>(null);
	let showPaste = $state(false);
	const assembler = new PartAssembler();

	function handleText(text: string): boolean {
		// Pasted text may contain several parts separated by whitespace.
		const tokens = text.split(/\s+/).filter(Boolean);
		let handled = false;
		for (const tok of tokens) {
			const p = parseEnvelope(tok);
			if (p.type === 'complete' && accept.includes(p.kind)) {
				onenvelope(p.kind, p.payload);
				return true;
			}
			if (p.type === 'part' && accept.includes(p.kind)) {
				handled = true;
				const done = assembler.add(p);
				progress = done ? null : assembler.progress(p.gid);
				if (done) {
					onenvelope(done.kind, done.payload);
					return true;
				}
			}
		}
		return handled;
	}

	onMount(async () => {
		if (!navigator.mediaDevices?.getUserMedia) {
			cameraError = t('scanNoCamera');
			showPaste = true;
			return;
		}
		scanner = new QrScanner(video, (text) => handleText(text));
		try {
			await scanner.start();
		} catch {
			cameraError = t('scanNoCamera');
			showPaste = true;
		}
	});

	onDestroy(() => scanner?.stop());

	function submitPaste() {
		pasteError = null;
		if (!handleText(pasted)) pasteError = t('scanPasteInvalid');
		else pasted = '';
	}
</script>

<div class="flex flex-col items-center gap-3">
	<div class="relative w-[min(320px,80vw)] overflow-hidden rounded-2xl bg-black" class:hidden={cameraError}>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={video} class="aspect-square w-full object-cover" muted></video>
		<div class="border-accent pointer-events-none absolute inset-6 rounded-xl border-2 opacity-70"></div>
	</div>
	{#if progress}
		<div class="text-sm" aria-live="polite">{t('scanProgress', { have: progress.have, total: progress.total })}</div>
	{/if}
	{#if cameraError}<p class="text-warn text-sm">{cameraError}</p>{/if}

	{#if !showPaste}
		<button class="text-muted text-sm underline" onclick={() => (showPaste = true)}>{t('scanPasteToggle')}</button>
	{:else}
		<div class="flex w-full max-w-sm flex-col gap-2">
			<textarea
				class="field h-28 font-mono text-xs"
				bind:value={pasted}
				placeholder="🛡️…"
				data-testid="paste-field"
			></textarea>
			{#if pasteError}<p class="text-danger text-sm" role="alert">{pasteError}</p>{/if}
			<button class="btn" onclick={submitPaste} disabled={!pasted.trim()}>{t('scanPasteSubmit')}</button>
		</div>
	{/if}
</div>

<style>
	.field {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.5rem 0.75rem;
	}
	.btn {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		border-radius: 0.75rem;
		padding: 0.6rem 1rem;
		font-weight: 600;
	}
	.btn:disabled {
		opacity: 0.5;
	}
</style>
