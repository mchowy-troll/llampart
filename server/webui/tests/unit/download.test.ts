import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from '$lib/utils/download';

describe('downloadTextFile', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([false, true])(
		'preserves text and cleans up the download (click fails: %s)',
		async (fails) => {
			const anchor = {
				href: '',
				download: '',
				click: vi.fn(() => {
					if (fails) throw new Error('click failed');
				})
			};
			const appendChild = vi.fn();
			const removeChild = vi.fn();
			let downloadedBlob: Blob | undefined;
			const createObjectURL = vi.fn((blob: Blob) => {
				downloadedBlob = blob;
				return 'blob:response';
			});
			const revokeObjectURL = vi.fn();

			vi.stubGlobal('document', {
				createElement: vi.fn(() => anchor),
				body: { appendChild, removeChild }
			});
			vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

			const download = () => downloadTextFile('# Response', 'text/markdown', 'response.md');
			if (fails) expect(download).toThrow('click failed');
			else download();

			expect(downloadedBlob).toBeInstanceOf(Blob);
			if (!downloadedBlob) throw new Error('Expected a downloaded Blob');
			expect(downloadedBlob.type).toBe('text/markdown');
			expect(await downloadedBlob.text()).toBe('# Response');
			expect(anchor.href).toBe('blob:response');
			expect(anchor.download).toBe('response.md');
			expect(appendChild).toHaveBeenCalledWith(anchor);
			expect(anchor.click).toHaveBeenCalledOnce();
			expect(removeChild).toHaveBeenCalledWith(anchor);
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:response');
		}
	);
});
