const FILE_TYPE_LABEL_ALIASES: Record<string, string> = {
	plain: 'TXT',
	text: 'TXT',
	txt: 'TXT',
	'x-log': 'LOG',
	log: 'LOG',
	markdown: 'MD',
	'x-markdown': 'MD',
	md: 'MD',
	mdown: 'MD',
	json: 'JSON',
	jsonl: 'JSONL',
	pdf: 'PDF',
	csv: 'CSV',
	tsv: 'TSV',
	yaml: 'YAML',
	yml: 'YAML',
	xml: 'XML',
	html: 'HTML',
	htm: 'HTML',
	css: 'CSS',
	scss: 'SCSS',
	sass: 'SASS',
	js: 'JS',
	mjs: 'MJS',
	cjs: 'CJS',
	ts: 'TS',
	tsx: 'TSX',
	jsx: 'JSX',
	py: 'PY',
	sh: 'SH',
	bash: 'BASH',
	zsh: 'ZSH',
	fish: 'FISH',
	toml: 'TOML',
	ini: 'INI',
	env: 'ENV',
	lock: 'LOCK',
	sql: 'SQL',
	rtf: 'RTF',
	doc: 'DOC',
	docx: 'DOCX',
	xls: 'XLS',
	xlsx: 'XLSX',
	ppt: 'PPT',
	pptx: 'PPTX',
	zip: 'ZIP',
	gzip: 'GZ',
	gz: 'GZ',
	tar: 'TAR',
	'7z': '7Z',
	'vnd.ms-excel': 'XLS',
	'vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
	'vnd.ms-powerpoint': 'PPT',
	'vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
	'vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
	'octet-stream': 'FILE'
};

function normalizeFileTypeLabel(value: string | undefined): string {
	if (!value) return 'FILE';

	const normalized = value.trim().toLowerCase();
	if (!normalized) return 'FILE';

	const aliased = FILE_TYPE_LABEL_ALIASES[normalized];
	if (aliased) return aliased;

	const compact = normalized.replace(/^x-/, '');
	const compactAliased = FILE_TYPE_LABEL_ALIASES[compact];
	if (compactAliased) return compactAliased;

	const lastSegment = normalized.split('.').pop();
	if (lastSegment && lastSegment !== normalized) {
		return normalizeFileTypeLabel(lastSegment);
	}

	return normalized.length <= 5 ? normalized.toUpperCase() : 'FILE';
}

/**
 * Gets a display label for a file type from various input formats.
 *
 * Owner note:
 * - filenames/extensions are the best source for user-visible badges;
 * - MIME labels are normalized so text/plain -> TXT and text/x-log -> LOG;
 * - unknown long technical subtypes fall back to FILE instead of leaking raw MIME text.
 */
export function getFileTypeLabel(input: string | undefined): string {
	if (!input) return 'FILE';

	const cleaned = input.trim().split('?')[0].split('#')[0];
	if (!cleaned) return 'FILE';

	const fileName = cleaned.replaceAll('\\', '/').split('/').pop() || cleaned;
	if (fileName.includes('.')) {
		const extension = fileName.split('.').pop();
		const label = normalizeFileTypeLabel(extension);

		if (label !== 'FILE') return label;
	}

	const isMimeLike = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(cleaned);
	if (isMimeLike) {
		const exact = FILE_TYPE_LABEL_ALIASES[cleaned.toLowerCase()];
		if (exact) return exact;

		const subtype = cleaned.split('/').pop();
		return normalizeFileTypeLabel(subtype);
	}

	return normalizeFileTypeLabel(cleaned);
}
