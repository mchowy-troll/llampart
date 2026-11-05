/** Library-independent diagnostics. Never carry exception messages or source payloads. */
export const VISUALIZATION_PROBLEMS = {
	'chart.json': ['source', 'json'],
	'chart.required': ['source', 'required'],
	'chart.type': ['source', 'unsupported'],
	'chart.columnMissing': ['source', 'missingColumn'],
	'chart.columnPartial': ['source', 'missingColumn'],
	'chart.field': ['source', 'invalidField'],
	'chart.columns': ['source', 'unknownColumn'],
	'chart.collision': ['source', 'collision'],
	'chart.duplicate': ['source', 'duplicate'],
	'chart.forbidden': ['policy', 'policy'],
	'chart.sourceLimit': ['limit', 'sourceLimit'],
	'chart.dataLimit': ['limit', 'dataLimit'],
	'chart.seriesLimit': ['limit', 'seriesLimit'],
	'chart.countLimit': ['limit', 'countLimit'],
	'chart.module': ['infrastructure', 'infrastructure'],
	'chart.render': ['render', 'render'],
	'chart.incomplete': ['source', 'incomplete'],
	'diagram.unsupported': ['source', 'unsupported'],
	'diagram.policy': ['policy', 'policy'],
	'diagram.sourceLimit': ['limit', 'sourceLimit'],
	'diagram.edgeLimit': ['limit', 'dataLimit'],
	'diagram.countLimit': ['limit', 'countLimit'],
	'diagram.syntax': ['source', 'syntax'],
	'diagram.module': ['infrastructure', 'infrastructure'],
	'diagram.render': ['render', 'render'],
	'diagram.svg': ['render', 'svg'],
	'diagram.cancelled': ['render', null],
	'diagram.incomplete': ['source', 'incomplete']
} as const;

export type VisualizationCode = keyof typeof VISUALIZATION_PROBLEMS;
export type VisualizationDiagnostic = {
	[K in VisualizationCode]: {
		kind: K extends `chart.${string}` ? 'chart' : 'diagram';
		code: K;
		category: (typeof VISUALIZATION_PROBLEMS)[K][0];
		params: Readonly<Partial<Record<'field' | 'column' | 'limit', string>>>;
		path?: string;
		line?: number;
	};
}[VisualizationCode];

/** Bound display fragments and remove controls/bidi overrides. UI must use text, never HTML. */
export function diagnosticText(value: string): string {
	// eslint-disable-next-line no-control-regex -- Deliberately strip untrusted control characters.
	return value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 120);
}

export function diagnostic(
	code: VisualizationCode,
	options: { path?: string; column?: string; limit?: number; line?: number } = {}
): VisualizationDiagnostic {
	const path = options.path === undefined ? undefined : diagnosticText(options.path);
	return {
		kind: code.startsWith('chart.') ? 'chart' : 'diagram',
		code,
		category: VISUALIZATION_PROBLEMS[code][0],
		params: {
			...(path !== undefined ? { field: path } : {}),
			...(options.column !== undefined ? { column: diagnosticText(options.column) } : {}),
			...(Number.isSafeInteger(options.limit) ? { limit: String(options.limit) } : {})
		},
		...(path !== undefined ? { path } : {}),
		...(Number.isSafeInteger(options.line) && options.line! > 0 && options.line! <= 1200
			? { line: options.line }
			: {})
	} as VisualizationDiagnostic;
}

export class VisualizationError extends Error {
	constructor(public readonly diagnostic: VisualizationDiagnostic) {
		super(diagnostic.code);
		this.name = 'VisualizationError';
	}
}

export function visualizationFailure(error: unknown, fallback: VisualizationCode) {
	return error instanceof VisualizationError ? error.diagnostic : diagnostic(fallback);
}

/** Only fixed catalog keys and bounded parameters cross into presentation. */
export function diagnosticMessage(
	problem: VisualizationDiagnostic,
	translate: (key: string) => string
): string {
	const key = VISUALIZATION_PROBLEMS[problem.code][1];
	if (!key) return '';
	return translate(`visualizationErrors.${key}`).replace(/\{(field|column|limit)\}/g, (_, name) => {
		const text = diagnosticText(problem.params[name as keyof typeof problem.params] ?? '');
		return key === 'unknownColumn' && name === 'field' ? (text ? ` (${text})` : '') : text;
	});
}
