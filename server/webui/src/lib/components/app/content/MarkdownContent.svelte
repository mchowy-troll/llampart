<script lang="ts">
	import type { Root as HastRoot, RootContent as HastRootContent } from 'hast';
	import type { Root as MdastRoot } from 'mdast';
	import { browser } from '$app/environment';
	import { onDestroy, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		escapeCodeHtml,
		highlightCodeAsync,
		loadHighlightThemeCss
	} from '$lib/utils/syntax-highlighting';
	import { copyCodeToClipboard } from '$lib/utils/clipboard';
	import { hasRenderableMath, preprocessLaTeX } from '$lib/utils/latex-protection';
	import { getImageErrorFallbackHtml } from '$lib/utils/image-error-fallback';
	import { detectIncompleteCodeBlock, type IncompleteCodeBlock } from '$lib/utils/code';
	import type { MarkdownProcessor } from '$lib/markdown/markdown-runtime';
	import {
		detectIncompleteMathBlock,
		type IncompleteMathBlock
	} from '$lib/markdown/markdown-streaming-policy';
	import {
		MARKDOWN_PRESENTATION_SELECTORS,
		MARKDOWN_RENDERED_CODE_BLOCK_CLASS,
		MARKDOWN_RENDERED_CODE_PREVIEW_BUTTON_CLASS,
		buildMarkdownRenderedPreviewHtml,
		getCodeInfoFromActionTarget,
		isMarkdownCodeNode,
		renderMarkdownRenderedCodeBlockShell
	} from '$lib/markdown/markdown-presentation';
	import '$styles/katex-custom.scss';
	import {
		IMAGE_NOT_ERROR_BOUND_SELECTOR,
		DATA_ERROR_BOUND_ATTR,
		DATA_ERROR_HANDLED_ATTR,
		BOOL_TRUE_STRING,
		SETTINGS_KEYS
	} from '$lib/constants';
	import { ColorMode, UrlProtocol } from '$lib/enums';
	import { mode } from 'mode-watcher';
	import { ActionIconsCodeBlock, DialogCodePreview } from '$lib/components/app';
	import { createAutoScrollController } from '$lib/hooks/use-auto-scroll.svelte';
	import type { DatabaseMessageExtra } from '$lib/types/database';
	import { config } from '$lib/stores/settings.svelte';
	import { fadeInView } from '$lib/actions/fade-in-view.svelte';
	import { t } from '$lib/i18n';

	interface Props {
		attachments?: DatabaseMessageExtra[];
		content: string;
		class?: string;
		disableMath?: boolean;
		inheritTypography?: boolean;
	}

	interface MarkdownBlock {
		id: string;
		html: string;
		contentHash?: string;
	}

	let {
		content,
		attachments,
		class: className = '',
		disableMath = false,
		inheritTypography = false
	}: Props = $props();

	let containerRef = $state<HTMLDivElement>();
	let renderedBlocks = $state<MarkdownBlock[]>([]);
	let unstableBlockHtml = $state('');
	let incompleteCodeBlock = $state<IncompleteCodeBlock | null>(null);
	let incompleteMathBlock = $state<IncompleteMathBlock | null>(null);
	let streamingHighlightedHtml = $state('');
	let streamingHighlightRequestId = 0;
	let previewDialogOpen = $state(false);
	let previewCode = $state('');
	let previewLanguage = $state('text');
	let tablePreviewDialogOpen = $state(false);
	let tablePreviewHtml = $state('');
	let markdownRenderedPreviewDialogOpen = $state(false);
	let markdownRenderedPreviewHtml = $state('');
	let streamingCodeScrollContainer = $state<HTMLDivElement>();

	// Auto-scroll controller for streaming code block content
	const streamingAutoScroll = createAutoScrollController();

	let pendingMarkdown: string | null = null;
	let isProcessing = false;

	// Per-instance transform cache, avoids re-transforming stable blocks during streaming
	// Garbage collected when component is destroyed (on conversation change)
	const transformCache = new SvelteMap<string, string>();
	let previousContent = '';

	const themeStyleId = `highlight-theme-${(window.idxThemeStyle = (window.idxThemeStyle ?? 0) + 1)}`;

	let markdownRuntimePromise: Promise<typeof import('$lib/markdown/markdown-runtime')> | null =
		null;

	function loadMarkdownRuntime() {
		markdownRuntimePromise ??= import('$lib/markdown/markdown-runtime');

		return markdownRuntimePromise;
	}

	async function createProcessor(markdown: string): Promise<MarkdownProcessor> {
		const enableMath = !disableMath && hasRenderableMath(markdown);
		const { createMarkdownProcessor } = await loadMarkdownRuntime();

		return createMarkdownProcessor({ attachments, disableMath: !enableMath });
	}

	/**
	 * Removes click event listeners from copy and preview buttons.
	 * Called on component destroy.
	 */
	function cleanupEventListeners() {
		if (!containerRef) return;

		const copyButtons = containerRef.querySelectorAll<HTMLButtonElement>(
			MARKDOWN_PRESENTATION_SELECTORS.copyCodeButton
		);
		const previewButtons = containerRef.querySelectorAll<HTMLButtonElement>(
			MARKDOWN_PRESENTATION_SELECTORS.previewCodeButton
		);
		const tablePreviewButtons = containerRef.querySelectorAll<HTMLButtonElement>(
			MARKDOWN_PRESENTATION_SELECTORS.tablePreviewButton
		);

		for (const button of copyButtons) {
			button.removeEventListener('click', handleCopyClick);
		}

		for (const button of previewButtons) {
			button.removeEventListener('click', handlePreviewClick);
		}

		for (const button of tablePreviewButtons) {
			button.removeEventListener('click', handleTablePreviewClick);
		}
	}

	/**
	 * Removes this component's highlight.js theme style from the document head.
	 * Called on component destroy to clean up injected styles.
	 */
	function cleanupHighlightTheme() {
		if (!browser) return;

		const existingTheme = document.getElementById(themeStyleId);
		existingTheme?.remove();
	}

	/**
	 * Loads the appropriate highlight.js theme based on dark/light mode.
	 * Injects a scoped style element into the document head.
	 * @param isDark - Whether to load the dark theme (true) or light theme (false)
	 */
	async function loadHighlightTheme(isDark: boolean) {
		if (!browser) return;

		const existingTheme = document.getElementById(themeStyleId);
		existingTheme?.remove();

		const style = document.createElement('style');
		style.id = themeStyleId;
		style.textContent = await loadHighlightThemeCss(isDark);

		document.head.appendChild(style);
	}

	async function updateStreamingHighlightedHtml(block: IncompleteCodeBlock) {
		const requestId = ++streamingHighlightRequestId;
		const language = block.language || 'text';
		streamingHighlightedHtml = escapeCodeHtml(block.code);

		try {
			const html = await highlightCodeAsync(block.code, language);

			if (requestId === streamingHighlightRequestId && incompleteCodeBlock === block) {
				streamingHighlightedHtml = html;
			}
		} catch {
			if (requestId === streamingHighlightRequestId && incompleteCodeBlock === block) {
				streamingHighlightedHtml = escapeCodeHtml(block.code);
			}
		}
	}

	/**
	 * Generates a unique identifier for a HAST node based on its position.
	 * Used for stable block identification during incremental rendering.
	 * @param node - The HAST root content node
	 * @param indexFallback - Fallback index if position is unavailable
	 * @returns Unique string identifier for the node
	 */
	function getHastNodeId(node: HastRootContent, indexFallback: number): string {
		const position = node.position;

		if (position?.start?.offset != null && position?.end?.offset != null) {
			return `hast-${position.start.offset}-${position.end.offset}`;
		}

		return `${node.type}-${indexFallback}`;
	}

	/**
	 * Generates a hash for MDAST node based on its position.
	 * Used for cache lookup during incremental rendering.
	 */
	function getMdastNodeHash(node: unknown, index: number): string {
		const n = node as {
			type?: string;
			position?: { start?: { offset?: number }; end?: { offset?: number } };
		};

		if (n.position?.start?.offset != null && n.position?.end?.offset != null) {
			return `${n.type}-${n.position.start.offset}-${n.position.end.offset}`;
		}

		return `${n.type}-idx${index}`;
	}

	/**
	 * Check if we're in append-only mode (streaming).
	 */
	function isAppendMode(newContent: string): boolean {
		return previousContent.length > 0 && newContent.startsWith(previousContent);
	}

	async function renderStableMarkdownBlocks(prefixMarkdown: string): Promise<MarkdownBlock[]> {
		if (!prefixMarkdown.trim()) {
			return [];
		}

		const normalizedPrefix = preprocessLaTeX(prefixMarkdown);
		const processorInstance = await createProcessor(prefixMarkdown);
		const ast = processorInstance.parse(normalizedPrefix) as MdastRoot;
		const mdastChildren = (ast as { children?: unknown[] }).children ?? [];
		const nextBlocks: MarkdownBlock[] = [];

		// Check if we're in append mode for cache reuse.
		const appendMode = isAppendMode(prefixMarkdown);
		const previousBlockCount = appendMode ? renderedBlocks.length : 0;

		// All prefix blocks are stable because the pending structured content is rendered separately.
		for (let index = 0; index < mdastChildren.length; index++) {
			const child = mdastChildren[index];

			if (appendMode && index < previousBlockCount) {
				const prevBlock = renderedBlocks[index];
				const currentHash = getMdastNodeHash(child, index);

				if (prevBlock?.contentHash === currentHash) {
					nextBlocks.push(prevBlock);

					continue;
				}
			}

			const { html, hash } = await transformMdastNode(processorInstance, child, index);
			const id = getHastNodeId(
				{ position: (child as { position?: unknown }).position } as HastRootContent,
				index
			);

			nextBlocks.push({ id, html, contentHash: hash });
		}

		return nextBlocks;
	}

	async function renderMarkdownCodeBlock(
		processorInstance: MarkdownProcessor,
		node: { lang?: string; value?: string }
	): Promise<string> {
		const rawCode = node.value ?? '';
		const language = node.lang || 'markdown';
		const codeId = `code-${(window.idxCodeBlock = (window.idxCodeBlock ?? 0) + 1)}`;
		const normalized = preprocessLaTeX(rawCode);
		const innerAst = processorInstance.parse(normalized) as MdastRoot;
		const transformedRoot = (await processorInstance.run(innerAst)) as HastRoot;
		const renderedMarkdown = processorInstance.stringify(transformedRoot);

		return renderMarkdownRenderedCodeBlockShell({
			codeId,
			language,
			previewMarkdownLabel: t('common.previewMarkdown'),
			rawCode,
			renderedMarkdown
		});
	}

	/**
	 * Transforms a single MDAST node to HTML string with caching.
	 * Runs the full remark/rehype plugin pipeline (GFM, math, syntax highlighting, etc.)
	 * on an isolated single-node tree, then stringifies the resulting HAST to HTML.
	 * Results are cached by node position hash for streaming performance.
	 * @param processorInstance - The remark/rehype processor instance
	 * @param node - The MDAST node to transform
	 * @param index - Node index for hash fallback
	 * @returns Object containing the HTML string and cache hash
	 */
	async function transformMdastNode(
		processorInstance: MarkdownProcessor,
		node: unknown,
		index: number
	): Promise<{ html: string; hash: string }> {
		const hash = getMdastNodeHash(node, index);

		const cached = transformCache.get(hash);
		if (cached) {
			return { html: cached, hash };
		}

		let html: string;

		if (isMarkdownCodeNode(node)) {
			html = await renderMarkdownCodeBlock(processorInstance, node);
		} else {
			const singleNodeRoot = { type: 'root', children: [node] };
			const transformedRoot = (await processorInstance.run(
				singleNodeRoot as MdastRoot
			)) as HastRoot;
			html = processorInstance.stringify(transformedRoot);
		}

		transformCache.set(hash, html);

		return { html, hash };
	}

	/**
	 * Handles click events on copy buttons within code blocks.
	 * Copies the raw code content to the clipboard.
	 * @param event - The click event from the copy button
	 */
	async function handleCopyClick(event: Event) {
		event.preventDefault();
		event.stopPropagation();

		const target = event.currentTarget as HTMLButtonElement | null;

		if (!target) {
			return;
		}

		const info = getCodeInfoFromActionTarget(target);

		if (!info) {
			return;
		}

		try {
			await copyCodeToClipboard(
				info.rawCode,
				t('common.codeCopiedToClipboard'),
				t('common.failedToCopyCode')
			);
		} catch (error) {
			console.error('Failed to copy code:', error);
		}
	}

	/**
	 * Handles preview dialog open state changes.
	 * Clears preview content when dialog is closed.
	 * @param open - Whether the dialog is being opened or closed
	 */
	function handlePreviewDialogOpenChange(open: boolean) {
		previewDialogOpen = open;

		if (!open) {
			previewCode = '';
			previewLanguage = 'text';
		}
	}

	/**
	 * Handles click events on preview buttons within HTML code blocks.
	 * Opens a preview dialog with the rendered HTML content.
	 * @param event - The click event from the preview button
	 */
	function handlePreviewClick(event: Event) {
		event.preventDefault();
		event.stopPropagation();

		const target = event.currentTarget as HTMLButtonElement | null;

		if (!target) {
			return;
		}

		const wrapper = target.closest(
			MARKDOWN_PRESENTATION_SELECTORS.codeBlockWrapper
		) as HTMLElement | null;

		if (wrapper?.classList.contains(MARKDOWN_RENDERED_CODE_BLOCK_CLASS)) {
			const markdownPreviewHtml = buildMarkdownRenderedPreviewHtml(wrapper);

			if (markdownPreviewHtml) {
				markdownRenderedPreviewHtml = markdownPreviewHtml;
				markdownRenderedPreviewDialogOpen = true;
				return;
			}
		}

		const info = getCodeInfoFromActionTarget(target);

		if (!info) {
			return;
		}

		previewCode = info.rawCode;
		previewLanguage = info.language;
		previewDialogOpen = true;
	}

	/**
	 * Handles table preview dialog open state changes.
	 * Clears the source table reference when the dialog is closed.
	 */
	function handleTablePreviewDialogOpenChange(open: boolean) {
		tablePreviewDialogOpen = open;

		if (!open) {
			tablePreviewHtml = '';
		}
	}

	function handleMarkdownRenderedPreviewDialogOpenChange(open: boolean) {
		markdownRenderedPreviewDialogOpen = open;

		if (!open) {
			markdownRenderedPreviewHtml = '';
		}
	}

	/**
	 * Handles click events on markdown table preview buttons.
	 * Opens a dialog with serialized HTML from the existing table.
	 */
	function handleTablePreviewClick(event: Event) {
		event.preventDefault();
		event.stopPropagation();

		const target = event.currentTarget as HTMLButtonElement | null;
		const tableBlock = target?.closest(MARKDOWN_PRESENTATION_SELECTORS.tableBlock);
		const table = tableBlock?.querySelector<HTMLTableElement>(
			MARKDOWN_PRESENTATION_SELECTORS.tableWrapperTable
		);

		if (!table) {
			return;
		}

		tablePreviewHtml = table.outerHTML;
		tablePreviewDialogOpen = true;
	}

	/**
	 * Processes markdown content into stable and unstable HTML blocks.
	 * Uses incremental rendering: stable blocks are cached, unstable block is re-rendered.
	 * Incomplete code blocks are rendered using SyntaxHighlightedCode to maintain interactivity.
	 * @param markdown - The raw markdown string to process
	 */
	async function processMarkdown(markdown: string) {
		// Early exit if content unchanged (can happen with rapid coalescing)
		if (markdown === previousContent) {
			return;
		}

		if (!markdown) {
			renderedBlocks = [];
			unstableBlockHtml = '';
			incompleteCodeBlock = null;
			incompleteMathBlock = null;
			streamingHighlightedHtml = '';
			previousContent = '';
			return;
		}

		// Check for incomplete code block at the end of content
		const incompleteBlock = detectIncompleteCodeBlock(markdown);

		if (incompleteBlock) {
			// Process only the prefix (content before the incomplete code block).
			const prefixMarkdown = markdown.slice(0, incompleteBlock.openingIndex);

			renderedBlocks = await renderStableMarkdownBlocks(prefixMarkdown);
			previousContent = prefixMarkdown;
			unstableBlockHtml = '';
			incompleteMathBlock = null;
			incompleteCodeBlock = incompleteBlock;
			await updateStreamingHighlightedHtml(incompleteBlock);

			return;
		}

		const pendingMathBlock = disableMath ? null : detectIncompleteMathBlock(markdown);

		if (pendingMathBlock) {
			const prefixMarkdown = markdown.slice(0, pendingMathBlock.openingIndex);

			renderedBlocks = await renderStableMarkdownBlocks(prefixMarkdown);
			previousContent = prefixMarkdown;
			unstableBlockHtml = '';
			incompleteCodeBlock = null;
			incompleteMathBlock = pendingMathBlock;
			streamingHighlightedHtml = '';

			return;
		}

		// No incomplete structured streaming block - use standard processing.
		incompleteCodeBlock = null;
		incompleteMathBlock = null;
		streamingHighlightedHtml = '';

		const normalized = preprocessLaTeX(markdown);
		const processorInstance = await createProcessor(markdown);
		const ast = processorInstance.parse(normalized) as MdastRoot;
		const mdastChildren = (ast as { children?: unknown[] }).children ?? [];
		const stableCount = Math.max(mdastChildren.length - 1, 0);
		const nextBlocks: MarkdownBlock[] = [];

		// Check if we're in append mode for cache reuse
		const appendMode = isAppendMode(markdown);
		const previousBlockCount = appendMode ? renderedBlocks.length : 0;

		for (let index = 0; index < stableCount; index++) {
			const child = mdastChildren[index];

			// In append mode, reuse previous blocks if unchanged
			if (appendMode && index < previousBlockCount) {
				const prevBlock = renderedBlocks[index];
				const currentHash = getMdastNodeHash(child, index);
				if (prevBlock?.contentHash === currentHash) {
					nextBlocks.push(prevBlock);

					continue;
				}
			}

			// Transform this block (with caching)
			const { html, hash } = await transformMdastNode(processorInstance, child, index);
			const id = getHastNodeId(
				{ position: (child as { position?: unknown }).position } as HastRootContent,
				index
			);

			nextBlocks.push({ id, html, contentHash: hash });
		}

		let unstableHtml = '';

		if (mdastChildren.length > stableCount) {
			const unstableChild = mdastChildren[stableCount];
			const transformed = await transformMdastNode(processorInstance, unstableChild, stableCount);

			unstableHtml = transformed.html;
		}

		renderedBlocks = nextBlocks;
		previousContent = markdown;
		await tick(); // Force DOM sync before updating unstable HTML block
		unstableBlockHtml = unstableHtml;
	}

	/**
	 * Attaches click event listeners to copy and preview buttons in code blocks.
	 * Uses data-listener-bound attribute to prevent duplicate bindings.
	 */
	function setupCodeBlockActions() {
		if (!containerRef) return;

		const wrappers = containerRef.querySelectorAll<HTMLElement>(
			MARKDOWN_PRESENTATION_SELECTORS.codeBlockWrapper
		);

		for (const wrapper of wrappers) {
			const copyButton = wrapper.querySelector<HTMLButtonElement>(
				MARKDOWN_PRESENTATION_SELECTORS.copyCodeButton
			);
			const previewButton = wrapper.querySelector<HTMLButtonElement>(
				MARKDOWN_PRESENTATION_SELECTORS.previewCodeButton
			);

			if (copyButton) {
				const copyLabel = t('common.copyCode');
				copyButton.removeAttribute('title');
				copyButton.setAttribute('aria-label', copyLabel);
				copyButton.dataset.llampartCodeTooltip = copyLabel;
			}

			if (previewButton) {
				const previewLabel = previewButton.classList.contains(
					MARKDOWN_RENDERED_CODE_PREVIEW_BUTTON_CLASS
				)
					? t('common.previewMarkdown')
					: t('common.previewCode');
				previewButton.removeAttribute('title');
				previewButton.setAttribute('aria-label', previewLabel);
				previewButton.dataset.llampartCodeTooltip = previewLabel;
			}

			if (copyButton && copyButton.dataset.listenerBound !== 'true') {
				copyButton.dataset.listenerBound = 'true';
				copyButton.addEventListener('click', handleCopyClick);
			}

			if (previewButton && previewButton.dataset.listenerBound !== 'true') {
				previewButton.dataset.listenerBound = 'true';
				previewButton.addEventListener('click', handlePreviewClick);
			}
		}
	}

	/**
	 * Attaches click event listeners to markdown table preview buttons.
	 * Uses data-listener-bound attribute to prevent duplicate bindings.
	 */
	function setupTablePreviewActions() {
		if (!containerRef) return;

		const buttons = containerRef.querySelectorAll<HTMLButtonElement>(
			MARKDOWN_PRESENTATION_SELECTORS.tablePreviewButton
		);

		for (const button of buttons) {
			button.title = t('common.tablePreview');
			button.setAttribute('aria-label', t('common.tablePreview'));

			if (button.dataset.listenerBound !== 'true') {
				button.dataset.listenerBound = 'true';
				button.addEventListener('click', handleTablePreviewClick);
			}
		}
	}

	/**
	 * Attaches error handlers to images to show fallback UI when loading fails (e.g., CORS).
	 * Uses data-error-bound attribute to prevent duplicate bindings.
	 */
	function setupImageErrorHandlers() {
		if (!containerRef) return;

		const images = containerRef.querySelectorAll<HTMLImageElement>(IMAGE_NOT_ERROR_BOUND_SELECTOR);

		for (const img of images) {
			img.dataset[DATA_ERROR_BOUND_ATTR] = BOOL_TRUE_STRING;
			img.addEventListener('error', handleImageError);
		}
	}

	/**
	 * Handles image load errors by replacing the image with a fallback UI.
	 * Shows a placeholder with a link to open the image in a new tab.
	 */
	function handleImageError(event: Event) {
		const img = event.target as HTMLImageElement;
		if (!img || !img.src) return;

		// Don't handle data URLs or already-handled images
		if (
			img.src.startsWith(UrlProtocol.DATA) ||
			img.dataset[DATA_ERROR_HANDLED_ATTR] === BOOL_TRUE_STRING
		)
			return;
		img.dataset[DATA_ERROR_HANDLED_ATTR] = BOOL_TRUE_STRING;

		const src = img.src;
		// Create fallback element
		const fallback = document.createElement('div');
		fallback.className = 'image-load-error';
		fallback.innerHTML = getImageErrorFallbackHtml(src);

		// Replace image with fallback
		img.parentNode?.replaceChild(fallback, img);
	}

	/**
	 * Queues markdown for processing with coalescing support.
	 * Only processes the latest markdown when multiple updates arrive quickly.
	 * Uses requestAnimationFrame to yield to browser paint between batches.
	 * @param markdown - The markdown content to render
	 */
	async function updateRenderedBlocks(markdown: string) {
		pendingMarkdown = markdown;

		if (isProcessing) {
			return;
		}

		isProcessing = true;

		try {
			while (pendingMarkdown !== null) {
				const nextMarkdown = pendingMarkdown;
				pendingMarkdown = null;

				await processMarkdown(nextMarkdown);

				// Yield to browser for paint. During this, new chunks coalesce
				// into pendingMarkdown, so we always render the latest state.
				if (pendingMarkdown !== null) {
					await new Promise((resolve) => requestAnimationFrame(resolve));
				}
			}
		} catch (error) {
			console.error('Failed to process markdown:', error);
			renderedBlocks = [];
			unstableBlockHtml = markdown.replace(/\n/g, '<br>');
		} finally {
			isProcessing = false;
		}
	}

	$effect(() => {
		const currentMode = mode.current;
		const isDark = currentMode === ColorMode.DARK;

		void loadHighlightTheme(isDark);
	});

	$effect(() => {
		updateRenderedBlocks(content);
	});

	$effect(() => {
		const hasRenderedBlocks = renderedBlocks.length > 0;
		const hasUnstableBlock = Boolean(unstableBlockHtml);

		if ((hasRenderedBlocks || hasUnstableBlock) && containerRef) {
			setupCodeBlockActions();
			setupTablePreviewActions();
			setupImageErrorHandlers();
		}
	});

	// Auto-scroll for streaming code block
	$effect(() => {
		streamingAutoScroll.setContainer(streamingCodeScrollContainer);
	});

	$effect(() => {
		streamingAutoScroll.updateInterval(incompleteCodeBlock !== null);
	});

	onDestroy(() => {
		cleanupEventListeners();
		cleanupHighlightTheme();
		streamingAutoScroll.destroy();
	});
</script>

<div
	bind:this={containerRef}
	class="{className}{inheritTypography ? ' markdown-inherit-typography' : ''}{config()[
		SETTINGS_KEYS.FULL_HEIGHT_CODE_BLOCKS
	]
		? ' full-height-code-blocks'
		: ''}"
>
	{#each renderedBlocks as block (block.id)}
		<div class="markdown-block" data-block-id={block.id} use:fadeInView={{ skipIfVisible: true }}>
			<!-- eslint-disable-next-line no-at-html-tags -->
			{@html block.html}
		</div>
	{/each}

	{#if unstableBlockHtml}
		<div class="markdown-block markdown-block--unstable" data-block-id="unstable">
			<!-- eslint-disable-next-line no-at-html-tags -->
			{@html unstableBlockHtml}
		</div>
	{/if}

	{#if incompleteMathBlock}
		<div
			class="markdown-math-pending llampart-inline-processing-status"
			role="status"
			aria-label={t('messages.processingEllipsis')}
		>
			<span
				class="markdown-math-pending__symbol llampart-inline-processing-status__symbol"
				aria-hidden="true">∑</span
			>
			<span class="markdown-math-pending__label llampart-inline-processing-status__label"
				>{t('messages.processingEllipsis')}</span
			>
		</div>
	{/if}

	{#if incompleteCodeBlock}
		<div class="code-block-wrapper streaming-code-block relative">
			<div class="code-block-header">
				<span class="code-language">{incompleteCodeBlock.language || 'text'}</span>
				<ActionIconsCodeBlock
					code={incompleteCodeBlock.code}
					language={incompleteCodeBlock.language || 'text'}
					disabled
					onPreview={(code, lang) => {
						previewCode = code;
						previewLanguage = lang;
						previewDialogOpen = true;
					}}
				/>
			</div>
			<div
				bind:this={streamingCodeScrollContainer}
				class="streaming-code-scroll-container"
				onscroll={() => streamingAutoScroll.handleScroll()}
			>
				<pre class="streaming-code-pre"><code
						class="hljs language-{incompleteCodeBlock.language || 'text'}"
						>{@html streamingHighlightedHtml}</code
					></pre>
			</div>
		</div>
	{/if}
</div>

<DialogCodePreview
	open={previewDialogOpen}
	code={previewCode}
	language={previewLanguage}
	onOpenChange={handlePreviewDialogOpenChange}
/>

<Dialog.Root open={tablePreviewDialogOpen} onOpenChange={handleTablePreviewDialogOpenChange}>
	<Dialog.Content
		class="table-preview-dialog-content z-[999999] flex !max-h-[80dvh] !w-[80vw] !max-w-[80vw] flex-col gap-0 overflow-hidden p-0"
	>
		<div class="table-preview-dialog">
			<div class="table-preview-header">
				<Dialog.Title class="table-preview-title">{t('common.tablePreview')}</Dialog.Title>
			</div>

			<div class="table-preview-body">
				<div class="table-preview-wrapper">
					{@html tablePreviewHtml}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root
	open={markdownRenderedPreviewDialogOpen}
	onOpenChange={handleMarkdownRenderedPreviewDialogOpenChange}
>
	<Dialog.Content
		class="table-preview-dialog-content markdown-rendered-preview-dialog-content z-[999999] flex !max-h-[80dvh] !w-[80vw] !max-w-[80vw] flex-col gap-0 overflow-hidden p-0"
	>
		<div class="table-preview-dialog markdown-rendered-preview-dialog">
			<div class="table-preview-header">
				<Dialog.Title class="table-preview-title">{t('common.previewMarkdown')}</Dialog.Title>
			</div>

			<div class="table-preview-body markdown-rendered-preview-body">
				<div class="markdown-rendered-preview-wrapper">
					{@html markdownRenderedPreviewHtml}
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(.markdown-rendered-code-block .markdown-rendered-code-content) {
		box-sizing: border-box;
		min-height: var(--min-message-height);
		max-height: var(--max-message-height);
		overflow-y: auto;
		overflow-x: auto;
		padding: 2.75rem 1.25rem 1.25rem;
	}

	.full-height-code-blocks :global(.markdown-rendered-code-block .markdown-rendered-code-content) {
		max-height: none;
		overflow-y: visible;
	}

	:global(.markdown-rendered-code-block .llampart-markdown-rendered-code-preview-btn svg) {
		width: 1rem;
		height: 1rem;
	}

	:global(.markdown-rendered-code-block .markdown-rendered-code-content > :first-child) {
		margin-top: 0;
	}

	:global(.markdown-rendered-code-block .markdown-rendered-code-content > :last-child) {
		margin-bottom: 0;
	}

	:global(.markdown-rendered-code-block .markdown-rendered-code-content .code-block-wrapper),
	:global(.markdown-rendered-code-block .markdown-rendered-code-content .table-block) {
		margin-top: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.markdown-block--unstable {
		display: contents;
	}

	.markdown-math-pending {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
		color: hsl(var(--muted-foreground));
		font-size: 0.875rem;
		line-height: 1.35;
	}

	.markdown-math-pending__symbol {
		font-weight: 600;
	}

	:global(.katex-display) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		margin: 0.75rem 0;
		padding-bottom: 0.125rem;
		-webkit-overflow-scrolling: touch;
	}

	:global(.katex-display > .katex) {
		display: inline-block;
		min-width: max-content;
	}

	:global(.markdown-rendered-preview-dialog-content) {
		background: hsl(var(--background)) !important;
		color: hsl(var(--foreground)) !important;
	}

	.markdown-rendered-preview-body {
		overflow: hidden !important;
	}

	.markdown-rendered-preview-wrapper {
		box-sizing: border-box;
		width: 100%;
		max-height: calc(80dvh - 5rem) !important;
		overflow: auto !important;
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		border-radius: 0.5rem;
		background: hsl(var(--background));
		color: hsl(var(--foreground));
		padding: 1rem;
	}

	.markdown-rendered-preview-wrapper :global(> :first-child) {
		margin-top: 0;
	}

	.markdown-rendered-preview-wrapper :global(> :last-child) {
		margin-bottom: 0;
	}

	.markdown-rendered-preview-wrapper :global(.code-block-actions),
	.markdown-rendered-preview-wrapper :global(.table-actions),
	.markdown-rendered-preview-wrapper :global(code[data-code-id][hidden]) {
		display: none !important;
	}

	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog-content),
	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog),
	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog .table-preview-header),
	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog .table-preview-body),
	:global(html.has-frosted-glass-theme .markdown-rendered-preview-body),
	:global(html.has-frosted-glass-theme .markdown-rendered-preview-wrapper) {
		background: #ffffff !important;
		background-color: #ffffff !important;
		background-image: none !important;
		color: #111111 !important;
		text-shadow: none !important;
		box-shadow: none;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog-content) {
		border: 1px solid rgba(0, 0, 0, 0.12) !important;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18) !important;
	}

	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog .table-preview-header) {
		border-bottom: 1px solid rgba(0, 0, 0, 0.12) !important;
	}

	:global(html.has-frosted-glass-theme .markdown-rendered-preview-wrapper) {
		border: 1px solid rgba(0, 0, 0, 0.12) !important;
		border-radius: 0.5rem !important;
		box-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme .markdown-rendered-preview-wrapper *),
	:global(html.has-frosted-glass-theme .markdown-rendered-preview-dialog .table-preview-title) {
		text-shadow: none !important;
	}

	div :global(.table-preview-button svg) {
		width: 1rem !important;
		height: 1rem !important;
		stroke-width: 2 !important;
	}

	div :global(.table-actions) {
		right: 1rem !important;
	}

	div :global(.table-preview-button) {
		width: 1rem !important;
		height: 1rem !important;
		min-width: 1rem !important;
		min-height: 1rem !important;
		padding: 0 !important;
		line-height: 1 !important;
	}

	div :global(.table-preview-button svg) {
		width: 1rem !important;
		height: 1rem !important;
		stroke-width: 2 !important;
	}

	:global(.table-preview-dialog-content) {
		width: 80vw !important;
		max-width: 80vw !important;
		height: auto !important;
		max-height: 80dvh !important;
	}

	:global(.table-preview-dialog) {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		max-height: 80dvh;
	}

	:global(.table-preview-body) {
		flex: 1 1 auto;
		min-height: 0;
		padding: 1rem !important;
		overflow: hidden !important;
	}

	:global(.table-preview-body .table-wrapper),
	:global(.table-preview-body .table-preview-wrapper) {
		max-height: calc(80dvh - 5rem) !important;
		overflow: auto !important;
	}

	.table-preview-dialog {
		display: flex;
		min-height: 0;
		width: 100%;
		max-height: 80dvh;
		flex-direction: column;
	}

	.table-preview-header {
		display: flex;
		align-items: center;
		min-height: 3.25rem;
		padding: 0 1.25rem;
		border-bottom: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
	}

	.table-preview-title {
		font-size: 1rem;
		font-weight: 600;
	}

	.table-preview-body {
		min-height: 0;
		flex: 0 1 auto;
		max-height: calc(80dvh - 3.25rem - 1px);
		overflow: auto;
		padding: 1rem;
	}

	.table-preview-body :global(.table-preview-wrapper) {
		margin: 0;
	}

	/* Streaming code block uses .code-block-wrapper styles */
	.streaming-code-block .streaming-code-pre {
		background: transparent;
		padding: 0.5rem;
		margin: 0;
		overflow-x: visible;
		border-radius: 0;
		border: none;
		font-size: 0.875rem;
	}

	/* Base typography styles */
	div :global(p) {
		margin-block: 1rem;
		line-height: 1.75;
	}

	div :global(:is(h1, h2, h3, h4, h5, h6):first-child) {
		margin-top: 0;
	}

	/* Headers with consistent spacing */
	div :global(h1) {
		font-size: 1.875rem;
		font-weight: 700;
		line-height: 1.2;
		margin: 1.5rem 0 0.75rem 0;
	}

	div :global(h2) {
		font-size: 1.5rem;
		font-weight: 600;
		line-height: 1.3;
		margin: 1.25rem 0 0.5rem 0;
	}

	div :global(h3) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 1.5rem 0 0.5rem 0;
		line-height: 1.4;
	}

	div :global(h4) {
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0.75rem 0 0.25rem 0;
	}

	div :global(h5) {
		font-size: 1rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem 0;
	}

	div :global(h6) {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem 0;
	}

	/* Text formatting */
	div :global(strong) {
		font-weight: 600;
	}

	div :global(em) {
		font-style: italic;
	}

	div :global(del) {
		text-decoration: line-through;
		opacity: 0.7;
	}

	/* Inline code */
	div :global(code:not(pre code)) {
		background: var(--muted);
		color: var(--muted-foreground);
		padding: 0.125rem 0.375rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
			'Liberation Mono', Menlo, monospace;
	}

	div :global(pre) {
		display: inline;
		margin: 0 !important;
		overflow: hidden !important;
		background: var(--muted);
		overflow-x: auto;
		border-radius: 1rem;
		border: none;
		line-height: 1 !important;
	}

	div :global(pre code) {
		padding: 0 !important;
		display: inline !important;
	}

	div :global(code) {
		background: transparent;
		color: var(--code-foreground);
	}

	/* Links */
	div :global(a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: color 0.2s ease;
		overflow-wrap: anywhere;
		word-break: break-all;
	}

	div :global(a:hover) {
		color: var(--primary);
	}

	/* Lists */
	div :global(ul) {
		list-style-type: disc;
		margin-inline-start: 1.5rem;
		margin-bottom: 1rem;
	}

	div :global(ol) {
		list-style-type: decimal;
		margin-inline-start: 1.5rem;
		margin-bottom: 1rem;
	}

	div :global(li) {
		margin-bottom: 0.25rem;
		padding-inline-start: 0.5rem;
	}

	div :global(li::marker) {
		color: var(--muted-foreground);
	}

	/* Nested lists */
	div :global(ul ul) {
		list-style-type: circle;
		margin-top: 0.25rem;
		margin-bottom: 0.25rem;
	}

	div :global(ol ol) {
		list-style-type: lower-alpha;
		margin-top: 0.25rem;
		margin-bottom: 0.25rem;
	}

	/* Task lists */
	div :global(.task-list-item) {
		list-style: none;
		margin-inline-start: 0;
		padding-inline-start: 0;
	}

	div :global(.task-list-item-checkbox) {
		margin-right: 0.5rem;
		margin-top: 0.125rem;
	}

	/* Blockquotes */
	div :global(blockquote) {
		border-left: 4px solid var(--border);
		padding: 0.5rem 1rem;
		margin: 1.5rem 0;
		font-style: italic;
		color: var(--muted-foreground);
		background: var(--muted);
		border-radius: 0 0.375rem 0.375rem 0;
	}

	/* Tables */
	div :global(table) {
		display: table;
		width: 100%;
		max-width: 100%;
		margin: 1.25rem 0;
		border-collapse: collapse;
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		border-radius: 0;
		background: var(--background);
		table-layout: auto;
	}

	div :global(th) {
		background: color-mix(in oklch, var(--muted) 82%, var(--background));
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		padding: 0.55rem 0.75rem;
		text-align: left;
		font-weight: 650;
		letter-spacing: 0.01em;
		vertical-align: middle;
	}

	div :global(td) {
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		padding: 0.38rem 0.75rem;
		vertical-align: middle;
	}

	div :global(tr:nth-child(even)) {
		background: color-mix(in oklch, var(--muted) 24%, transparent);
	}

	/* User message markdown should keep table borders visible on light primary backgrounds */
	div.markdown-user-content :global(table),
	div.markdown-user-content :global(th),
	div.markdown-user-content :global(td),
	div.markdown-user-content :global(.table-wrapper) {
		border-color: currentColor;
	}

	/* Horizontal rules */
	div :global(hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 1.5rem 0;
	}

	/* Images */
	div :global(img) {
		border-radius: 0.5rem;
		box-shadow:
			0 1px 3px 0 rgb(0 0 0 / 0.1),
			0 1px 2px -1px rgb(0 0 0 / 0.1);
		margin: 1.5rem 0;
		max-width: 100%;
		height: auto;
	}

	/* Code blocks */

	div :global(.code-block-wrapper) {
		margin: 1.5rem 0;
		border-radius: 0.75rem;
		overflow: visible;
		border: 1px solid color-mix(in oklch, var(--border) 30%, transparent);
		background: var(--code-background);
		box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
		min-height: var(--min-message-height);
		max-height: none;
		display: flex;
		flex-direction: column;
	}

	:global(.dark) div :global(.code-block-wrapper) {
		border-color: color-mix(in oklch, var(--border) 20%, transparent);
	}

	/* Scroll container for code blocks (both streaming and completed) */
	div :global(.code-block-scroll-container),
	.streaming-code-scroll-container {
		min-height: var(--min-message-height);
		max-height: none;
		overflow-y: visible;
		overflow-x: auto;
		padding: 1rem;
		line-height: 1.3;
	}

	.full-height-code-blocks :global(.code-block-wrapper) {
		max-height: none;
	}

	.full-height-code-blocks :global(.code-block-scroll-container),
	.full-height-code-blocks .streaming-code-scroll-container {
		max-height: none;
		overflow-y: visible;
	}

	div :global(.code-block-header) {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1rem 0.75rem;
		font-size: 0.875rem;
		position: relative;
		top: 0;
		left: 0;
		right: 0;
		overflow: visible;
		isolation: isolate;
		z-index: 2;
	}

	div :global(.code-language) {
		color: var(--color-foreground);
		font-weight: 500;
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas,
			'Liberation Mono', Menlo, monospace;
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
	}

	div :global(.code-block-actions) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	div :global(.copy-code-btn),
	div :global(.preview-code-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		background: transparent;
		color: var(--code-foreground);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	div :global(.copy-code-btn:hover),
	div :global(.preview-code-btn:hover) {
		transform: scale(1.05);
	}

	div :global(.copy-code-btn:active),
	div :global(.preview-code-btn:active) {
		transform: scale(0.95);
	}

	div :global(.code-block-wrapper pre) {
		background: transparent;
		margin: 0;
		border-radius: 0;
		border: none;
		font-size: 0.875rem;
	}

	/* Mentions and hashtags */
	div :global(.mention) {
		color: hsl(var(--primary));
		font-weight: 500;
		text-decoration: none;
	}

	div :global(.mention:hover) {
		text-decoration: underline;
	}

	div :global(.hashtag) {
		color: hsl(var(--primary));
		font-weight: 500;
		text-decoration: none;
	}

	div :global(.hashtag:hover) {
		text-decoration: underline;
	}

	/* Keep markdown tables visually stable, also for large generated tables. */
	div :global(table) {
		transition: border-color 0.2s ease;
	}

	div :global(tbody tr:hover) {
		background: color-mix(in oklch, var(--muted) 48%, transparent);
	}

	/* Disable hover effects when rendering user messages */
	.markdown-user-content :global(a),
	.markdown-user-content :global(a:hover) {
		color: inherit;
	}

	.markdown-user-content :global(table:hover) {
		box-shadow: none;
	}

	.markdown-user-content :global(th:hover),
	.markdown-user-content :global(td:hover) {
		background: inherit;
	}

	/* Enhanced blockquotes */
	div :global(blockquote) {
		transition: all 0.2s ease;
		position: relative;
	}

	div :global(blockquote:hover) {
		border-left-width: 6px;
		background: var(--muted);
		transform: translateX(2px);
	}

	div :global(blockquote::before) {
		content: '"';
		position: absolute;
		top: -0.5rem;
		left: 0.5rem;
		font-size: 3rem;
		color: var(--muted-foreground);
		font-family: serif;
		line-height: 1;
	}

	/* Enhanced images */
	div :global(img) {
		transition: all 0.3s ease;
		cursor: pointer;
	}

	div :global(img:hover) {
		transform: scale(1.02);
		box-shadow:
			0 10px 15px -3px rgb(0 0 0 / 0.1),
			0 4px 6px -4px rgb(0 0 0 / 0.1);
	}

	/* Image zoom overlay */
	div :global(.image-zoom-overlay) {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		cursor: pointer;
	}

	div :global(.image-zoom-overlay img) {
		max-width: 90vw;
		max-height: 90vh;
		border-radius: 0.5rem;
		box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
	}

	/* Enhanced horizontal rules */
	div :global(hr) {
		border: none;
		height: 2px;
		background: linear-gradient(to right, transparent, var(--border), transparent);
		margin: 2rem 0;
		position: relative;
	}

	div :global(hr::after) {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 1rem;
		height: 1rem;
		background: var(--border);
		border-radius: 50%;
	}

	/* Scrollable tables */
	div :global(.table-block) {
		position: relative;
		min-height: var(--min-message-height);
		max-height: var(--max-message-height);
		margin: 1.5rem 0;
		overflow: hidden;
		border: 1px solid color-mix(in oklch, var(--border) 30%, transparent);
		border-radius: 0.75rem;
		background: var(--code-background);
		box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
	}

	:global(.dark) div :global(.table-block) {
		border-color: color-mix(in oklch, var(--border) 20%, transparent);
	}

	div :global(.table-actions) {
		position: absolute;
		top: 0.5rem;
		right: 1rem;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}

	div :global(.table-preview-button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		color: var(--code-foreground);
		font-size: 1.125rem;
		line-height: 1;
		cursor: pointer;
		transition:
			color 0.2s ease,
			transform 0.2s ease;
	}

	div :global(.table-preview-button:hover),
	div :global(.table-preview-button:focus-visible) {
		background: transparent;
		color: var(--foreground);
		outline: none;
		transform: scale(1.05);
	}

	div :global(.table-preview-button:active) {
		transform: scale(0.95);
	}

	div :global(.table-preview-button svg) {
		width: 1.45rem;
		height: 1.45rem;
		stroke-width: 2;
	}

	div :global(.table-wrapper) {
		max-width: 100%;
		max-height: var(--max-message-height);
		overflow: auto;
		margin: 0;
		padding: 3rem 1rem 1rem;
		border: none;
		border-radius: 0;
		scrollbar-width: auto;
		scrollbar-color: color-mix(in oklch, var(--muted-foreground) 45%, transparent) transparent;
		-webkit-overflow-scrolling: touch;
	}

	.full-height-code-blocks :global(.table-block),
	.full-height-code-blocks :global(.table-wrapper) {
		max-height: none;
	}

	div :global(.table-wrapper table) {
		display: table;
		width: max-content;
		min-width: 100%;
		max-width: none;
		margin: 0;
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
	}

	div :global(.table-wrapper::-webkit-scrollbar) {
		height: 0.4rem;
	}

	div :global(.table-wrapper::-webkit-scrollbar-track) {
		background: transparent;
	}

	div :global(.table-wrapper::-webkit-scrollbar-thumb) {
		background: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
		border-radius: 9999px;
	}

	div :global(.table-wrapper::-webkit-scrollbar-thumb:hover) {
		background: color-mix(in oklch, var(--muted-foreground) 55%, transparent);
	}

	div :global(.table-wrapper th),
	div :global(.table-wrapper td) {
		white-space: normal;
		word-break: normal;
		overflow-wrap: normal;
	}

	div :global(.table-wrapper .table-cell-content) {
		display: block;
		max-width: 30rem;
		white-space: normal;
		word-break: normal;
		overflow-wrap: break-word;
	}

	/* Frosted Glass surfaces for generated content blocks. */
	:global(html.has-frosted-glass-theme) div :global(.code-block-wrapper),
	:global(html.has-frosted-glass-theme) div :global(.table-block) {
		background: rgba(255, 255, 255, 0.11) !important;
		border: 1px solid rgba(255, 255, 255, 0.12) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			0 1px 2px rgba(0, 0, 0, 0.03),
			0 3px 8px rgba(0, 0, 0, 0.025) !important;
		backdrop-filter: blur(10px) saturate(104%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(104%) !important;
	}

	:global(html.has-frosted-glass-theme) div :global(.code-block-wrapper pre),
	:global(html.has-frosted-glass-theme) div :global(.code-block-wrapper code) {
		background: transparent !important;
	}

	:global(html.has-frosted-glass-theme) div :global(.table-wrapper table),
	:global(html.has-frosted-glass-theme) div :global(.table-wrapper th),
	:global(html.has-frosted-glass-theme) div :global(.table-wrapper td) {
		background-color: rgba(255, 255, 255, 0.05) !important;
		border-color: rgba(255, 255, 255, 0.14) !important;
	}

	:global(html.has-frosted-glass-theme) div :global(.table-wrapper tr:nth-child(even)) {
		background: rgba(255, 255, 255, 0.035) !important;
	}

	:global(html.has-frosted-glass-theme) div :global(blockquote) {
		border: 1px solid rgba(255, 255, 255, 0.14) !important;
		border-left: 4px solid rgba(255, 255, 255, 0.28) !important;
		background: rgba(255, 255, 255, 0.1) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			0 1px 2px rgba(0, 0, 0, 0.03),
			0 3px 8px rgba(0, 0, 0, 0.025) !important;
		color: #000000 !important;
		text-shadow: 0 0 1px rgba(255, 255, 255, 0.18) !important;
		backdrop-filter: blur(10px) saturate(104%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(104%) !important;
	}

	:global(html.has-frosted-glass-theme) div :global(blockquote:hover) {
		background: rgba(255, 255, 255, 0.12) !important;
		transform: translateX(2px);
	}

	:global(html.has-frosted-glass-theme) div :global(blockquote::before) {
		color: rgba(0, 0, 0, 0.28) !important;
		text-shadow: none !important;
	}

	:global(html.has-frosted-glass-theme) div :global(img:not(.image-zoom-overlay img)) {
		padding: 0.35rem;
		border: 1px solid rgba(255, 255, 255, 0.14) !important;
		background: rgba(255, 255, 255, 0.1) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.1),
			0 1px 2px rgba(0, 0, 0, 0.03),
			0 3px 8px rgba(0, 0, 0, 0.025) !important;
		backdrop-filter: blur(10px) saturate(104%) !important;
		-webkit-backdrop-filter: blur(10px) saturate(104%) !important;
	}

	:global(html.has-frosted-glass-theme) div :global(code:not(pre code)) {
		border: 1px solid rgba(255, 255, 255, 0.16) !important;
		background: rgba(255, 255, 255, 0.16) !important;
		color: #000000 !important;
		text-shadow:
			0 0 2px rgba(255, 255, 255, 0.62),
			0 0 7px rgba(255, 255, 255, 0.46),
			0 0 14px rgba(255, 255, 255, 0.28) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 1px 2px rgba(0, 0, 0, 0.035) !important;
		backdrop-filter: blur(8px) saturate(108%) !important;
		-webkit-backdrop-filter: blur(8px) saturate(108%) !important;
	}

	div :global(blockquote .table-preview-button),
	div :global(blockquote .table-preview-button *) {
		font-style: normal !important;
	}

	:global(.table-preview-body .table-preview-wrapper) {
		max-width: 100%;
		max-height: calc(80dvh - 5rem) !important;
		overflow: auto !important;
		margin: 0;
		padding: 3rem 1rem 1rem;
		border: none;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		scrollbar-width: auto;
		scrollbar-color: color-mix(in oklch, var(--muted-foreground) 45%, transparent) transparent;
		-webkit-overflow-scrolling: touch;
	}

	:global(.table-preview-body .table-preview-wrapper table) {
		display: table;
		width: max-content;
		min-width: 100%;
		max-width: none;
		margin: 0;
		border-collapse: collapse;
		border-spacing: 0;
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		border-radius: 0;
		background: var(--background);
		color: var(--foreground);
		box-shadow: none;
		table-layout: auto;
	}

	:global(.table-preview-body .table-preview-wrapper th) {
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		background: color-mix(in oklch, var(--muted) 82%, var(--background));
		padding: 0.55rem 0.75rem;
		color: var(--foreground);
		font-weight: 650;
		letter-spacing: 0.01em;
		text-align: left;
		vertical-align: middle;
		box-shadow: none;
		text-shadow: none;
	}

	:global(.table-preview-body .table-preview-wrapper td) {
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		background: var(--background);
		padding: 0.38rem 0.75rem;
		color: var(--foreground);
		font-weight: 400;
		letter-spacing: normal;
		text-align: left;
		vertical-align: middle;
		box-shadow: none;
		text-shadow: none;
	}

	:global(.table-preview-body .table-preview-wrapper tr:nth-child(even)) {
		background: color-mix(in oklch, var(--muted) 24%, transparent);
	}

	:global(.table-preview-body .table-preview-wrapper tr:nth-child(even) td) {
		background: color-mix(in oklch, var(--muted) 24%, transparent);
	}

	:global(.table-preview-body .table-preview-wrapper .table-cell-content) {
		display: block;
		max-width: 30rem;
		white-space: normal;
		word-break: normal;
		overflow-wrap: break-word;
	}

	:global(.table-preview-body .table-preview-wrapper::-webkit-scrollbar) {
		height: 0.4rem;
	}

	:global(.table-preview-body .table-preview-wrapper::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.table-preview-body .table-preview-wrapper::-webkit-scrollbar-thumb) {
		background: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
		border-radius: 9999px;
	}

	:global(.table-preview-body .table-preview-wrapper::-webkit-scrollbar-thumb:hover) {
		background: color-mix(in oklch, var(--muted-foreground) 55%, transparent);
	}

	:global(html.has-frosted-glass-theme .table-preview-dialog-content),
	:global(html.has-frosted-glass-theme .table-preview-dialog),
	:global(html.has-frosted-glass-theme .table-preview-header),
	:global(html.has-frosted-glass-theme .table-preview-body),
	:global(html.has-frosted-glass-theme .table-preview-wrapper) {
		background-image: none !important;
		text-shadow: none !important;
		backdrop-filter: none !important;
		-webkit-backdrop-filter: none !important;
	}

	/* Responsive adjustments */
	@media (max-width: 640px) {
		div :global(h1) {
			font-size: 1.5rem;
		}

		div :global(h2) {
			font-size: 1.25rem;
		}

		div :global(h3) {
			font-size: 1.125rem;
		}

		div :global(table) {
			font-size: 0.875rem;
			min-width: max-content;
		}

		div :global(th),
		div :global(td) {
			padding: 0.375rem 0.5rem;
		}

		div :global(.table-wrapper) {
			padding-right: 0.75rem;
			padding-left: 0.75rem;
		}
	}

	/* Dark mode adjustments */
	@media (prefers-color-scheme: dark) {
		div :global(blockquote:hover) {
			background: var(--muted);
		}
	}

	/* Image load error fallback */
	div :global(.image-load-error) {
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 1.5rem 0;
		padding: 1.5rem;
		border-radius: 0.5rem;
		background: var(--muted);
		border: 1px dashed var(--border);
	}

	div :global(.image-error-content) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		color: var(--muted-foreground);
		text-align: center;
	}

	div :global(.image-error-content svg) {
		opacity: 0.5;
	}

	div :global(.image-error-text) {
		font-size: 0.875rem;
	}

	div :global(.image-error-link) {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--primary);
		background: var(--background);
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	div :global(.image-error-link:hover) {
		background: var(--muted);
		border-color: var(--primary);
	}
	div :global(.table-block .table-actions) {
		top: 0.9375rem !important;
	}

	div :global(.table-block .table-preview-button),
	div :global(.table-block .table-preview-button svg) {
		line-height: 1 !important;
		vertical-align: top !important;
	}
	/* Code/text/Markdown action icon sizing and Markdown rendered-frame scroll layout. */
	div :global(.code-block-actions) {
		flex: 0 0 auto;
		line-height: 1;
	}

	div :global(.copy-code-btn),
	div :global(.preview-code-btn) {
		width: 1rem;
		height: 1rem;
		min-width: 1rem;
		min-height: 1rem;
		flex: 0 0 auto;
		line-height: 1;
	}

	div :global(.copy-code-btn > span),
	div :global(.preview-code-btn > span) {
		display: flex;
		width: 100%;
		height: 100%;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	div :global(.copy-code-btn svg),
	div :global(.preview-code-btn svg) {
		display: block;
		width: 100%;
		height: 100%;
		flex: 0 0 auto;
	}

	div :global(.markdown-rendered-code-block) {
		display: flex;
		min-height: var(--min-message-height);
		max-height: none;
		flex-direction: column;
		overflow: visible;
	}

	div :global(.markdown-rendered-code-block .code-block-header) {
		position: relative;
		flex: 0 0 auto;
		padding: 1rem 1rem 0.625rem;
		z-index: 2;
		overflow: visible;
		isolation: isolate;
	}

	div :global(.markdown-rendered-code-block .markdown-rendered-code-content) {
		flex: 1 1 auto;
		min-height: 0;
		padding: 1rem 1.25rem 1.25rem;
		overflow-x: auto;
		overflow-y: visible;
		max-height: none;
	}

	.full-height-code-blocks :global(.markdown-rendered-code-block) {
		max-height: none;
	}

	.full-height-code-blocks :global(.markdown-rendered-code-block .markdown-rendered-code-content) {
		overflow-y: visible;
	}
	/* /Code/text/Markdown action icon sizing and Markdown rendered-frame scroll layout. */

	/* llampart-code-header-tooltip-bridge: raw @html code buttons mirror the shared Tooltip primitive. */
	div :global(.code-block-header)::after {
		content: '';
		position: absolute;
		left: 1rem;
		right: 1rem;
		bottom: 0;
		z-index: 0;
		height: 1px;
		background: color-mix(in oklch, var(--border) 48%, transparent);
		pointer-events: none;
	}

	:global(.dark) div :global(.code-block-header)::after {
		background: color-mix(in oklch, var(--border) 34%, transparent);
	}

	:global(html.has-frosted-glass-theme) div :global(.code-block-header)::after {
		background: rgba(255, 255, 255, 0.26);
	}

	div :global(.code-block-header > *) {
		position: relative;
		z-index: 1;
	}

	div :global(.code-block-actions) {
		position: relative;
		z-index: 3;
		overflow: visible;
	}

	div :global(.copy-code-btn[data-llampart-code-tooltip]),
	div :global(.preview-code-btn[data-llampart-code-tooltip]) {
		position: relative;
		overflow: visible;
	}

	div :global(.copy-code-btn[data-llampart-code-tooltip]:hover::after),
	div :global(.copy-code-btn[data-llampart-code-tooltip]:focus-visible::after),
	div :global(.preview-code-btn[data-llampart-code-tooltip]:hover::after),
	div :global(.preview-code-btn[data-llampart-code-tooltip]:focus-visible::after) {
		content: attr(data-llampart-code-tooltip);
		position: absolute;
		top: calc(100% + 0.625rem);
		left: 50%;
		z-index: 80;
		width: max-content;
		max-width: min(22rem, calc(100vw - 2rem));
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--primary);
		color: var(--primary-foreground);
		box-shadow: none;
		filter: none;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1rem;
		letter-spacing: 0;
		text-shadow: none;
		text-transform: none;
		white-space: nowrap;
		transform: translateX(-50%);
		opacity: 1;
		pointer-events: none;
	}

	div :global(.copy-code-btn[data-llampart-code-tooltip]:hover::before),
	div :global(.copy-code-btn[data-llampart-code-tooltip]:focus-visible::before),
	div :global(.preview-code-btn[data-llampart-code-tooltip]:hover::before),
	div :global(.preview-code-btn[data-llampart-code-tooltip]:focus-visible::before) {
		content: '';
		position: absolute;
		top: calc(100% + 0.375rem);
		left: 50%;
		z-index: 79;
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 2px;
		background: var(--primary);
		box-shadow: none;
		filter: none;
		transform: translateX(-50%) rotate(45deg);
		opacity: 1;
		pointer-events: none;
	}

	/* llampart-markdown-inherit-typography-variant
	   Compact containers such as Reasoning can reuse Markdown parsing while keeping
	   their own font family, size and line height. MarkdownContent owns this because
	   it owns markdown presentation resets. */
	div.markdown-inherit-typography,
	div.markdown-inherit-typography :global(*) {
		font-family: inherit !important;
		font-size: inherit !important;
		line-height: inherit !important;
	}

	div.markdown-inherit-typography :global(:is(h1, h2, h3, h4, h5, h6)) {
		font-size: inherit !important;
		line-height: inherit !important;
		margin: 0.5em 0 0.25em !important;
	}

	div.markdown-inherit-typography :global(p) {
		font-size: inherit !important;
		line-height: inherit !important;
		margin: 0.5em 0 !important;
	}

	div.markdown-inherit-typography :global(ul),
	div.markdown-inherit-typography :global(ol) {
		font-size: inherit !important;
		line-height: inherit !important;
		margin: 0.5em 0 0.5em 1.35em !important;
		padding-inline-start: 0 !important;
	}

	div.markdown-inherit-typography :global(li) {
		font-size: inherit !important;
		line-height: inherit !important;
		margin-bottom: 0.25em !important;
		padding-inline-start: 0.25em !important;
	}

	div.markdown-inherit-typography :global(blockquote) {
		font-size: inherit !important;
		line-height: inherit !important;
		margin: 0.5em 0 !important;
		padding: 0.25em 0.75em !important;
	}

	div.markdown-inherit-typography :global(table) {
		font-size: inherit !important;
		line-height: inherit !important;
		margin: 0.75em 0 !important;
	}

	div.markdown-inherit-typography :global(th),
	div.markdown-inherit-typography :global(td) {
		font-size: inherit !important;
		line-height: inherit !important;
		padding: 0.35em 0.55em !important;
	}

	div.markdown-inherit-typography :global(code),
	div.markdown-inherit-typography :global(pre),
	div.markdown-inherit-typography :global(pre code),
	div.markdown-inherit-typography :global(.code-block-wrapper),
	div.markdown-inherit-typography :global(.code-block-wrapper *),
	div.markdown-inherit-typography :global(.markdown-rendered-code-block),
	div.markdown-inherit-typography :global(.markdown-rendered-code-block *) {
		font-family: inherit !important;
		font-size: inherit !important;
		line-height: inherit !important;
	}

	div.markdown-inherit-typography :global(.code-block-wrapper) {
		margin: 0.75em 0 !important;
		min-height: 0 !important;
	}

	div.markdown-inherit-typography :global(.code-block-header) {
		padding: 0.55em 0.65em 0.4em !important;
	}

	div.markdown-inherit-typography :global(.code-block-scroll-container),
	div.markdown-inherit-typography :global(.streaming-code-scroll-container) {
		min-height: 0 !important;
		padding: 0.65em !important;
	}

	div.markdown-inherit-typography :global(> :first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child > :first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child p:first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child ul:first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child ol:first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child blockquote:first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child pre:first-child),
	div.markdown-inherit-typography :global(.markdown-block:first-child table:first-child) {
		margin-top: 0 !important;
	}

	div.markdown-inherit-typography :global(> :last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child > :last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child p:last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child ul:last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child ol:last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child blockquote:last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child pre:last-child),
	div.markdown-inherit-typography :global(.markdown-block:last-child table:last-child) {
		margin-bottom: 0 !important;
	}
</style>
