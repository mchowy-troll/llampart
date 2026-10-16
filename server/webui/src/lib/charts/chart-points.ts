/** Solid persistent dots sit directly on the stroke; only hover has an outline. */
export const STATIC_CHART_POINTS = { r: 3.25, stroke: 'none', strokeWidth: 0 } as const;
export const HOVER_CHART_POINTS = { r: 4.5, strokeWidth: 2, stroke: 'white' } as const;
// Preserve the existing density rule; dense charts still expose hover points.
export const showStaticChartPoints = (rows: number) => rows <= 40;
