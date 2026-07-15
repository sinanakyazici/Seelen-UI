<script lang="ts">
  import { invoke, SeelenCommand } from "@seelen-ui/lib";
  import {
    SeelenWegMode,
    WegItemType,
    WegPinnedItemsVisibility,
    WegTemporalItemsVisibility,
  } from "@seelen-ui/lib/types";
  import { DragDropProvider, DragOverlay } from "@dnd-kit/svelte";
  import { move } from "@dnd-kit/helpers";
  import { BackgroundByLayers } from "libs/ui/svelte/components/BackgroundByLayers";
  import { t } from "../i18n/index.ts";
  import { dockState, dockStateActions } from "../state/items.svelte.ts";
  import { settingsState } from "../state/settings.svelte.ts";
  import { systemState } from "../state/system.svelte.ts";
  import { interactables, getWindowsForItem } from "../state/windows.svelte.ts";
  import { dockShouldBeHidden, setDockIsDraggingItem } from "../state/hidden.svelte.ts";
  import { getSeelenWegMenu } from "../dockMenu.ts";
  import { DND_PLUGINS, DND_SENSORS } from "libs/ui/dnd.ts";
  import DraggableItem from "./DraggableItem.svelte";
  import WegItemSwitch from "./WegItemSwitch.svelte";

  const settings = $derived(settingsState.value as any);
  const isHorizontal = $derived(
    settings?.position === "Top" || settings?.position === "Bottom",
  );

  const visibleItems = $derived.by(() => {
    const pinnedVisibility = settings?.pinnedItemsVisibility as WegPinnedItemsVisibility;
    const temporalVisibility = settings?.temporalItemsVisibility as WegTemporalItemsVisibility;
    const monitor = systemState.currentMonitor;

    const showPinned =
      pinnedVisibility === WegPinnedItemsVisibility.Always || monitor.isPrimary;
    const filterByMonitor =
      temporalVisibility === WegTemporalItemsVisibility.OnMonitor;

    const windows = filterByMonitor
      ? interactables.value.filter((w) => w.monitor === monitor.id)
      : interactables.value;

    return dockState.items.filter((item) => {
      if (item.type !== "AppOrFile") {
        return showPinned;
      }
      if (item.pinned && showPinned) {
        return true;
      }
      return getWindowsForItem(item as any, windows).length > 0;
    });
  });

  const isEmpty = $derived(
    visibleItems.filter((c) => c.type !== WegItemType.Separator).length === 0,
  );

  function onContextMenu() {
    const alignX = settingsState.popupAlignX;
    const alignY = settingsState.popupAlignY;
    invoke(SeelenCommand.TriggerContextMenu, {
      menu: { ...getSeelenWegMenu($t), alignX, alignY },
      forwardTo: null,
    });
  }

  function itemById(id: unknown) {
    return dockState.items.find((i) => i.id === String(id));
  }

  // A folder exposes two overlapping droppables: its sortable (id === folder id)
  // and a dedicated "folder-drop:<id>" zone. Accept either as "drop into folder".
  function resolveFolderId(targetId: unknown): string | undefined {
    const id = String(targetId ?? "");
    if (id.startsWith("folder-drop:")) return id.slice("folder-drop:".length);
    const it = itemById(id);
    return it?.type === WegItemType.Folder ? it.id : undefined;
  }

  function handleDragOver(event: any) {
    const { source, target } = event.operation;
    // While dragging an app over a folder, don't reorder — let it nest on drop.
    const src = itemById(source?.id);
    if (src?.type === WegItemType.AppOrFile && resolveFolderId(target?.id)) {
      return;
    }
    const newItems = move(dockState.items, event);
    dockState.items = newItems;
  }

  function handleDragStart() {
    setDockIsDraggingItem(true);
  }

  function handleDragEnd(event: any) {
    setDockIsDraggingItem(false);
    const { source, target } = event.operation;
    if (!source || !target) return;
    const src = itemById(source.id);
    const folderId = resolveFolderId(target.id);
    if (src?.type === WegItemType.AppOrFile && folderId && folderId !== String(source.id)) {
      dockStateActions.moveItemToFolder(String(source.id), folderId);
    }
  }
</script>

<div
  role="toolbar"
  tabindex="0"
  data-has-margin={!!settings?.margin}
  data-size={settings?.mode === SeelenWegMode.FullWidth ? "full-width" : "min-content"}
  class="taskbar {settingsState.position.toLowerCase()}"
  class:horizontal={isHorizontal}
  class:vertical={!isHorizontal}
  class:hidden={dockShouldBeHidden.value}
  oncontextmenu={onContextMenu}
>
  <BackgroundByLayers />
  <div class="weg-items-container">
    <DragDropProvider
      plugins={DND_PLUGINS}
      sensors={DND_SENSORS}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div class="weg-items">
        {#if isEmpty}
          <span class="weg-empty-state-label">{$t("weg.empty")}</span>
        {:else}
          {#each visibleItems as item, index (item.id)}
            <DraggableItem {item} {index}>
              <WegItemSwitch {item} />
            </DraggableItem>
          {/each}
        {/if}
      </div>

      <DragOverlay>
        {#snippet children(source)}
          {@const overlayItem = visibleItems.find((c) => c.id === source.id)}
          {#if overlayItem}
            <WegItemSwitch item={overlayItem} isOverlay={true} />
          {/if}
        {/snippet}
      </DragOverlay>
    </DragDropProvider>
  </div>
</div>
