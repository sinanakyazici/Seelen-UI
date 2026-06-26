<script lang="ts">
  import { invoke, SeelenCommand } from "@seelen-ui/lib";
  import { WegItemType } from "@seelen-ui/lib/types";
  import { createDroppable } from "@dnd-kit/svelte";
  import { CollisionPriority } from "@dnd-kit/abstract";
  import { Icon, FileIcon } from "libs/ui/svelte/components/Icon/index.ts";
  import { t } from "../../i18n/index.ts";
  import type { FolderWegItem, AppOrFileWegItem } from "../../types.ts";
  import { settingsState, getDockContextMenuAlignment } from "../../state/settings.svelte.ts";
  import { interactables, getWindowsForItem, windowsState, focused } from "../../state/windows.svelte.ts";
  import { launchItem } from "../../appMenu.ts";
  import { getFolderContextMenu, getFolderEntryContextMenu } from "../../folderMenu.ts";

  interface Props {
    item: FolderWegItem;
    isOverlay?: boolean;
  }

  let { item, isOverlay = false }: Props = $props();

  let open = $state(false);
  let folderEl: HTMLDivElement | null = $state(null);
  let popoverStyle = $state("");

  // Dedicated drop zone so dragging a dock app onto the folder highlights it
  // (and wins collision over plain reordering). Resolved in Dock.svelte.
  const droppable = createDroppable({
    get id() {
      return `folder-drop:${item.id}`;
    },
    get data() {
      return { folderId: item.id };
    },
    // Only app drags should target the folder; folder reordering (type Folder)
    // must NOT hit this high-priority zone or it hijacks the sortable move.
    accept: [WegItemType.AppOrFile],
    collisionPriority: CollisionPriority.Highest,
  });

  const iconColor = $derived(item.color ?? "var(--system-accent-color)");

  /** Position the popover with `position: fixed` so it escapes the dock
   * container's `overflow` clipping. Anchored to the folder icon per dock side. */
  function computePopoverStyle() {
    if (!folderEl) return;
    const r = folderEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    switch (settingsState.position) {
      case "Top":
        popoverStyle = `position:fixed;left:${cx}px;top:${r.bottom}px;transform:translate(-50%,0);`;
        break;
      case "Left":
        popoverStyle = `position:fixed;left:${r.right}px;top:${cy}px;transform:translate(0,-50%);`;
        break;
      case "Right":
        popoverStyle = `position:fixed;left:${r.left}px;top:${cy}px;transform:translate(-100%,-50%);`;
        break;
      default: // Bottom
        popoverStyle = `position:fixed;left:${cx}px;top:${r.top}px;transform:translate(-50%,-100%);`;
    }
  }

  let rafId = 0;
  // Keep the popover glued to the folder's CURRENT rect every frame while open.
  // The active theme magnifies the folder icon on hover, which shifts its
  // position/center; a one-shot measure at open time would leave the popover
  // off to one side. Tracking each frame keeps it centred as the folder grows.
  function trackPopover() {
    computePopoverStyle();
    if (open) rafId = requestAnimationFrame(trackPopover);
  }

  function openPopover() {
    if (item.items.length === 0) return;
    open = true;
    cancelAnimationFrame(rafId);
    trackPopover();
  }

  function closePopover() {
    open = false;
    cancelAnimationFrame(rafId);
  }

  function entryWindowsOf(entry: FolderWegItem["items"][number]) {
    return getWindowsForItem({ type: WegItemType.AppOrFile, ...entry } as AppOrFileWegItem, interactables.value);
  }

  const folderWindows = $derived(item.items.flatMap((e) => entryWindowsOf(e)));

  function onEntryClick(entry: FolderWegItem["items"][number]) {
    const appItem = { type: WegItemType.AppOrFile, ...entry } as AppOrFileWegItem;
    const win = entryWindowsOf(entry)[0];
    if (!win) {
      launchItem(appItem, false);
    } else {
      invoke(SeelenCommand.WegToggleWindowState, {
        hwnd: win.hwnd,
        wasFocused: windowsState.delayedFocused?.hwnd === win.hwnd,
      });
    }
  }

  function onEntryClose(entry: FolderWegItem["items"][number], e: MouseEvent) {
    e.stopPropagation();
    for (const w of entryWindowsOf(entry)) {
      invoke(SeelenCommand.WegCloseApp, { hwnd: w.hwnd });
    }
  }

  function onFolderContextMenu(e: MouseEvent) {
    e.stopPropagation();
    const { alignX, alignY } = getDockContextMenuAlignment(settingsState.position);
    invoke(SeelenCommand.TriggerContextMenu, {
      menu: { ...getFolderContextMenu($t, item), alignX, alignY },
      forwardTo: null,
    });
  }

  function onEntryContextMenu(entry: FolderWegItem["items"][number], e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const { alignX, alignY } = getDockContextMenuAlignment(settingsState.position);
    invoke(SeelenCommand.TriggerContextMenu, {
      menu: { ...getFolderEntryContextMenu($t, item.id, entry.id), alignX, alignY },
      forwardTo: null,
    });
  }

</script>

<div
  class="weg-item-overlay weg-item-folder-wrapper"
  role="menu"
  tabindex="0"
  onmouseenter={openPopover}
  onmouseleave={closePopover}
>
  <div
    bind:this={folderEl}
    {@attach droppable.attach}
    role="menuitem"
    tabindex="0"
    class="weg-item weg-item-folder"
    class:weg-item-folder-drop-target={droppable.isDropTarget}
    oncontextmenu={onFolderContextMenu}
    onkeypress={() => {}}
  >
    <Icon class="weg-item-icon weg-item-folder-icon" iconName="BsFolderFill" size="100%" color={iconColor} />
    {#if item.items.length > 0}
      <div class="weg-item-folder-count">{item.items.length}</div>
    {/if}
    <div
      class="weg-item-open-sign"
      class:weg-item-open-sign-active={folderWindows.length > 0}
    ></div>
  </div>

  {#if open && !isOverlay}
    <div class="weg-folder-popover" style={popoverStyle}>
      {#each item.items as entry (entry.id)}
        {@const entryWindows = entryWindowsOf(entry)}
        <div
          class="weg-folder-popover-item weg-item-overlay"
          role="menuitem"
          tabindex="0"
          title={entry.displayName}
          onclick={() => onEntryClick(entry)}
          oncontextmenu={(e) => onEntryContextMenu(entry, e)}
          onkeypress={() => {}}
        >
          <FileIcon class="weg-item-icon" path={entry.relaunch?.icon || entry.path} umid={entry.umid} />
          <div
            class="weg-item-open-sign"
            class:weg-item-open-sign-active={entryWindows.length > 0}
            class:weg-item-open-sign-focused={entryWindows.some((w) => w.hwnd === focused.value?.hwnd)}
          ></div>
          {#if entryWindows.length > 0}
            <button
              type="button"
              class="weg-folder-popover-remove"
              title={$t("app_menu.close")}
              onclick={(e) => onEntryClose(entry, e)}
            >
              <Icon iconName="IoClose" />
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
