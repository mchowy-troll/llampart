import { mount, unmount } from 'svelte';
import type { VisualizationRendererInput } from '$lib/services/visualization-replacement';
import { diagramTypography } from '$lib/diagrams/mermaid-presentation';

/** Runs the actual production renderer offscreen, not just JSON or Mermaid.parse(). */
export async function validateRepairRenderer(
	candidate: VisualizationRendererInput,
	frame: HTMLElement,
	signal: AbortSignal,
	context: Map<unknown, unknown>
): Promise<boolean> {
	if (signal.aborted || !frame.isConnected) return false;
	if (candidate.kind === 'diagram') {
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		// Match DiagramBlock's actual typography, not the styled error card (whose
		// foreground may use a CSS color format unsupported by Mermaid's theme).
		const diagramFrame = frame.closest<HTMLElement>('.diagram-typography') ?? frame;
		const svg = await renderDiagram(
			candidate.source,
			diagramTypography(diagramFrame),
			signal,
			'rounded',
			diagramFrame.getBoundingClientRect().width
		);
		return !!svg && !signal.aborted && frame.isConnected;
	}
	const { default: Validator } =
		await import('$lib/components/app/content/VisualizationRepairChart.svelte');
	if (signal.aborted || !frame.isConnected) return false;
	const host = document.createElement('div');
	host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
	host.style.width = `${Math.max(640, frame.getBoundingClientRect().width)}px`;
	const css = getComputedStyle(frame);
	host.style.font = css.font;
	host.setAttribute('aria-hidden', 'true');
	host.inert = true;
	document.body.append(host);
	let component: ReturnType<typeof mount> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort: (() => void) | undefined;
	try {
		return await new Promise<boolean>((resolve) => {
			const finish = (valid: boolean) => resolve(valid && !signal.aborted && frame.isConnected);
			abort = () => finish(false);
			signal.addEventListener('abort', abort, { once: true });
			timer = setTimeout(() => finish(false), 8000);
			component = mount(Validator, {
				target: host,
				context,
				props: { spec: candidate.spec, onresult: finish }
			});
		});
	} finally {
		clearTimeout(timer);
		if (abort) signal.removeEventListener('abort', abort);
		if (component) await unmount(component);
		host.remove();
	}
}
