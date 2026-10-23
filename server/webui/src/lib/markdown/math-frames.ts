import { mount, unmount } from 'svelte';
import MathActions from '$lib/components/app/content/MathActions.svelte';
import '$lib/components/app/content/math-frame.css';

/** Enhance only completed KaTeX displays. HTML/cache contents stay presentation-neutral.
 * One observer per message; mounted controls are owned by the exact display node,
 * not its index (several formulas and streaming replacements are independent).
 */
export function mathFrames(container: HTMLElement, context: Map<unknown, unknown>) {
	const mounted = new Map<HTMLElement, ReturnType<typeof mount>>();
	const observer = new MutationObserver(reconcile);
	function reconcile() {
		for (const [display, component] of mounted) {
			if (!container.contains(display)) {
				void unmount(component);
				mounted.delete(display);
			}
		}
		for (const display of container.querySelectorAll<HTMLElement>('.katex-display')) {
			if (display.hasAttribute('data-math-incomplete')) continue;
			if (mounted.has(display)) continue;
			const annotation = display.querySelector('annotation[encoding="application/x-tex"]');
			if (!annotation || !display.querySelector('.katex-html')) continue;
			const frame = document.createElement('div');
			frame.className = 'llampart-visualization-frame llampart-math-frame';
			const controls = document.createElement('div');
			display.before(frame);
			frame.append(controls, display);
			mounted.set(
				display,
				mount(MathActions, {
					target: controls,
					context,
					props: { display, source: annotation.textContent ?? '' }
				})
			);
		}
	}
	reconcile();
	observer.observe(container, { childList: true, subtree: true });
	return {
		destroy() {
			observer.disconnect();
			for (const [display, component] of mounted) {
				void unmount(component);
				const frame = display.parentElement;
				if (frame?.classList.contains('llampart-math-frame')) frame.replaceWith(display);
			}
			mounted.clear();
		}
	};
}
