<script lang="ts">
	import { t } from '$lib/i18n';
	import { ActionIconRemove } from '$lib/components/app';

	interface Props {
		id: string;
		name: string;
		preview: string;
		readonly?: boolean;
		onRemove?: (id: string) => void;
		onClick?: (event?: MouseEvent) => void;
		class?: string;
		// Customizable size props
		width?: string;
		height?: string;
		imageClass?: string;
	}

	let {
		id,
		name,
		preview,
		readonly = false,
		onRemove,
		onClick,
		class: className = '',
		// Default to small size for form previews
		width = 'w-auto',
		height = 'h-16',
		imageClass = ''
	}: Props = $props();
</script>

<div
	class="llampart-attachment-thumbnail-image {readonly
		? 'llampart-attachment-thumbnail-image-readonly'
		: ''} group relative overflow-hidden rounded-lg bg-muted shadow-lg dark:border dark:border-muted {className}"
>
	{#if onClick}
		<button
			type="button"
			class="block h-full w-full rounded-lg focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:outline-none"
			onclick={onClick}
			aria-label={`${t('attachments.preview')} ${name}`}
		>
			<img
				src={preview}
				alt={name}
				class="{height} {width} cursor-pointer object-cover {imageClass}"
			/>
		</button>
	{:else}
		<img
			src={preview}
			alt={name}
			class="{height} {width} cursor-pointer object-cover {imageClass}"
		/>
	{/if}

	{#if !readonly}
		<div
			class="absolute top-1 right-1 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
		>
			<ActionIconRemove {id} {onRemove} class="text-white" />
		</div>
	{/if}
</div>

<style>
	/* llampart-block-b-image-thumbnail-polish */
	:global(html.has-frosted-glass-theme) .llampart-attachment-thumbnail-image-readonly {
		border: 1px solid rgba(255, 255, 255, 0.18) !important;
		background: rgba(255, 255, 255, 0.12) !important;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.14),
			0 1px 2px rgba(0, 0, 0, 0.05),
			0 4px 10px rgba(0, 0, 0, 0.04) !important;
		backdrop-filter: blur(14px) saturate(110%) !important;
		-webkit-backdrop-filter: blur(14px) saturate(110%) !important;
	}
	/* /llampart-block-b-image-thumbnail-polish */
</style>
