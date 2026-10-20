/** The existing donut legend size is the shared visualization label reference. */
export const VISUALIZATION_LABEL_SIZE = 'calc(var(--llampart-text-unit, 1rem) * 0.8)';

/** Resolve the same CSS length for SVG layout, including responsive/user settings. */
export function visualizationLabelSize(element: HTMLElement): number {
	const probe = document.createElement('span');
	probe.style.cssText = `position:absolute;visibility:hidden;font-size:${VISUALIZATION_LABEL_SIZE}`;
	probe.setAttribute('aria-hidden', 'true');
	element.append(probe);
	try {
		return parseFloat(getComputedStyle(probe).fontSize);
	} finally {
		probe.remove();
	}
}
