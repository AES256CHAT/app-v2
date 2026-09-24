// Ties the backup format to the stores: what goes in, how a restore is applied.

import { backupFileName, openBackup, sealBackup, type BackupPayload } from './backup';
import { exportMe, importMe, type StoredIdentity } from './me';
import { vault } from './vault.svelte';
import { contacts, type ContactRecord } from '$lib/store/contacts.svelte';
import { messages, type ChatMessage } from '$lib/store/messages.svelte';
import type { HistoryMode } from './db';

export async function createBackup(pw: string, includeMessages: boolean): Promise<{ bytes: Uint8Array; fileName: string }> {
	const me = await exportMe();
	if (!me) throw new Error('no identity');
	const payload: BackupPayload = {
		v: 1,
		createdAt: Date.now(),
		me,
		contacts: await contacts.exportAll(),
		settings: { history: vault.info?.history ?? 'ephemeral', retentionDays: vault.info?.retentionDays ?? 7 }
	};
	if (includeMessages) payload.messages = await messages.exportAll();
	return { bytes: await sealBackup(payload, pw), fileName: backupFileName() };
}

/** Decrypt only — lets the UI confirm before anything is written. */
export async function inspectBackup(bytes: Uint8Array, pw: string): Promise<BackupPayload> {
	return openBackup(bytes, pw);
}

/**
 * Create a fresh vault with `masterPw` and fill it from the backup. Existing vault must be
 * gone (caller destroys it after explicit confirmation).
 */
export async function restoreBackup(payload: BackupPayload, masterPw: string, history?: HistoryMode): Promise<void> {
	await vault.create(masterPw, { history: history ?? payload.settings?.history ?? 'ephemeral', retentionDays: payload.settings?.retentionDays });
	await importMe(payload.me as StoredIdentity);
	await contacts.importAll(payload.contacts as ContactRecord[]);
	if (payload.messages?.length) await messages.importAll(payload.messages as ChatMessage[]);
}
