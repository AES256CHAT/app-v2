// IndexedDB layout. Everything in `records` is AES-256-GCM ciphertext; the only plaintext
// columns are opaque local keys needed for indexing (`table`, `id`, `k1`, `ts`).

import Dexie, { type EntityTable } from 'dexie';
import type { KdfParams } from '$lib/crypto/kdf';

export type HistoryMode = 'ephemeral' | 'persist';

export interface VaultMeta {
	id: 'v1';
	version: 1;
	salt: string; // b64u
	kdf: KdfParams;
	wrappedDek: string; // b64u(iv ‖ ct)
	createdAt: number;
	history: HistoryMode;
	retentionDays: number; // 0 = keep forever (persist mode only)
	destroyAfterFails: boolean;
	failedAttempts: number;
	lockoutUntil: number;
}

export interface EncryptedRecord {
	table: string;
	id: string;
	/** optional plaintext grouping key (e.g. local contact key) */
	k1?: string;
	/** optional plaintext sort key */
	ts?: number;
	iv: Uint8Array;
	ct: Uint8Array;
}

export class VaultDb extends Dexie {
	meta!: EntityTable<VaultMeta, 'id'>;
	records!: EntityTable<EncryptedRecord, 'id'>;

	constructor(name = 'aes256chat') {
		super(name);
		this.version(1).stores({
			meta: 'id',
			records: '[table+id], table, [table+k1+ts]'
		});
	}
}
