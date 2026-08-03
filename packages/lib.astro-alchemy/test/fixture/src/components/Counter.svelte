<script lang="ts">
  let { start = 0 }: { start?: number } = $props();
  let count = $state(start);
</script>

<button data-svelte-counter onclick={() => count++}>
  svelte count: {count}
</button>
