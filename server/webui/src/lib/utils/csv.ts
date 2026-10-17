/** Shared spreadsheet-safe CSV policy. Charts keep the default, typed-number behavior. */
function field(value: string | number, preserveNumericText: boolean): string {
	// Only complete, unpadded decimal literals may bypass formula protection in DOM tables.
	// Keep the original string, including decimal commas, precision and leading zeros.
	const numericText =
		preserveNumericText && /^-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(String(value));
	// DOM text can also contain invisible combining marks/fillers. Keep the legacy
	// chart pattern byte-for-byte; table mode additionally covers all default-ignorables.
	const formulaPrefix = preserveNumericText
		? /^(?=[\s\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]*[=+@-])/u
		: /^(?=[\s\p{Cc}\p{Cf}]*[=+@-])/u;
	let text =
		typeof value === 'number' || numericText ? String(value) : value.replace(formulaPrefix, "'");
	if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
	return text;
}

export function serializeCsv(
	rows: readonly (readonly (string | number)[])[],
	preserveNumericText = false
): string {
	return (
		'\uFEFF' +
		rows
			.map((row) => row.map((value) => field(value, preserveNumericText)).join(','))
			.join('\r\n') +
		'\r\n'
	);
}
