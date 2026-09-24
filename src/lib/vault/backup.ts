// Encrypted vault backup: identity, contacts (with their ratchet state) and optionally
// persisted messages. One file, one passphrase (the master passphrase by default).
//
//   MAGIC ‖ salt(16) ‖ m(4) ‖ t(4) ‖ p(4) ‖ iv(12) ‖ AES-256-GCM(JSON)
//
// A restored ratchet state may be older than what the peer has seen; the store therefore
// marks every restored session as stale and requires a fresh handshake before sending.

import { aesGcmDecrypt, aesGcmEncrypt } from '$lib/crypto/aead';
import { concat, equalBytes, randomBytes, readU32be, u32be, utf8, wipe } from '$lib/crypto/bytes';
import { DEFAULT_KDF, deriveKek, type KdfParams } from '$lib/crypto/kdf';

export const BACKUP_MAGIC = utf8.encode('A256CHAT-BK1\n');
export const BACKUP_EXT = '.a256bak';
const AAD = utf8.encode('AES256CHAT-backup-v1');

export interface BackupPayload {
	v: 1;
	createdAt: number;
	me: { edSec: string; xSec: string; kemSeed: string; createdAt: number; name: string };
	contacts: unknown[];
	messages?: unknown[];
	settings?: { history: 'ephemeral' | 'persist'; retentionDays: number };
}

export class BackupError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = 'BackupError';
	}
}

export async function sealBackup(payload: BackupPayload, pw: string, kdf: KdfParams = DEFAULT_KDF): Promise<Uint8Array> {
	const salt = randomBytes(16);
	const key = await deriveKek(pw, salt, kdf);
	const iv = randomBytes(12);
	const ct = await aesGcmEncrypt(key, iv, utf8.encode(JSON.stringify(payload)), AAD);
	wipe(key);
	return concat(BACKUP_MAGIC, salt, u32be(kdf.m), u32be(kdf.t), u32be(kdf.p), iv, ct);
}

export function isBackup(bytes: Uint8Array): boolean {
	return bytes.length > BACKUP_MAGIC.length + 16 + 12 + 12 && equalBytes(bytes.slice(0, BACKUP_MAGIC.length), BACKUP_MAGIC);
}

export async function openBackup(bytes: Uint8Array, pw: string): Promise<BackupPayload> {
	if (!isBackup(bytes)) throw new BackupError('not a backup file');
	let off = BACKUP_MAGIC.length;
	const salt = bytes.slice(off, off + 16);
	off += 16;
	const kdf: KdfParams = { m: readU32be(bytes, off), t: readU32be(bytes, off + 4), p: readU32be(bytes, off + 8) };
	off += 12;
	if (kdf.m > 1024 * 1024 || kdf.t > 20 || kdf.p > 4 || kdf.m < 1024) throw new BackupError('invalid backup parameters');
	const iv = bytes.slice(off, off + 12);
	off += 12;
	const key = await deriveKek(pw, salt, kdf);
	try {
		const pt = await aesGcmDecrypt(key, iv, bytes.slice(off), AAD);
		const p = JSON.parse(utf8.decode(pt)) as BackupPayload;
		if (p.v !== 1 || !p.me?.edSec || !Array.isArray(p.contacts)) throw new BackupError('unsupported backup');
		return p;
	} finally {
		wipe(key);
	}
}

export function backupFileName(ts = Date.now()): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `aes256chat-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${BACKUP_EXT}`;
}
