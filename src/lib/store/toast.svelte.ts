class ToastState {
	text = $state<string | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	show(text: string, ms = 2500): void {
		this.text = text;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => (this.text = null), ms);
	}
}

export const toast = new ToastState();
