import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	initialize: vi.fn(),
	render: vi.fn(),
	verified: vi.fn(),
	append: vi.fn(),
	remove: vi.fn(),
	load: vi.fn(),
	parse: vi.fn()
}));
vi.mock('mermaid', () => ({
	default: {
		initialize: mocks.initialize,
		render: mocks.render,
		mermaidAPI: { getDiagramFromText: mocks.parse }
	}
}));
vi.mock('$lib/diagrams/mermaid-policy', async (original) => ({
	...(await original<object>()),
	verifiedDiagramSvg: mocks.verified
}));
vi.mock('$lib/diagrams/edge-label-layout', () => ({ spaceEdgeLabels: () => 0 }));
const font = { family: 'Local Face', size: 16, weight: '400', style: 'normal', color: '#111' };
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.stubGlobal('document', {
		fonts: { load: mocks.load.mockResolvedValue([]), ready: Promise.resolve() },
		body: { append: mocks.append },
		createElement: () => ({
			style: {},
			getContext: () => ({ measureText: (text: string) => ({ width: text.length * 8 }) }),
			setAttribute: vi.fn(),
			remove: mocks.remove,
			replaceChildren: vi.fn()
		})
	});
	vi.stubGlobal(
		'XMLSerializer',
		class {
			serializeToString(value: { source: string }) {
				return value.source;
			}
		}
	);
	mocks.verified.mockImplementation((svg) => ({
		source: svg,
		viewBox: { baseVal: { x: 0, y: 0, width: 100, height: 100 } },
		setAttribute: vi.fn(),
		querySelectorAll: () => []
	}));
	mocks.render.mockResolvedValue({ svg: '<svg/>' });
	mocks.parse.mockResolvedValue({
		db: {
			getData: () => ({ nodes: [] }),
			getSubGraphs: () => [],
			getRootDocV2: () => [],
			extract: vi.fn()
		}
	});
});
afterEach(() => vi.unstubAllGlobals());

describe('Mermaid async lifecycle', () => {
	it('validates original Mindmap syntax before changing only its render-local root', async () => {
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		const source = 'mindmap\nroot((Firma))\n  A';
		await renderDiagram(source, font, new AbortController().signal);
		expect(mocks.parse).toHaveBeenCalledWith(source);
		expect(mocks.render.mock.calls[0][1]).toBe('mindmap\nroot(Firma)\n  A');
		mocks.parse.mockRejectedValueOnce(new Error('Invalid original syntax'));
		await expect(renderDiagram(source, font, new AbortController().signal)).rejects.toThrow(
			'Invalid original syntax'
		);
		expect(mocks.render).toHaveBeenCalledOnce();
	});
	it('uses native shared State ports and wraps labels without editing the original source', async () => {
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		const source = 'stateDiagram-v2\nA --> B: Dane poprawne';
		await renderDiagram(source, font, new AbortController().signal);
		expect(mocks.parse).toHaveBeenCalledWith(source);
		expect(mocks.render.mock.calls[0][1]).toContain('Dane<br/>poprawne');
		expect(mocks.initialize.mock.calls[0][0].elk.mergeEdges).toBe(true);
	});
	it('waits for local font loading before measuring', async () => {
		const fonts = deferred<unknown[]>();
		mocks.load.mockReturnValueOnce(fonts.promise);
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		const result = renderDiagram('flowchart LR\nA --> B', font, new AbortController().signal);
		await vi.waitFor(() => expect(mocks.load).toHaveBeenCalled());
		expect(mocks.render).not.toHaveBeenCalled();
		fonts.resolve([]);
		expect(await result).toBe('<svg/>');
		expect(mocks.load).toHaveBeenCalledWith('normal 400 16px Local Face');
		expect(mocks.remove).toHaveBeenCalledOnce();
	});
	it('serializes configuration with rendering and skips cancelled queued jobs', async () => {
		const gate = deferred<{ svg: string }>();
		mocks.render.mockReturnValueOnce(gate.promise);
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		const first = renderDiagram('flowchart LR\nA --> B', font, new AbortController().signal);
		const cancelled = new AbortController();
		const second = renderDiagram('gantt\nTest', font, cancelled.signal).catch((error) => error);
		const third = renderDiagram(
			'mindmap\n root',
			{ ...font, size: 20 },
			new AbortController().signal
		);
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
		expect(mocks.initialize).toHaveBeenCalledTimes(1);
		cancelled.abort();
		gate.resolve({ svg: '<svg>first</svg>' });
		await first;
		expect((await second).name).toBe('AbortError');
		await third;
		expect(mocks.initialize).toHaveBeenCalledTimes(2);
		expect(mocks.initialize.mock.calls[1][0].fontSize).toBe(20);
		expect(mocks.remove).toHaveBeenCalledTimes(2);
	});
	it('rejects a late active result after source/theme/font/conversation cancellation', async () => {
		const gate = deferred<{ svg: string }>();
		mocks.render.mockReturnValueOnce(gate.promise);
		const controller = new AbortController();
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		const result = renderDiagram('flowchart LR\nA --> B', font, controller.signal).catch(
			(error) => error
		);
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
		controller.abort();
		gate.resolve({ svg: '<svg>stale</svg>' });
		expect((await result).name).toBe('AbortError');
		expect(mocks.verified).not.toHaveBeenCalled();
		expect(mocks.remove).toHaveBeenCalledOnce();
	});
	it('cleans scratch DOM after parser failure and keeps the queue usable', async () => {
		mocks.render.mockRejectedValueOnce(new Error('Parse error'));
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		await expect(
			renderDiagram('flowchart LR\n[broken', font, new AbortController().signal)
		).rejects.toThrow('Parse error');
		await expect(renderDiagram('mindmap\n root', font, new AbortController().signal)).resolves.toBe(
			'<svg/>'
		);
		expect(mocks.remove).toHaveBeenCalledTimes(2);
	});
	it('rejects disallowed types before touching fonts/DOM/engine', async () => {
		const { renderDiagram } = await import('$lib/diagrams/mermaid-runtime');
		expect(() => renderDiagram('pie\nA: 1', font, new AbortController().signal)).toThrow();
		expect(mocks.render).not.toHaveBeenCalled();
		expect(mocks.append).not.toHaveBeenCalled();
	});
});
