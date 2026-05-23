<script lang="ts">
	import { t } from '$lib/i18n';
	import { Eye } from '@lucide/svelte';
	import { ActionIconCopyToClipboard } from '$lib/components/app';
	import { FileTypeText } from '$lib/enums';

	interface Props {
		code: string;
		language: string;
		disabled?: boolean;
		onPreview?: (code: string, language: string) => void;
	}

	let { code, language, disabled = false, onPreview }: Props = $props();

	const showPreview = $derived(language?.toLowerCase() === FileTypeText.HTML);

	function handlePreview() {
		if (disabled) return;
		onPreview?.(code, language);
	}
</script>

<div class="code-block-actions">
	<div class="copy-code-btn" class:opacity-50={disabled} class:!cursor-not-allowed={disabled}>
		<ActionIconCopyToClipboard
			text={code}
			canCopy={!disabled}
			ariaLabel={disabled ? t('common.codeIncomplete') : t('common.copyCode')}
		/>
	</div>

	{#if showPreview}
		<button
			class="preview-code-btn"
			class:opacity-50={disabled}
			class:!cursor-not-allowed={disabled}
			title={disabled ? t('common.codeIncomplete') : t('common.previewCode')}
			aria-label={t('common.previewCode')}
			aria-disabled={disabled}
			type="button"
			onclick={handlePreview}
		>
			<Eye size={16} />
		</button>
	{/if}
</div>
