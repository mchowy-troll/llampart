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
		: ''} group relative overflow-hidden rounded-lg {className}"
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
