import { AttachmentType, ContentPartType } from '$lib/enums';
import {
	DATA_URI_BASE64_REGEX,
	IMAGE_MIME_TO_EXTENSION,
	MCP_ATTACHMENT_NAME_PREFIX
} from '$lib/constants/mcp-resource';
import { NEWLINE_SEPARATOR } from '$lib/constants/agentic';
import type { DatabaseMessageExtraImageFile } from '$lib/types/database';
import type { ApiChatMessageContentPart } from '$lib/types/api';

function validImage(mime: string, encoded: string): boolean {
	const extension = IMAGE_MIME_TO_EXTENSION[mime];
	if (!extension) return false;
	let bytes: Uint8Array;
	try {
		const decoded = atob(encoded);
		if (btoa(decoded) !== encoded) return false;
		bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
	} catch {
		return false;
	}
	if (extension === 'png') {
		if (bytes.length < 57 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
			return false;
		const view = new DataView(bytes.buffer);
		let offset = 8;
		let hasImageData = false;
		while (offset + 12 <= bytes.length) {
			const size = view.getUint32(offset);
			if (size > bytes.length - offset - 12) return false;
			const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
			if (
				offset === 8 &&
				(type !== 'IHDR' || size !== 13 || !view.getUint32(16) || !view.getUint32(20))
			)
				return false;
			if (type === 'IDAT') hasImageData = true;
			let crc = 0xffffffff;
			for (let i = offset + 4; i < offset + 8 + size; i++) {
				crc ^= bytes[i];
				for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
			}
			if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(offset + 8 + size)) return false;
			offset += size + 12;
			if (type === 'IEND') return size === 0 && hasImageData && offset === bytes.length;
		}
		return false;
	}
	if (extension === 'jpg')
		return (
			bytes.length >= 4 &&
			bytes[0] === 255 &&
			bytes[1] === 216 &&
			bytes[2] === 255 &&
			bytes.at(-2) === 255 &&
			bytes.at(-1) === 217
		);
	if (extension === 'gif')
		return (
			bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))
		);
	return (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	);
}

/** Extract only verified inline images. Never rewrite malformed or unsupported tool text. */
export function extractToolResultImages(result: string): {
	cleanedResult: string;
	attachments: DatabaseMessageExtraImageFile[];
} {
	const attachments: DatabaseMessageExtraImageFile[] = [];
	const cleanedResult = result
		.split(NEWLINE_SEPARATOR)
		.map((line) => {
			const url = line.trim();
			const match = url.match(DATA_URI_BASE64_REGEX);
			if (!match) return line;
			const mime = match[1].toLowerCase();
			if (!validImage(mime, match[2])) return line;
			const name = `${MCP_ATTACHMENT_NAME_PREFIX}-${Date.now()}-${attachments.length + 1}.${IMAGE_MIME_TO_EXTENSION[mime]}`;
			attachments.push({ type: AttachmentType.IMAGE, name, base64Url: url });
			return `[Attachment saved: ${name}]`;
		})
		.join(NEWLINE_SEPARATOR);
	return { cleanedResult, attachments };
}

/** Keep saved text verbatim; associate existing placeholders with image parts in order.
 * Legacy extras without placeholders remain in their stored order after the text. */
export function toolResultContentParts(
	content: string,
	images: readonly DatabaseMessageExtraImageFile[]
): ApiChatMessageContentPart[] {
	const parts: ApiChatMessageContentPart[] = [];
	const used = new Set<number>();
	let start = 0;
	for (const match of content.matchAll(/\[Attachment saved: ([^\]]+)\]/g)) {
		const index = images.findIndex((image, i) => !used.has(i) && image.name === match[1]);
		if (index < 0) continue;
		const end = match.index + match[0].length;
		parts.push({ type: ContentPartType.TEXT, text: content.slice(start, end) });
		parts.push({ type: ContentPartType.IMAGE_URL, image_url: { url: images[index].base64Url } });
		used.add(index);
		start = end;
	}
	if (start < content.length)
		parts.push({ type: ContentPartType.TEXT, text: content.slice(start) });
	for (const [index, image] of images.entries()) {
		if (!used.has(index))
			parts.push({ type: ContentPartType.IMAGE_URL, image_url: { url: image.base64Url } });
	}
	return parts;
}
