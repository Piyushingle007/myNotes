import 'svelte/elements';

declare module 'svelte/elements' {
	interface HTMLAttributes<T> {
		onlongpress?: (event: CustomEvent<{ x: number; y: number }>) => void;
	}
}
