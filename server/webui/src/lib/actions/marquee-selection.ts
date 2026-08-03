export interface MarqueeSelectionOptions {
	enabled: boolean;
	selectedIds: string[];
	onSelectionChange: (ids: string[]) => void;
}

const DRAG_THRESHOLD = 4;

function intersects(a: DOMRect, b: DOMRect): boolean {
	return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function marqueeSelection(node: HTMLElement, initialOptions: MarqueeSelectionOptions) {
	let options = initialOptions;
	let cleanupDrag: (() => void) | undefined;
	let suppressClick = false;

	function handlePointerDown(event: PointerEvent) {
		if (!options.enabled || event.button !== 0) return;
		if ((event.target as HTMLElement).closest('button, a, input, [data-conversation-selection-id]'))
			return;

		const startX = event.clientX;
		const startY = event.clientY;
		const additive = event.ctrlKey || event.metaKey;
		const initialSelection = new Set(options.selectedIds);
		let dragging = false;
		const overlay = document.createElement('div');

		overlay.setAttribute('aria-hidden', 'true');
		overlay.style.cssText =
			'position:fixed;z-index:50;pointer-events:none;border:1px solid var(--llampart-sidebar-selection-accent);background:color-mix(in oklch, var(--llampart-sidebar-selection-accent) 14%, transparent);';

		function handlePointerMove(moveEvent: PointerEvent) {
			const left = Math.min(startX, moveEvent.clientX);
			const top = Math.min(startY, moveEvent.clientY);
			const width = Math.abs(moveEvent.clientX - startX);
			const height = Math.abs(moveEvent.clientY - startY);

			if (!dragging && Math.max(width, height) < DRAG_THRESHOLD) return;
			if (!dragging) {
				dragging = true;
				document.body.appendChild(overlay);
			}

			moveEvent.preventDefault();
			overlay.style.left = `${left}px`;
			overlay.style.top = `${top}px`;
			overlay.style.width = `${width}px`;
			overlay.style.height = `${height}px`;

			const selectionRect = new DOMRect(left, top, width, height);
			const nextSelection = additive ? new Set(initialSelection) : new Set<string>();

			for (const item of node.querySelectorAll<HTMLElement>('[data-conversation-selection-id]')) {
				if (intersects(selectionRect, item.getBoundingClientRect())) {
					nextSelection.add(item.dataset.conversationSelectionId!);
				}
			}

			options.onSelectionChange([...nextSelection]);
		}

		function finishDrag() {
			if (dragging) {
				suppressClick = true;
				setTimeout(() => {
					suppressClick = false;
				});
			}
			overlay.remove();
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', finishDrag);
			window.removeEventListener('pointercancel', finishDrag);
			cleanupDrag = undefined;
		}

		cleanupDrag = finishDrag;
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', finishDrag);
		window.addEventListener('pointercancel', finishDrag);
	}

	function handleClick(event: MouseEvent) {
		if (!suppressClick) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	node.addEventListener('pointerdown', handlePointerDown);
	node.addEventListener('click', handleClick, true);

	return {
		update(nextOptions: MarqueeSelectionOptions) {
			options = nextOptions;
		},
		destroy() {
			cleanupDrag?.();
			node.removeEventListener('pointerdown', handlePointerDown);
			node.removeEventListener('click', handleClick, true);
		}
	};
}
