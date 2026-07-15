<script lang="ts">
  import { invoke, SeelenCommand } from "@seelen-ui/lib";
  import { HARDCODED_SEPARATOR_LEFT, HARDCODED_SEPARATOR_RIGHT } from "../../state/items.svelte.ts";
  import { settingsState } from "../../state/settings.svelte.ts";
  import { t } from "../../i18n/index.ts";
  import { getSeparatorContextMenu } from "../../folderMenu.ts";
  import type { SeparatorWegItem } from "../../types.ts";

  interface Props {
    item: SeparatorWegItem;
  }

  let { item }: Props = $props();

  const isSeparator1 = $derived(item.id === HARDCODED_SEPARATOR_LEFT.id);
  const isSeparator2 = $derived(item.id === HARDCODED_SEPARATOR_RIGHT.id);
  const visible = $derived(settingsState.value?.visibleSeparators);

  function onContextMenu(e: MouseEvent) {
    e.stopPropagation();
    const alignX = settingsState.popupAlignX;
    const alignY = settingsState.popupAlignY;
    invoke(SeelenCommand.TriggerContextMenu, {
      menu: { ...getSeparatorContextMenu($t), alignX, alignY },
      forwardTo: null,
    });
  }
</script>

<div
  class="weg-separator"
  class:weg-separator-1={isSeparator1}
  class:weg-separator-2={isSeparator2}
  class:visible
  role="menuitem"
  tabindex="0"
  oncontextmenu={onContextMenu}
  onkeypress={() => {}}
></div>
