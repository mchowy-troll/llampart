import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from '$lib/utils/download';

describe('downloadTextFile', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('downloads the provided text and releases the object URL', async () => {
		const anchor = {
			href: '',
			download: '',
			click: vi.fn()
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

		downloadTextFile('# Response', 'text/markdown', 'response.md');

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
	});

	it('releases the object URL and removes the anchor when clicking fails', () => {
		const anchor = {
			href: '',
			download: '',
			click: vi.fn(() => {
				throw new Error('click failed');
			})
		};
		const appendChild = vi.fn();
		const removeChild = vi.fn();
		const revokeObjectURL = vi.fn();

		vi.stubGlobal('document', {
			createElement: vi.fn(() => anchor),
			body: { appendChild, removeChild }
		});
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn(() => 'blob:response'),
			revokeObjectURL
		});

		expect(() => downloadTextFile('# Response', 'text/markdown', 'response.md')).toThrow(
			'click failed'
		);
		expect(removeChild).toHaveBeenCalledWith(anchor);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:response');
	});
});
