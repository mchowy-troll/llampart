import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import { AttachmentType } from '$lib/enums';
import {
	copyToClipboard,
	formatMessageForClipboard,
	formatTableRowsAsTsv,
	parseClipboardContent,
	hasClipboardAttachments
} from '$lib/utils/clipboard';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('copyToClipboard', () => {
	beforeEach(() => {
		vi.stubGlobal('document', { body: {} });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it('copies the exact text and reports success', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const text = '# Answer\n\n```ts\nconst value = "日本語";\n```\n';

		expect(await copyToClipboard(text)).toBe(true);
		expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
		expect(toast.success).toHaveBeenCalledWith('Copied to clipboard');
		expect(toast.error).not.toHaveBeenCalled();
	});

	it('reports a rejected clipboard write without claiming success', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(await copyToClipboard('Answer', 'Copied', 'Copy failed')).toBe(false);
		expect(toast.error).toHaveBeenCalledWith('Copy failed');
		expect(toast.success).not.toHaveBeenCalled();
	});
});

describe('formatTableRowsAsTsv', () => {
	it('preserves spreadsheet rows and columns without letting cell whitespace change their shape', () => {
		expect(
			formatTableRowsAsTsv([
				['Stage', 'Form', 'Score'],
				['First', '  Multi\nline  ', 'Tab\tvalue']
			])
		).toBe('Stage\tForm\tScore\nFirst\tMulti line\tTab value');
	});
});

describe('formatMessageForClipboard', () => {
	it('returns plain content when no extras', () => {
		expect(formatMessageForClipboard('Hello world', undefined)).toBe('Hello world');
	});

	it('filters non-text attachments and keeps only text ones', () => {
		const extras = [
			{
				type: AttachmentType.IMAGE as const,
				name: 'image.png',
				base64Url: 'data:image/png;base64,...'
			},
			{
				type: AttachmentType.TEXT as const,
				name: 'file.txt',
				content: 'Text content'
			},
			{
				type: AttachmentType.PDF as const,
				name: 'doc.pdf',
				base64Data: 'data:application/pdf;base64,...',
				content: 'PDF content',
				processedAsImages: false
			}
		];

		const [message, ...attachments] = formatMessageForClipboard('Hello', extras).split('\n');

		expect(JSON.parse(message)).toBe('Hello');
		expect(JSON.parse(attachments.join('\n'))).toEqual([extras[1]]);
	});

	it('converts legacy context type to TEXT type', () => {
		const extras = [
			{
				type: AttachmentType.LEGACY_CONTEXT as const,
				name: 'legacy.txt',
				content: 'Legacy content'
			}
		];
		const parsed = parseClipboardContent(formatMessageForClipboard('Hello', extras));

		expect(parsed.textAttachments).toEqual([
			{ type: AttachmentType.TEXT, name: 'legacy.txt', content: 'Legacy content' }
		]);
	});

	it('formats attachments as plain text when requested', () => {
		const extras = [
			{ type: AttachmentType.TEXT as const, name: 'file1.txt', content: 'File 1 content' },
			{ type: AttachmentType.TEXT as const, name: 'file2.txt', content: 'File 2 content' }
		];

		expect(formatMessageForClipboard('Hello world', extras, true)).toBe(
			'Hello world\n\nFile 1 content\n\nFile 2 content'
		);
	});
});

describe('parseClipboardContent', () => {
	it('preserves plain text whitespace without detecting attachments', () => {
		const input = '   \n\t  ';
		const result = parseClipboardContent(input);

		expect(result.message).toBe(input);
		expect(result.textAttachments).toHaveLength(0);
		expect(hasClipboardAttachments(input)).toBe(false);
	});

	it('returns original text when the message quote is unclosed', () => {
		const input = '"Unclosed quote';
		const result = parseClipboardContent(input);

		expect(result.message).toBe(input);
		expect(result.textAttachments).toHaveLength(0);
	});

	it('returns original text when the attachment array is malformed', () => {
		const input = '"Hello"\n[invalid json';
		const result = parseClipboardContent(input);

		expect(result.message).toBe(input);
		expect(result.textAttachments).toHaveLength(0);
		expect(hasClipboardAttachments(input)).toBe(false);
	});

	it('parses escaped message text and multiple attachments from the clipboard format', () => {
		const input = `"Hello \\"world\\"\\nnext line"
[
  {"type":"TEXT","name":"file1.txt","content":"File 1 content"},
  {"type":"TEXT","name":"file2.txt","content":"File 2 content"}
]`;

		const result = parseClipboardContent(input);

		expect(result.message).toBe('Hello "world"\nnext line');
		expect(result.textAttachments).toEqual([
			{ type: AttachmentType.TEXT, name: 'file1.txt', content: 'File 1 content' },
			{ type: AttachmentType.TEXT, name: 'file2.txt', content: 'File 2 content' }
		]);
		expect(hasClipboardAttachments(input)).toBe(true);
	});

	it('returns message only when no array follows', () => {
		const result = parseClipboardContent('"Just a quoted string"');

		expect(result.message).toBe('Just a quoted string');
		expect(result.textAttachments).toHaveLength(0);
	});

	it('filters out invalid attachment objects', () => {
		const input = `"Hello"
[
  {"type":"TEXT","name":"valid.txt","content":"valid"},
  {"type":"INVALID","name":"invalid.txt","content":"invalid"},
  {"name":"missing-type.txt","content":"missing"},
  {"type":"TEXT","content":"missing name"}
]`;

		const result = parseClipboardContent(input);

		expect(result.message).toBe('Hello');
		expect(result.textAttachments).toEqual([
			{ type: AttachmentType.TEXT, name: 'valid.txt', content: 'valid' }
		]);
	});

	it('does not detect an empty attachment array as attachments', () => {
		const input = '"Hello"\n[]';
		const result = parseClipboardContent(input);

		expect(result.message).toBe('Hello');
		expect(result.textAttachments).toHaveLength(0);
		expect(hasClipboardAttachments(input)).toBe(false);
	});

	it('roundtrips message and attachment content without changing escaping or whitespace', () => {
		const content = 'Привет 👋 "world"\t\n  C:\\\\Users\\\\test\r\n';
		const extras = [
			{
				type: AttachmentType.TEXT as const,
				name: 'code.js',
				content: 'const x = "日本語 🎉\\nworld";\nconst y = `template ${var}`;\t  '
			},
			{ type: AttachmentType.TEXT as const, name: 'empty.txt', content: '' }
		];
		const parsed = parseClipboardContent(formatMessageForClipboard(content, extras));

		expect(parsed.message).toBe(content);
		expect(parsed.textAttachments).toEqual(extras);
	});

	it('preserves empty message with attachments', () => {
		const extras = [
			{ type: AttachmentType.TEXT as const, name: 'file.txt', content: 'Content only' }
		];
		const parsed = parseClipboardContent(formatMessageForClipboard('', extras));

		expect(parsed.message).toBe('');
		expect(parsed.textAttachments).toEqual(extras);
	});
});
