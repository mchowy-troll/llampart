<script lang="ts">
	interface Props {
		show?: boolean;
		className?: string;
	}

	let { show = false, className = '' }: Props = $props();

	$effect(() => {
		void show;
		void className;
	});
</script>

<!--
	llampart: helper text is intentionally hidden.
	The composer hover tooltip is handled globally through
	ChatForm.svelte data-llampart-composer-helper + src/app.css.
-->
