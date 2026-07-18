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
  import { dockState, dockStateActions, listToGroups } from "../state/items.svelte.ts";
  import { settingsState } from "../state/settings.svelte.ts";
  import { systemState } from "../state/system.svelte.ts";
  import { interactables, getWindowsForItem } from "../state/windows.svelte.ts";
  import { dockShouldBeHidden, setDockIsDraggingItem } from "../state/hidden.svelte.ts";
  import { getSeelenWegMenu } from "../dockMenu.ts";
  import { DND_PLUGINS, DND_SENSORS } from "libs/ui/dnd.ts";
  import type { SwItem } from "../types.ts";
  import DockItemsGroup from "./DockItemsGroup.svelte";
  import WegItemSwitch from "./WegItemSwitch.svelte";

  const settings = $derived(settingsState.value as any);
  const isHorizontal = $derived(settings?.position === "Top" || settings?.position === "Bottom");

  function isItemVisible(item: SwItem): boolean {
    const pinnedVisibility = settings?.pinnedItemsVisibility as WegPinnedItemsVisibility;
    const temporalVisibility = settings?.temporalItemsVisibility as WegTemporalItemsVisibility;
    const monitor = systemState.currentMonitor;

    const showPinned = pinnedVisibility === WegPinnedItemsVisibility.Always || monitor.isPrimary;
    const filterByMonitor = temporalVisibility === WegTemporalItemsVisibility.OnMonitor;

    const windows = filterByMonitor
      ? interactables.value.filter((w) => w.monitor === monitor.id)
      : interactables.value;

    if (item.type !== "AppOrFile") {
      return showPinned;
    }
    if (item.pinned && showPinned) {
      return true;
    }
    return getWindowsForItem(item as any, windows).length > 0;
  }

  // splits the flat items array (left..., left-separator, center..., right-separator, ...right)
  // into their three groups, same as the toolbar does
  const groupedItems = $derived(listToGroups(dockState.items));
  const visibleGroupedItems = $derived.by(() => ({
    left: groupedItems.left.filter(isItemVisible),
    center: groupedItems.center.filter(isItemVisible),
    right: groupedItems.right.filter(isItemVisible),
  }));

  const isEmpty = $derived(
    [
      ...visibleGroupedItems.left,
      ...visibleGroupedItems.center,
      ...visibleGroupedItems.right,
    ].filter((c) => c.type !== "Separator").length === 0,
  );

  const itemIndexById = $derived.by(() => {
    const map = new Map<string, number>();
    dockState.items.forEach((item, i) => map.set(item.id, i));
    return map;
  });

  function onContextMenu(e: MouseEvent) {
    const alignX = settingsState.popupAlignX;
    const alignY = settingsState.popupAlignY;
    const cursor = { x: e.clientX, y: e.clientY };
    invoke(SeelenCommand.TriggerContextMenu, {
      menu: { ...getSeelenWegMenu($t, cursor), alignX, alignY },
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
          <DockItemsGroup id="left" items={visibleGroupedItems.left} {itemIndexById} />
          <DockItemsGroup id="center" items={visibleGroupedItems.center} {itemIndexById} />
          <DockItemsGroup id="right" items={visibleGroupedItems.right} {itemIndexById} />
        {/if}
      </div>

      <DragOverlay>
        {#snippet children(source)}
          {@const overlayItem = dockState.items.find((c) => c.id === source.id)}
          {#if overlayItem}
            <WegItemSwitch item={overlayItem} isOverlay={true} />
          {/if}
        {/snippet}
      </DragOverlay>
    </DragDropProvider>
  </div>
</div>
