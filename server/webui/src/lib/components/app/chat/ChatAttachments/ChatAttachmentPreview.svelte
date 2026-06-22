<script lang="ts">
	import * as Alert from '$lib/components/ui/alert';
	import { FileText, Image, Music, FileIcon, Info } from '@lucide/svelte';
	import { isTextFile, isImageFile, isPdfFile, isAudioFile, createBase64DataUrl } from '$lib/utils';
	import { convertPDFToImage } from '$lib/utils/browser-only';
	import { MarkdownContent } from '$lib/components/app/content';
	import { modelsStore } from '$lib/stores/models.svelte';
	import { t } from '$lib/i18n';

	interface Props {
		// Either an uploaded file or a stored attachment
		uploadedFile?: ChatUploadedFile;
		attachment?: DatabaseMessageExtra;
		// For uploaded files
		preview?: string;
		name?: string;
		textContent?: string;
		// For checking vision modality
		activeModelId?: string;
	}

	let { uploadedFile, attachment, preview, name, textContent, activeModelId }: Props = $props();

	let hasVisionModality = $derived(
		activeModelId ? modelsStore.modelSupportsVision(activeModelId) : false
	);

	let displayName = $derived(
		uploadedFile?.name || attachment?.name || name || t('attachments.unknownFile')
	);

	let displayMimeType = $derived(
		uploadedFile?.type ||
			(attachment && 'mimeType' in attachment && attachment.mimeType
				? attachment.mimeType
				: undefined)
	);

	let isAudio = $derived(isAudioFile(attachment, uploadedFile));
	let isImage = $derived(isImageFile(attachment, uploadedFile));
	let isPdf = $derived(isPdfFile(attachment, uploadedFile));
	let isText = $derived(isTextFile(attachment, uploadedFile));
	let isMarkdown = $derived(isText && isMarkdownLike(displayName, displayMimeType));

	let displayPreview = $derived(
		uploadedFile?.preview ||
			(isImage && attachment && 'base64Url' in attachment ? attachment.base64Url : preview)
	);

	let displayTextContent = $derived(
		uploadedFile?.textContent ||
			(attachment && 'content' in attachment ? attachment.content : textContent)
	);

	let IconComponent = $derived(() => {
		if (isImage) return Image;
		if (isText || isPdf) return FileText;
		if (isAudio) return Music;

		return FileIcon;
	});

	let pdfImages = $state<string[]>([]);
	let pdfImagesLoading = $state(false);
	let pdfImagesError = $state<string | null>(null);

	function isMarkdownLike(fileName: string, mimeType?: string): boolean {
		const normalizedName = fileName.trim().toLowerCase().split('?')[0].split('#')[0];
		const normalizedMime = mimeType?.trim().toLowerCase();

		return (
			normalizedName.endsWith('.md') ||
			normalizedName.endsWith('.markdown') ||
			normalizedName.endsWith('.mdown') ||
			normalizedName.endsWith('.mkd') ||
			normalizedMime === 'text/markdown' ||
			normalizedMime === 'text/x-markdown'
		);
	}

	async function loadPdfImages() {
		if (!isPdf || pdfImages.length > 0 || pdfImagesLoading) return;

		pdfImagesLoading = true;
		pdfImagesError = null;

		try {
			let file: File | null = null;

			if (uploadedFile?.file) {
				file = uploadedFile.file;
			} else if (isPdf && attachment) {
				if ('base64Data' in attachment && attachment.base64Data) {
					const base64Data = attachment.base64Data;
					const byteCharacters = atob(base64Data);
					const byteNumbers = new Array(byteCharacters.length);
					for (let i = 0; i < byteCharacters.length; i++) {
						byteNumbers[i] = byteCharacters.charCodeAt(i);
					}
					const byteArray = new Uint8Array(byteNumbers);
					file = new File([byteArray], displayName, { type: 'application/pdf' });
				} else if (
					'images' in attachment &&
					attachment.images &&
					Array.isArray(attachment.images) &&
					attachment.images.length > 0
				) {
					pdfImages = attachment.images;
					return;
				}
			}

			if (file) {
				const pdfPreviewScale = Math.max(2.5, Math.min(3.5, window.devicePixelRatio * 2));
				pdfImages = await convertPDFToImage(file, pdfPreviewScale);
			} else {
				throw new Error(t('attachments.noPdfFileAvailableForConversion'));
			}
		} catch (error) {
			pdfImagesError =
				error instanceof Error ? error.message : t('attachments.failedToLoadPdfImages');
		} finally {
			pdfImagesLoading = false;
		}
	}

	export function reset() {
		pdfImages = [];
		pdfImagesLoading = false;
		pdfImagesError = null;
	}

	$effect(() => {
		if (isPdf) {
			loadPdfImages();
		}
	});
</script>

<div class="llampart-attachment-preview-content">
	{#if isImage && displayPreview}
		<div class="llampart-attachment-image-preview-frame">
			<img src={displayPreview} alt={displayName} class="llampart-attachment-image-preview" />
		</div>
	{:else if isPdf}
		{#if !hasVisionModality && activeModelId}
			<Alert.Root class="mb-4 w-full">
				<Info class="h-4 w-4" />
				<Alert.Title>{t('attachments.previewOnly')}</Alert.Title>
				<Alert.Description>
					{t('attachments.selectedModelDoesNotSupportVisionOnlyExtracted')}
					{t('attachments.willBeSentToModel')}
				</Alert.Description>
			</Alert.Root>
		{/if}

		{#if pdfImagesLoading}
			<div class="flex items-center justify-center p-8">
				<div class="text-center">
					<div
						class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
					></div>

					<p class="text-muted-foreground">{t('attachments.convertingPdfToImages')}</p>
				</div>
			</div>
		{:else if pdfImagesError}
			<div class="flex items-center justify-center p-8">
				<div class="text-center">
					<FileText class="mx-auto mb-4 h-16 w-16 text-muted-foreground" />

					<p class="mb-4 text-muted-foreground">{t('attachments.failedToLoadPdfImages')}</p>

					<p class="text-sm text-muted-foreground">{pdfImagesError}</p>
				</div>
			</div>
		{:else if pdfImages.length > 0}
			<div class="llampart-attachment-pdf-preview-pages">
				{#each pdfImages as image, index (image)}
					<div class="llampart-attachment-pdf-preview-page">
						<p class="mb-2 text-center text-sm text-muted-foreground">
							{t('attachments.page')}
							{index + 1}
						</p>

						<img
							src={image}
							alt={`${t('attachments.pdfPage')} ${index + 1}`}
							class="llampart-attachment-pdf-preview-image"
						/>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex items-center justify-center p-8">
				<div class="text-center">
					<FileText class="mx-auto mb-4 h-16 w-16 text-muted-foreground" />

					<p class="mb-4 text-muted-foreground">{t('attachments.noPdfPagesAvailable')}</p>
				</div>
			</div>
		{/if}
	{:else if isMarkdown && displayTextContent}
		<div class="llampart-attachment-markdown-preview markdown-rendered-preview-dialog">
			<MarkdownContent class="llampart-attachment-markdown-content" content={displayTextContent} />
		</div>
	{:else if isText && displayTextContent}
		<pre class="llampart-attachment-text-preview"><code>{displayTextContent}</code></pre>
	{:else if isAudio}
		<div class="flex items-center justify-center p-8">
			<div class="w-full max-w-md text-center">
				<Music class="mx-auto mb-4 h-16 w-16 text-muted-foreground" />

				{#if uploadedFile?.preview}
					<audio controls class="mb-4 w-full" src={uploadedFile.preview}>
						{t('attachments.browserDoesNotSupportAudioElement')}
					</audio>
				{:else if isAudio && attachment && 'mimeType' in attachment && 'base64Data' in attachment}
					<audio
						controls
						class="mb-4 w-full"
						src={createBase64DataUrl(attachment.mimeType, attachment.base64Data)}
					>
						{t('attachments.browserDoesNotSupportAudioElement')}
					</audio>
				{:else}
					<p class="mb-4 text-muted-foreground">{t('attachments.audioPreviewNotAvailable')}</p>
				{/if}

				<p class="text-sm text-muted-foreground">
					{displayName}
				</p>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-center p-8">
			<div class="text-center">
				{#if IconComponent}
					<IconComponent class="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
				{/if}

				<p class="mb-4 text-muted-foreground">
					{t('attachments.previewNotAvailableForFileType')}
				</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.llampart-attachment-preview-content {
		box-sizing: border-box;
		width: fit-content;
		min-width: min(18rem, calc(80vw - 2rem));
		max-width: calc(80vw - 2rem);
		max-height: calc(80dvh - 8.5rem);
		margin-inline: auto;
		overflow: auto;
	}

	.llampart-attachment-image-preview-frame {
		display: flex;
		width: fit-content;
		max-width: 100%;
		min-height: 0;
		align-items: center;
		justify-content: center;
		margin-inline: auto;
	}

	.llampart-attachment-image-preview {
		display: block;
		width: auto;
		height: auto;
		max-width: calc(80vw - 4rem);
		max-height: calc(80dvh - 8.5rem);
		border-radius: 0.75rem;
		object-fit: contain;
	}

	.llampart-attachment-pdf-preview-pages {
		display: flex;
		width: fit-content;
		max-width: calc(80vw - 4rem);
		min-height: 0;
		max-height: calc(80dvh - 8.5rem);
		flex-direction: column;
		gap: 1rem;
		overflow: auto;
		margin-inline: auto;
	}

	.llampart-attachment-pdf-preview-page {
		width: fit-content;
		max-width: 100%;
		margin-inline: auto;
		text-align: center;
	}

	.llampart-attachment-pdf-preview-image {
		display: block;
		width: auto;
		height: auto;
		max-width: calc(80vw - 4rem);
		max-height: calc(80dvh - 8.5rem);
		margin-inline: auto;
		border-radius: 0.75rem;
		object-fit: contain;
	}

	.llampart-attachment-markdown-preview,
	.llampart-attachment-text-preview {
		box-sizing: border-box;
		width: min(72rem, calc(80vw - 2rem));
		max-width: calc(80vw - 2rem);
		max-height: calc(80dvh - 8.5rem);
		margin: 0;
		overflow: auto;
		border: 1px solid color-mix(in oklch, var(--border) 68%, transparent);
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--muted) 50%, transparent);
		padding: 1rem;
		color: var(--foreground);
	}

	.llampart-attachment-markdown-preview {
		font-size: 0.9375rem;
		line-height: 1.6;
	}

	.llampart-attachment-text-preview {
		font: inherit;
		line-height: 1.75;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.llampart-attachment-text-preview code {
		font: inherit;
		white-space: inherit;
	}

	:global(html.has-frosted-glass-theme) .llampart-attachment-markdown-preview,
	:global(html.has-frosted-glass-theme) .llampart-attachment-text-preview {
		background: var(
			--llampart-frosted-preview-inline-background,
			color-mix(in oklch, var(--muted) 50%, transparent)
		);
		color: var(--llampart-frosted-preview-inline-foreground, var(--foreground));
		text-shadow: var(--llampart-frosted-preview-inline-text-shadow, none) !important;
		backdrop-filter: var(--llampart-frosted-preview-inline-backdrop-filter, none) !important;
		-webkit-backdrop-filter: var(
			--llampart-frosted-preview-inline-backdrop-filter,
			none
		) !important;
	}

	:global(html.has-frosted-glass-theme) .llampart-attachment-markdown-preview :global(*) {
		text-shadow: var(--llampart-frosted-preview-inline-text-shadow, none) !important;
	}
</style>
