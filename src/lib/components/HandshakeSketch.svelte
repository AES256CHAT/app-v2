<script lang="ts">
	// Two phones, two arrows: "one shows, the other scans — then the other way round".
	let { step = 0 }: { step?: 0 | 1 | 2 } = $props();
</script>

<svg viewBox="0 0 320 120" class="mx-auto block w-full max-w-xs" role="img" aria-label="Ablauf: erst A zeigt und B scannt, dann B zeigt und A scannt">
	<!-- phone A -->
	<rect x="20" y="15" width="70" height="90" rx="10" fill="var(--color-surface)" stroke="var(--color-border)" stroke-width="2" />
	<text x="55" y="10" text-anchor="middle" font-size="11" fill="var(--color-muted)">A</text>
	<!-- phone B -->
	<rect x="230" y="15" width="70" height="90" rx="10" fill="var(--color-surface)" stroke="var(--color-border)" stroke-width="2" />
	<text x="265" y="10" text-anchor="middle" font-size="11" fill="var(--color-muted)">B</text>

	<!-- step 1: A shows a code, B scans -->
	<g opacity={step === 2 ? 0.25 : 1}>
		<rect x="35" y="35" width="40" height="40" rx="4" fill={step === 1 || step === 0 ? 'var(--color-accent)' : 'var(--color-border)'} />
		<path d="M100 45 H 215" stroke="var(--color-accent)" stroke-width="3" fill="none" marker-end="url(#arrow)" />
		<text x="158" y="38" text-anchor="middle" font-size="11" fill="var(--color-fg)">1. B scannt</text>
		<circle cx="265" cy="52" r="9" fill="none" stroke="var(--color-accent)" stroke-width="3" />
	</g>
	<!-- step 2: B shows the reply code, A scans -->
	<g opacity={step === 1 ? 0.25 : 1}>
		<rect x="245" y="60" width="40" height="40" rx="4" fill={step === 2 || step === 0 ? 'var(--color-accent)' : 'var(--color-border)'} />
		<path d="M220 85 H 105" stroke="var(--color-accent)" stroke-width="3" fill="none" marker-end="url(#arrow)" />
		<text x="162" y="100" text-anchor="middle" font-size="11" fill="var(--color-fg)">2. A scannt</text>
		<circle cx="55" cy="82" r="9" fill="none" stroke="var(--color-accent)" stroke-width="3" />
	</g>
	<defs>
		<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
			<path d="M0 0 L10 5 L0 10 z" fill="var(--color-accent)" />
		</marker>
	</defs>
</svg>
