import { useSortable } from "@dnd-kit/react/sortable";
import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";

import type { PropsWithChildren } from "preact/compat";

import type { SwItem } from "../shared/types.ts";
import { $settings, isHorizontalDock } from "../shared/state/settings.ts";
import { Alignment, SeelenWegSide } from "@seelen-ui/lib/types";
import { useTranslation } from "react-i18next";
import { $interactables, getWindowsForItem } from "../shared/state/windows.ts";
import { $folder_drag_over_dock, $folder_extracted_drag_id } from "../shared/state/items.ts";

interface Props extends PropsWithChildren {
  item: SwItem;
  index: number;
  ghost?: boolean;
}

export function DraggableItem({ children, item, index, ghost }: Props) {
  // An item being dragged out of a folder starts above/beside the dock, so it
  // must move freely to travel into the dock; normal dock items stay axis-locked.
  const isExtracting = $folder_extracted_drag_id.value === item.id;
  const sortable = useSortable({
    id: item.id,
    index,
    type: item.type,
    modifiers: isExtracting ? [] : [isHorizontalDock.value ? RestrictToHorizontalAxis : RestrictToVerticalAxis],
  });

  const { t } = useTranslation();

  let tooltip = undefined;

  switch (item.type) {
    case "AppOrFile": {
      const windows = getWindowsForItem(item, $interactables.value);
      if (windows.length === 0) {
        tooltip = item.displayName;
      }
      break;
    }
    case "Media":
      tooltip = t("media.label");
      break;
    case "StartMenu":
      tooltip = t("start.label");
      break;
    case "ShowDesktop":
      tooltip = t("show_desktop.label");
      break;
    case "TrashBin":
      tooltip = t("trash_bin.label");
      break;
  }

  let tooltipAlingX = Alignment.Center;
  let tooltipAlingY = Alignment.Center;
  switch ($settings.value.position) {
    case SeelenWegSide.Bottom:
      tooltipAlingY = Alignment.End;
      break;
    case SeelenWegSide.Top:
      tooltipAlingY = Alignment.Start;
      break;
    case SeelenWegSide.Left:
      tooltipAlingX = Alignment.Start;
      break;
    case SeelenWegSide.Right:
      tooltipAlingX = Alignment.End;
      break;
  }

  // While an extracted folder item is dragged outside the dock, collapse its
  // slot so no ghost is left behind (kept in the DOM so dnd-kit keeps dragging).
  const collapsed = isExtracting && !$folder_drag_over_dock.value;

  return (
    <div
      ref={sortable.ref}
      style={collapsed
        ? { width: 0, height: 0, padding: 0, margin: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }
        : { opacity: sortable.isDragging || ghost ? 0.3 : 1 }}
      data-dragging={sortable.isDragging}
      data-item-id={item.id}
      className="weg-item-drag-container"
      // this was added here to avoid need to pass it to all the items types,
      // this avoid the double context menu of dock menu and dock items.
      onContextMenu={item.type === "Separator" ? undefined : (e) => e.stopPropagation()}
      data-tooltip={tooltip}
      data-tooltip-align-x={tooltipAlingX}
      data-tooltip-align-y={tooltipAlingY}
    >
      {children}
    </div>
  );
}
