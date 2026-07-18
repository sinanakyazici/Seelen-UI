<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ToolbarItem, ToolbarItem2 } from "@seelen-ui/lib/types";
  import { plugins } from "../state/items.svelte.ts";
  import SortableItem from "./SortableItem.svelte";

  interface Props {
    id: string;
    items: ToolbarItem2[];
    itemIndexById: Map<string, number>;
    before?: Snippet;
  }

  let { id, items, itemIndexById, before }: Props = $props();
</script>

<div class="ft-bar-container ft-bar-{id}">
  {@render before?.()}
  {#each items as entry (typeof entry === "string" ? entry : entry.id)}
    {@const index = itemIndexById.get(typeof entry === "string" ? entry : entry.id) ?? 0}
    {#if typeof entry === "string"}
      {@const cached = plugins.value.find((p) => p.id === entry)}
      {#if cached}
        {@const module = { ...(cached.plugin as ToolbarItem), id: entry }}
        <SortableItem {module} {index} />
      {/if}
    {:else}
      <SortableItem module={entry} {index} />
    {/if}
  {/each}
</div>
