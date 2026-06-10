import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import type { Droppable } from "@dnd-kit/abstract";
import { WegItemType, WegPinnedItemsVisibility, WegTemporalItemsVisibility } from "@seelen-ui/lib/types";
import { useTranslation } from "react-i18next";

import { FolderItem } from "../item/infra/FolderItem.tsx";
import { MediaSession } from "../item/infra/MediaSession.tsx";
import { Separator } from "../item/infra/Separator.tsx";
import { StartMenu } from "../item/infra/StartMenu.tsx";
import { UserApplication } from "../item/infra/UserApplication.tsx";

import type { SwItem } from "../shared/types.ts";

import {
  $dock_state,
  $dock_state_actions,
  $folder_drag_over_dock,
  $folder_dragging_from,
  $folder_extracted_drag_id,
} from "../shared/state/items.ts";
import { DraggableItem } from "./DraggableItem.tsx";
import { ShowDesktopModule } from "../item/infra/ShowDesktop.tsx";
import { $settings } from "../shared/state/settings.ts";
import { $current_monitor } from "../shared/state/system.ts";
import { computed } from "@preact/signals";
import { $interactables, getWindowsForItem } from "../shared/state/windows.ts";
import { TrashBin } from "../item/infra/RecycleBin.tsx";
import { DND_PLUGINS, DND_SENSORS } from "libs/ui/dnd.ts";

const visibleItems = computed(() => {
  const { pinnedItemsVisibility, temporalItemsVisibility } = $settings.value;
  const monitor = $current_monitor.value;

  const showPinned = pinnedItemsVisibility === WegPinnedItemsVisibility.Always || monitor.isPrimary;
  const filterByMonitor = temporalItemsVisibility === WegTemporalItemsVisibility.OnMonitor;

  const windows = filterByMonitor
    ? $interactables.value.filter((w) => {
      return w.monitor === monitor.id;
    })
    : $interactables.value;

  return $dock_state.value.items.filter((item) => {
    if (item.type === "Folder") {
      return showPinned;
    }

    if (item.type !== "AppOrFile") {
      return showPinned;
    }

    if (item.pinned && showPinned) {
      return true;
    }

    return getWindowsForItem(item, windows).length > 0;
  });
});

// State for an in-flight "drag an item out of a folder" operation. When such a
// drag starts we pull the item onto the dock (so dnd-kit gives it the same live
// reorder preview as normal dock items); on drop we either keep it where it
// landed or, if it was released outside the dock, delete it.
let folderDragId: string | null = null;
let folderDragFromId: string | null = null;
let folderDragExtracted = false;
let folderDragLastPointer = { x: 0, y: 0 };
const onFolderDragPointerMove = (e: PointerEvent) => {
  folderDragLastPointer = { x: e.clientX, y: e.clientY };
  $folder_drag_over_dock.value = isInsideDock(e.clientX, e.clientY);
};

function isInsideDock(x: number, y: number) {
  const r = document.querySelector(".taskbar")?.getBoundingClientRect();
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * Resolves the folder id for a drop target. A folder exposes two overlapping
 * droppables: a dedicated "folder-drop" zone and its own sortable droppable
 * (whose id equals the folder item id). Either may win collision detection,
 * so we accept both as "drop into folder".
 */
function resolveFolderId(target: Droppable | null | undefined): string | undefined {
  if (!target) return undefined;
  if (target.type === "folder-drop") {
    return (target.data as { folderId?: string } | undefined)?.folderId;
  }
  const item = $dock_state.value.items.find((i) => i.id === String(target.id));
  return item?.type === WegItemType.Folder ? item.id : undefined;
}

export function DockItems() {
  const { t } = useTranslation();

  const isEmpty = visibleItems.value.filter((c) => c.type !== WegItemType.Separator).length === 0;

  return (
    <DragDropProvider
      plugins={DND_PLUGINS}
      sensors={DND_SENSORS}
      onDragStart={(event) => {
        const { source } = event.operation;
        const fromFolder = (source?.data as { fromFolder?: string } | undefined)?.fromFolder;
        if (source && fromFolder) {
          // Don't extract yet: while the cursor stays in the popover the item is
          // reordered among its folder siblings; it is only pulled onto the dock
          // once the cursor crosses into the dock (see onDragOver).
          folderDragId = String(source.id);
          folderDragFromId = fromFolder;
          folderDragExtracted = false;
          $folder_extracted_drag_id.value = null;
          $folder_drag_over_dock.value = true;
          $folder_dragging_from.value = fromFolder;
          document.addEventListener("pointermove", onFolderDragPointerMove);
        }
      }}
      onDragOver={(event) => {
        const { source, target } = event.operation;

        // Folder item still inside the popover (not handed off to the dock yet).
        if (folderDragId && folderDragId === String(source?.id) && !folderDragExtracted && folderDragFromId) {
          if (isInsideDock(folderDragLastPointer.x, folderDragLastPointer.y)) {
            // crossed into the dock -> extract onto the dock; dnd-kit keeps
            // dragging it (same id) with the dock's live preview from here.
            folderDragExtracted = true;
            $folder_extracted_drag_id.value = String(source!.id);
            $dock_state_actions.insertItemFromFolderAt(folderDragFromId, String(source!.id), folderDragFromId);
            return;
          }
          // reorder within the folder (vertical popover list)
          const fromId = folderDragFromId;
          $dock_state.value = {
            ...$dock_state.value,
            items: $dock_state.value.items.map((i) =>
              i.id === fromId && i.type === WegItemType.Folder ? { ...i, items: move(i.items, event) } : i
            ),
          };
          return;
        }

        // While dragging an app over a folder, don't reorder; let it nest on drop.
        if (source?.type === WegItemType.AppOrFile && resolveFolderId(target)) {
          return;
        }
        const newItems = move($dock_state.value.items, event);
        $dock_state.value = { ...$dock_state.value, items: newItems };
      }}
      onDragEnd={(event) => {
        const { source, target } = event.operation;

        const wasFolderDrag = folderDragId === String(source?.id);
        const extracted = folderDragExtracted;
        if (wasFolderDrag) {
          folderDragId = null;
          folderDragFromId = null;
          folderDragExtracted = false;
          $folder_extracted_drag_id.value = null;
          $folder_drag_over_dock.value = true;
          $folder_dragging_from.value = null;
          document.removeEventListener("pointermove", onFolderDragPointerMove);
        }

        if (source?.type !== WegItemType.AppOrFile) return;

        const folderId = resolveFolderId(target);
        if (folderId && folderId !== String(source.id)) {
          $dock_state_actions.moveItemToFolder(String(source.id), folderId);
          return;
        }

        // Extracted onto the dock then released outside it -> delete. If it never
        // left the popover (reorder only) the folder order is already updated.
        if (wasFolderDrag && extracted && !isInsideDock(folderDragLastPointer.x, folderDragLastPointer.y)) {
          $dock_state_actions.remove(String(source.id));
        } else if (wasFolderDrag && extracted && isInsideDock(folderDragLastPointer.x, folderDragLastPointer.y)) {
          // Kept on the dock: if the same app was already pinned there, drop the
          // older copy so the icon isn't pinned to the dock twice.
          $dock_state_actions.removeDuplicatesOf(String(source.id));
        }
      }}
    >
      <div className="weg-items">
        {isEmpty ? <span className="weg-empty-state-label">{t("weg.empty")}</span> : (
          visibleItems.value.map((item, index) => {
            return (
              <DraggableItem item={item} key={item.id} index={index}>
                {ItemByType(item, false)}
              </DraggableItem>
            );
          })
        )}
      </div>

      <DragOverlay>
        {(source) => {
          const item = visibleItems.value.find((c) => c.id === source.id);
          if (item) return ItemByType(item, true);
          // folder popover item being reordered inside its popover
          for (const it of $dock_state.value.items) {
            if (it.type === WegItemType.Folder) {
              const entry = it.items.find((e) => e.id === source.id);
              if (entry) {
                return <UserApplication item={{ type: WegItemType.AppOrFile, ...entry }} isOverlay />;
              }
            }
          }
          return null;
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}

function ItemByType(item: SwItem, isOverlay: boolean) {
  if (item.type === WegItemType.AppOrFile) {
    return <UserApplication key={item.id} item={item} isOverlay={isOverlay} />;
  }

  if (item.type === WegItemType.Folder) {
    return <FolderItem key={item.id} item={item} />;
  }

  if (item.type === WegItemType.StartMenu) {
    return <StartMenu key={item.id} item={item} />;
  }

  if (item.type === WegItemType.ShowDesktop) {
    return <ShowDesktopModule key={item.id} item={item} />;
  }

  if (item.type === WegItemType.Media) {
    return <MediaSession key={item.id} item={item} />;
  }

  if (item.type === WegItemType.Separator) {
    return <Separator key={item.id} item={item} />;
  }

  if (item.type === WegItemType.TrashBin) {
    return <TrashBin key={item.id} item={item} />;
  }

  return null;
}
