import type { VisualizationSource } from '$lib/types/visualization-source';
import type { VisualizationCode, VisualizationDiagnostic } from './diagnostics';
import { VISUALIZATION_PROBLEMS } from './diagnostics';

export type RepairStage =
	| 'source'
	| 'idle-model'
	| 'request'
	| 'provider-result'
	| 'fenced-block'
	| 'renderer'
	| 'cas-publication';
export type RepairCategory =
	| 'ok'
	| 'source-unavailable'
	| 'source-changed'
	| 'source-verification-failed'
	| 'unavailable'
	| 'context-changed'
	| 'busy'
	| 'writer-changed'
	| 'module-load'
	| 'request-failed'
	| 'provider-result-invalid'
	| 'provider-refusal'
	| 'provider-tools'
	| 'status-missing'
	| 'status-incomplete'
	| 'status-failed'
	| 'status-cancelled'
	| 'status-unknown'
	| 'finish-missing'
	| 'finish-length'
	| 'finish-incomplete'
	| 'finish-failed'
	| 'finish-cancelled'
	| 'finish-unknown'
	| 'finish-protocol-mismatch'
	| 'ok-finish-stop'
	| 'ok-finish-completed'
	| 'ok-status-completed'
	| 'response-limit'
	| 'fence-rejected'
	| 'renderer-rejected'
	| 'renderer-unchanged'
	| 'cas-rejected'
	| 'publication-skipped'
	| 'publication-failed'
	| 'aborted'
	| 'timeout';

/** Fixed metadata only. Never accept an exception, source, provider payload or IDs. */
export function repairDiagnostic(
	stage: RepairStage,
	kind: 'chart' | 'diagram',
	code: VisualizationCode,
	category: RepairCategory
): void {
	if (import.meta.env.DEV)
		console.info('[visualization-repair]', {
			stage,
			kind,
			code: Object.hasOwn(VISUALIZATION_PROBLEMS, code) ? code : 'unknown',
			category
		});
}

const repairableCodes: ReadonlySet<VisualizationCode> = new Set<VisualizationCode>([
	'chart.json',
	'chart.required',
	'chart.type',
	'chart.columnMissing',
	'chart.columnPartial',
	'chart.field',
	'chart.columns',
	'chart.collision',
	'chart.duplicate',
	'diagram.syntax'
]);

export function canRepairVisualization(problem?: VisualizationDiagnostic): boolean {
	return !!problem && repairableCodes.has(problem.code);
}

export const VISUALIZATION_REPAIR_CONTEXT = Symbol('visualization-repair');
export interface VisualizationRepairContext {
	available: () => boolean;
	owns: (source: VisualizationSource) => boolean;
	resolve: (element: HTMLElement) => Promise<VisualizationSource | null>;
}
