export interface ParsedSseRecord {
	data: string | null;
	bytesParsed: number;
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
	if (left.length === 0) return right.slice();
	const combined = new Uint8Array(left.length + right.length);
	combined.set(left);
	combined.set(right, left.length);
	return combined;
}

/** Parses SSE framing as bytes so replay offsets never use JavaScript character counts. */
export class SseByteParser {
	private pending: Uint8Array<ArrayBufferLike> = new Uint8Array();
	private parsedBytes = 0;
	private dataLines: string[] = [];
	private readonly decoder = new TextDecoder();

	push(chunk: Uint8Array): ParsedSseRecord[] {
		return this.parse(chunk, false);
	}

	finish(): ParsedSseRecord[] {
		return this.parse(new Uint8Array(), true);
	}

	private parse(chunk: Uint8Array, endOfStream: boolean): ParsedSseRecord[] {
		this.pending = appendBytes(this.pending, chunk);
		const records: ParsedSseRecord[] = [];
		let cursor = 0;

		while (cursor < this.pending.length) {
			let lineEnd = -1;
			let terminatorLength = 0;

			for (let index = cursor; index < this.pending.length; index++) {
				const byte = this.pending[index];
				if (byte === 0x0a) {
					lineEnd = index;
					terminatorLength = 1;
					break;
				}
				if (byte === 0x0d) {
					if (index + 1 === this.pending.length && !endOfStream) break;
					lineEnd = index;
					terminatorLength =
						index + 1 < this.pending.length && this.pending[index + 1] === 0x0a ? 2 : 1;
					break;
				}
			}

			if (lineEnd === -1) break;

			const line = this.decoder.decode(this.pending.subarray(cursor, lineEnd));
			const consumed = lineEnd - cursor + terminatorLength;
			cursor += consumed;
			this.parsedBytes += consumed;

			if (line === '') {
				records.push({
					data: this.dataLines.length > 0 ? this.dataLines.join('\n') : null,
					bytesParsed: this.parsedBytes
				});
				this.dataLines = [];
				continue;
			}

			if (line.startsWith(':')) continue;

			const colon = line.indexOf(':');
			const field = colon === -1 ? line : line.slice(0, colon);
			let value = colon === -1 ? '' : line.slice(colon + 1);
			if (value.startsWith(' ')) value = value.slice(1);
			if (field === 'data') this.dataLines.push(value);
		}

		this.pending = this.pending.slice(cursor);
		return records;
	}
}
