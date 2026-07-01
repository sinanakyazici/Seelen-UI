<script lang="ts">
  import { invoke, SeelenCommand } from "@seelen-ui/lib";
  import { type SysTrayIcon, SystrayIconAction } from "@seelen-ui/lib/types";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { createSortable } from "@dnd-kit/svelte/sortable";
  import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers";
  import { MissingIcon } from "libs/ui/svelte/components/Icon";
  import { matchesPinnedTrayIcon, type PinnedTrayIcon } from "libs/ui/svelte/utils/pinnedTray.ts";
  import { toolbarState } from "../state/items.svelte.ts";
  import { pinnedSortableId } from "../state/pinnedTray.svelte.ts";
  import { trayState } from "../state/systemTray.svelte.ts";

  interface Props {
    icon: PinnedTrayIcon;
    index: number;
  }

  let { icon, index }: Props = $props();

  // Resolve the live tray icon INSIDE the item so the parent list only depends
  // on the (stable) pinned order. Tray icons churn every second (sensor
  // tooltips/images); keeping that churn local means it never re-renders the
  // sortable list and disrupts an in-progress drag.
  //
  // Retain the LAST known match: the backend occasionally omits an icon from a
  // tray snapshot for a frame, and clearing `item` then would unmount/remount
  // the <img> (visible blink). Only update when a match is found; the parent
  // decides when to drop the item entirely (running-set grace).
  let item = $state<SysTrayIcon | undefined>(undefined);
  $effect(() => {
    const found = trayState.items.find((it) => matchesPinnedTrayIcon(it, icon));
    if (found) item = found;
  });

  const sortable = createSortable({
    get id() {
      return pinnedSortableId(icon);
    },
    get index() {
      return index;
    },
    // Own sortable group so pinned icons reorder among themselves with their own
    // 0..N index space, independent of the toolbar items' sortable list.
    group: "pinned-tray",
    get disabled() {
      return toolbarState.isReorderDisabled;
    },
    modifiers: [RestrictToHorizontalAxis],
  });

  function sendAction(action: SystrayIconAction) {
    if (!item) return;
    invoke(SeelenCommand.SendSystemTrayIconAction, { id: item.stable_id, action });
  }

  function onClick(event: MouseEvent) {
    if (event.detail === 2) return; // let dblclick handle it
    let action = SystrayIconAction.LeftClick;
    if (event.button === 1) action = SystrayIconAction.MiddleClick;
    else if (event.button === 2) action = SystrayIconAction.RightClick;
    sendAction(action);
  }

  function onDoubleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    sendAction(SystrayIconAction.LeftDoubleClick);
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    sendAction(SystrayIconAction.RightClick);
  }
</script>

<button
  {@attach sortable.attach}
  class="ft-bar-pinned-tray-item"
  style="opacity: {sortable.isDragging ? 0.3 : 1}"
  data-skin="transparent"
  title={item?.tooltip}
  onclick={onClick}
  ondblclick={onDoubleClick}
  oncontextmenu={onContextMenu}
  onauxclick={onClick}
>
  {#if item?.icon_path}
    <img
      class="ft-bar-pinned-tray-icon"
      src={convertFileSrc(item.icon_path) + `?hash=${item.icon_image_hash || "null"}`}
      alt=""
      draggable={false}
    />
  {:else if item}
    <MissingIcon class="ft-bar-pinned-tray-icon" />
  {/if}
</button>
