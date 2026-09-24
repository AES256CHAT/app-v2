<script lang="ts">
	import { AuthError } from '$lib/crypto/aead';
	import { i18n, t } from '$lib/i18n/index.svelte';
	import { live } from '$lib/store/live.svelte';
	import { toast } from '$lib/store/toast.svelte';
	import { MIN_PASSPHRASE_LEN } from '$lib/vault/vault';
	import { estimate } from '$lib/vault/strength';
	import { createBackup, inspectBackup, restoreBackup } from '$lib/vault/backup-service';
	import { shareOrDownload } from '$lib/transport/share';
	import type { BackupPayload } from '$lib/vault/backup';
	import { vault, vaultState } from '$lib/vault/vault.svelte';
	import type { HistoryMode } from '$lib/vault/db';

	const info = $derived(vault.info);
	let history = $state<HistoryMode>(vault.info?.history ?? 'ephemeral');
	let retention = $state(vault.info?.retentionDays ?? 7);
	let destroy = $state(vault.info?.destroyAfterFails ?? false);
	let oldPw = $state('');
	let newPw = $state('');
	let pwError = $state<string | null>(null);
	let confirmWipe = $state(false);
	let bkPw = $state('');
	let bkCustom = $state(false);
	let bkMessages = $state(false);
	let bkBusy = $state(false);
	let bkError = $state<string | null>(null);
	let rsFile = $state<File | null>(null);
	let rsPw = $state('');
	let rsPayload = $state<BackupPayload | null>(null);
	let rsError = $state<string | null>(null);
	let rsBusy = $state(false);

	async function makeBackup(e: SubmitEvent) {
		e.preventDefault();
		bkError = null;
		bkBusy = true;
		try {
			// With "use master passphrase" the entered one must really be the master passphrase —
			// otherwise a typo would silently produce a backup nobody can open.
			if (!bkCustom && !(await vault.verifyPassphrase(bkPw))) throw new Error(t('lockWrong'));
			const { bytes, fileName } = await createBackup(bkPw, bkMessages);
			const how = await shareOrDownload(bytes, fileName, 'application/octet-stream');
			if (how !== 'cancelled') toast.show(t('bkDone', { name: fileName }));
			bkPw = '';
		} catch (err) {
			bkError = (err as Error).message;
		} finally {
			bkBusy = false;
		}
	}

	async function inspectRestore(e: SubmitEvent) {
		e.preventDefault();
		rsError = null;
		if (!rsFile) return;
		rsBusy = true;
		try {
			rsPayload = await inspectBackup(new Uint8Array(await rsFile.arrayBuffer()), rsPw);
		} catch (err) {
			rsError = err instanceof AuthError ? t('bkWrongPw') : t('bkInvalid');
		} finally {
			rsBusy = false;
		}
	}

	async function applyRestore() {
		if (!rsPayload) return;
		rsBusy = true;
		try {
			const p = rsPayload;
			const pw = rsPw;
			await vault.destroy();
			await restoreBackup(p, pw);
			rsPayload = null;
			rsPw = '';
			toast.show(t('bkRestored', { n: p.contacts.length }));
		} catch (err) {
			rsError = (err as Error).message;
		} finally {
			rsBusy = false;
		}
	}

	const autoLockOptions = [1, 2, 5, 10, 30];
	const retentionOptions = [1, 7, 30, 0];

	async function saveHistory(h: HistoryMode) {
		history = h;
		await vault.updateSettings({ history: h });
	}
	async function saveRetention(d: number) {
		retention = d;
		await vault.updateSettings({ retentionDays: d });
	}
	async function saveDestroy(v: boolean) {
		destroy = v;
		await vault.updateSettings({ destroyAfterFails: v });
	}

	async function changePass(e: SubmitEvent) {
		e.preventDefault();
		pwError = null;
		if (newPw.length < MIN_PASSPHRASE_LEN) return (pwError = t('onbPassShort', { min: MIN_PASSPHRASE_LEN }));
		if (estimate(newPw).score < 1) return (pwError = t('strength0'));
		try {
			await vault.changePassphrase(oldPw, newPw);
			oldPw = newPw = '';
			toast.show(t('setPassChanged'));
		} catch (err) {
			pwError = err instanceof AuthError ? t('lockWrong') : (err as Error).message;
		}
	}
</script>

<main class="flex flex-1 flex-col gap-5 p-6">
	<header class="flex items-center gap-3">
		<a href="/" class="text-muted text-sm" aria-label={t('back')}>←</a>
		<h1 class="text-xl font-semibold">{t('settings')}</h1>
	</header>

	<section class="card">
		<label class="row">
			<span>{t('setLanguage')}</span>
			<select class="field" value={i18n.lang} onchange={(e) => i18n.set((e.currentTarget as HTMLSelectElement).value as 'de' | 'en')}>
				<option value="de">Deutsch</option>
				<option value="en">English</option>
			</select>
		</label>
		<label class="row">
			<span>{t('setAutoLock')}</span>
			<select class="field" value={String(vaultState.autoLockMinutes)} onchange={(e) => vaultState.setAutoLockMinutes(Number((e.currentTarget as HTMLSelectElement).value))}>
				{#each autoLockOptions as m (m)}<option value={String(m)}>{t('setMinutes', { n: m })}</option>{/each}
			</select>
		</label>
	</section>

	<section class="card">
		<div class="mb-2 font-medium">{t('setHistory')}</div>
		<label class="option" class:selected={history === 'ephemeral'}>
			<input type="radio" checked={history === 'ephemeral'} onchange={() => saveHistory('ephemeral')} />
			<span><b>{t('onbEphemeral')}</b><br /><span class="text-muted text-xs">{t('onbEphemeralHint')}</span></span>
		</label>
		<label class="option mt-2" class:selected={history === 'persist'}>
			<input type="radio" checked={history === 'persist'} onchange={() => saveHistory('persist')} />
			<span><b>{t('onbPersist')}</b><br /><span class="text-muted text-xs">{t('onbPersistHint')}</span></span>
		</label>
		{#if history === 'persist'}
			<label class="row mt-3">
				<span>{t('setRetention')}</span>
				<select class="field" value={String(retention)} onchange={(e) => saveRetention(Number((e.currentTarget as HTMLSelectElement).value))}>
					{#each retentionOptions as d (d)}
						<option value={String(d)}>{d === 0 ? t('setRetentionNever') : t('setRetentionDays', { n: d })}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class="option mt-3" class:selected={destroy}>
			<input type="checkbox" checked={destroy} onchange={(e) => saveDestroy((e.currentTarget as HTMLInputElement).checked)} />
			<span><b>{t('setDestroy')}</b><br /><span class="text-muted text-xs">{t('onbDestroyHint')}</span></span>
		</label>
	</section>

	<section class="card">
		<div class="font-medium">⚡ {t('liveTitle')}</div>
		<label class="option mt-2" class:selected={live.stunEnabled}>
			<input type="checkbox" checked={live.stunEnabled} onchange={(e) => live.setStun((e.currentTarget as HTMLInputElement).checked)} data-testid="stun-toggle" />
			<span><b>{t('setStun')}</b><br /><span class="text-muted text-xs">{t('setStunHint')}</span></span>
		</label>
	</section>

	<form class="card flex flex-col gap-2" onsubmit={changePass}>
		<div class="font-medium">{t('setChangePass')}</div>
		<input class="field" type="password" bind:value={oldPw} placeholder={t('setOldPass')} autocomplete="current-password" required />
		<input class="field" type="password" bind:value={newPw} placeholder={t('setNewPass')} autocomplete="new-password" required />
		{#if pwError}<p class="text-danger text-sm" role="alert">{pwError}</p>{/if}
		<button class="btn" type="submit" disabled={!oldPw || !newPw}>{t('save')}</button>
	</form>

	<section class="card">
		<div class="font-medium">{t('setWipe')}</div>
		<p class="text-muted mt-1 text-xs">{t('setWipeHint')}</p>
		{#if !confirmWipe}
			<button class="btn text-danger mt-3" onclick={() => (confirmWipe = true)}>{t('setWipe')}</button>
		{:else}
			<p class="text-danger mt-3 text-sm">{t('setWipeConfirm')}</p>
			<div class="mt-2 flex gap-2">
				<button class="btn" onclick={() => (confirmWipe = false)}>{t('cancel')}</button>
				<button class="btn text-danger font-semibold" onclick={() => vault.destroy()}>{t('yes')}</button>
			</div>
		{/if}
	</section>

	<form class="card flex flex-col gap-2" onsubmit={makeBackup} data-testid="backup-form">
		<div class="font-medium">💾 {t('bkTitle')}</div>
		<p class="text-muted text-xs">{t('bkHint')}</p>
		<label class="option mt-1" class:selected={!bkCustom}>
			<input type="checkbox" checked={!bkCustom} onchange={(e) => (bkCustom = !(e.currentTarget as HTMLInputElement).checked)} />
			<span><b>{t('bkUseMaster')}</b><br /><span class="text-muted text-xs">{t('bkUseMasterHint')}</span></span>
		</label>
		<input class="field" type="password" bind:value={bkPw} placeholder={bkCustom ? t('bkCustomPw') : t('lockPass')} autocomplete="off" required data-testid="backup-pw" />
		{#if info?.history === 'persist'}
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={bkMessages} /> {t('bkMessages')}</label>
		{/if}
		{#if bkError}<p class="text-danger text-sm" role="alert">{bkError}</p>{/if}
		<button class="btn" type="submit" disabled={bkBusy || bkPw.length < MIN_PASSPHRASE_LEN} data-testid="backup-create">{t('bkCreate')}</button>
	</form>

	<form class="card flex flex-col gap-2" onsubmit={inspectRestore}>
		<div class="font-medium">♻️ {t('bkRestoreTitle')}</div>
		<p class="text-muted text-xs">{t('bkRestoreHint')}</p>
		<input class="field" type="file" accept=".a256bak" onchange={(e) => (rsFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} data-testid="restore-file" />
		<input class="field" type="password" bind:value={rsPw} placeholder={t('bkFilePw')} autocomplete="off" required data-testid="restore-pw" />
		{#if rsError}<p class="text-danger text-sm" role="alert">{rsError}</p>{/if}
		{#if rsPayload}
			<div class="bg-surface-2 border-warn rounded-xl border p-3 text-sm" data-testid="restore-confirm">
				<p>{t('bkRestoreConfirm', { name: rsPayload.me.name, n: rsPayload.contacts.length, date: new Date(rsPayload.createdAt).toLocaleDateString() })}</p>
				<div class="mt-2 flex gap-2">
					<button type="button" class="btn" onclick={() => (rsPayload = null)}>{t('cancel')}</button>
					<button type="button" class="btn text-danger font-semibold" onclick={applyRestore} disabled={rsBusy} data-testid="restore-apply">{t('bkRestoreApply')}</button>
				</div>
			</div>
		{:else}
			<button class="btn" type="submit" disabled={rsBusy || !rsFile || !rsPw}>{t('bkRestoreCheck')}</button>
		{/if}
	</form>

	<a class="card block" href="/tools/password" data-testid="pw-tool-link">
		<div class="font-medium">🔑 {t('pwTitle')}</div>
		<p class="text-muted mt-1 text-xs">{t('pwSettingsHint')}</p>
	</a>

	<p class="text-muted text-center text-xs">{t('setAbout')} · {info ? new Date(info.createdAt).toLocaleDateString() : ''}</p>
</main>

<style>
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 1rem;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.4rem 0;
	}
	.field {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.6rem;
		padding: 0.45rem 0.6rem;
	}
	.option {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.75rem;
		cursor: pointer;
	}
	.option.selected {
		border-color: var(--color-accent);
	}
	.btn {
		background: var(--color-surface-2);
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		padding: 0.55rem 0.9rem;
		text-align: left;
	}
	.btn:disabled {
		opacity: 0.5;
	}
</style>
