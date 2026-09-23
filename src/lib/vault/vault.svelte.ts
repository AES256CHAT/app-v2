// Reactive facade over the Vault plus the session guard (auto-lock, blur on focus loss).

import { browser } from '$app/environment';
import { Vault, type VaultStatus } from './vault';

export const vault = new Vault();

class VaultState {
	status = $state<VaultStatus>('loading');
	/** seconds until auto-lock while the warning is shown, else null */
	lockWarning = $state<number | null>(null);
	autoLockMinutes = $state(2);
	lockWhenHiddenSeconds = $state(30);

	private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
	private warningTimer: ReturnType<typeof setInterval> | null = null;
	private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
	private started = false;

	constructor() {
		vault.onChange((s) => {
			this.status = s;
			if (s === 'unlocked') this.resetInactivity();
			else this.clearTimers();
		});
	}

	async start(): Promise<void> {
		if (this.started || !browser) return;
		this.started = true;
		try {
			this.autoLockMinutes = Number(localStorage.getItem('autoLockMinutes') ?? 2) || 2;
		} catch {
			/* storage unavailable */
		}
		await vault.init();
		const activity = () => this.resetInactivity();
		for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
			window.addEventListener(ev, activity, { passive: true });
		}
		document.addEventListener('visibilitychange', () => this.onVisibility());
		window.addEventListener('blur', () => this.setBlur(true));
		window.addEventListener('focus', () => this.setBlur(false));
	}

	setAutoLockMinutes(min: number): void {
		this.autoLockMinutes = min;
		try {
			localStorage.setItem('autoLockMinutes', String(min));
		} catch {
			/* ignore */
		}
		this.resetInactivity();
	}

	lock(): void {
		vault.lock();
	}

	private setBlur(on: boolean): void {
		if (this.status !== 'unlocked') return;
		document.body.dataset.blur = on ? '1' : '';
	}

	private onVisibility(): void {
		if (document.hidden) {
			this.setBlur(true);
			if (this.status === 'unlocked') {
				this.hiddenTimer = setTimeout(() => vault.lock(), this.lockWhenHiddenSeconds * 1000);
			}
		} else {
			this.setBlur(false);
			if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
			this.hiddenTimer = null;
		}
	}

	private resetInactivity(): void {
		if (this.status !== 'unlocked') return;
		this.clearTimers();
		const total = this.autoLockMinutes * 60_000;
		const warnAt = Math.max(total - 15_000, 0);
		this.inactivityTimer = setTimeout(() => {
			let left = Math.round((total - warnAt) / 1000);
			this.lockWarning = left;
			this.warningTimer = setInterval(() => {
				left -= 1;
				this.lockWarning = left;
				if (left <= 0) vault.lock();
			}, 1000);
		}, warnAt);
	}

	private clearTimers(): void {
		if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
		if (this.warningTimer) clearInterval(this.warningTimer);
		if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
		this.inactivityTimer = this.warningTimer = this.hiddenTimer = null;
		this.lockWarning = null;
		if (browser) document.body.dataset.blur = '';
	}
}

export const vaultState = new VaultState();
