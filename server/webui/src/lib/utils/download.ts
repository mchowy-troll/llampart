/** Trigger a browser download for text content. */
export function downloadTextFile(text: string, mimeType: string, filename: string): void {
	const blob = new Blob([text], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	let appended = false;

	try {
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		appended = true;
		anchor.click();
	} finally {
		if (appended) {
			document.body.removeChild(anchor);
		}
		URL.revokeObjectURL(url);
	}
}
