<script lang="ts">
	import { t } from '$lib/i18n';
	import { SearchInput } from '$lib/components/app';

	interface Props {
		value?: string;
		placeholder?: string;
		onInput?: (value: string) => void;
		class?: string;
	}

	let {
		value = $bindable(''),
		placeholder = t('sidebar.searchConversationsPlaceholder'),
		onInput,
		class: className
	}: Props = $props();
</script>

<SearchInput bind:value {placeholder} {onInput} class="llampart-quiet-search mb-4 {className}" />
