<script lang="ts">
  import { runningPinnedIcons } from "../state/pinnedTray.svelte.ts";
  import PinnedTrayItem from "./PinnedTrayItem.svelte";

  // Only running pinned icons are rendered, with a stable array reference while
  // the running set/order is unchanged (see runningPinnedIcons) so tray churn
  // doesn't disrupt an in-progress drag. Indices are contiguous 0..N.
  const running = $derived(runningPinnedIcons());
</script>

{#if running.length > 0}
  <div class="ft-bar-pinned-tray">
    {#each running as icon, i (icon.key)}
      <PinnedTrayItem {icon} index={i} />
    {/each}
  </div>
{/if}
