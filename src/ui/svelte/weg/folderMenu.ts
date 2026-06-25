import { invoke, SeelenCommand, Widget } from "@seelen-ui/lib";
import type { ContextMenu, ContextMenuItem } from "@seelen-ui/lib/types";
import type { FolderWegItem } from "./types.ts";
import { dockStateActions } from "./state/items.svelte.ts";

const folderIdentifier = crypto.randomUUID();
const colorSubmenuIdentifier = crypto.randomUUID();
const onFolderMenuClick = "weg::folder_menu_click";
const onFolderItemMenuClick = "weg::folder_item_menu_click";

let pendingFolderId: string | null = null;
let pendingFolderItemRemove: { folderId: string; entryId: string } | null = null;

const PRESET_COLORS: Array<{ label: string; value: string | null; iconColor: string }> = [
  { label: "Default", value: null, iconColor: "var(--system-accent-color)" },
  { label: "Blue", value: "#4a9eff", iconColor: "#4a9eff" },
  { label: "Green", value: "#4caf50", iconColor: "#4caf50" },
  { label: "Orange", value: "#ff9800", iconColor: "#ff9800" },
  { label: "Purple", value: "#9c27b0", iconColor: "#9c27b0" },
  { label: "Red", value: "#f44336", iconColor: "#f44336" },
  { label: "Pink", value: "#e91e8c", iconColor: "#e91e8c" },
  { label: "Yellow", value: "#ffeb3b", iconColor: "#ffeb3b" },
];

const onSeparatorMenuClick = "weg::separator_menu_click";

Widget.self.webview.listen(onFolderMenuClick, ({ payload }) => {
  const { key } = payload as { key: string };
  const id = pendingFolderId;
  pendingFolderId = null;
  if (!id) return;
  if (key === "delete_folder") {
    dockStateActions.deleteFolder(id);
  } else if (key.startsWith("color::")) {
    dockStateActions.changeFolderColor(id, key.slice(7) || null);
  }
});

Widget.self.webview.listen(onSeparatorMenuClick, ({ payload }) => {
  const { key } = payload as { key: string };
  if (key === "create_group") {
    dockStateActions.createFolder();
  }
});

/** Context menu for a dock separator: lets the user create a new group. */
export function getSeparatorContextMenu(t: (key: string) => string): ContextMenu {
  return {
    identifier: folderIdentifier,
    items: [
      {
        type: "Item",
        key: "create_group",
        icon: "MdCreateNewFolder",
        label: t("separator.create_group"),
        callbackEvent: onSeparatorMenuClick,
      },
    ],
  };
}

Widget.self.webview.listen(onFolderItemMenuClick, ({ payload }) => {
  const { key } = payload as { key: string };
  const target = pendingFolderItemRemove;
  pendingFolderItemRemove = null;
  if (!target) return;
  if (key === "remove_from_folder") {
    dockStateActions.deleteItemFromFolder(target.folderId, target.entryId);
  }
});

/** Context menu for the folder icon itself (change color, delete group). */
export function getFolderContextMenu(t: (key: string) => string, item: FolderWegItem): ContextMenu {
  pendingFolderId = item.id;
  return {
    identifier: folderIdentifier,
    items: [
      {
        type: "Submenu",
        identifier: colorSubmenuIdentifier,
        icon: "IoColorPaletteOutline",
        label: t("folder_item.change_color"),
        items: PRESET_COLORS.map(({ label, value, iconColor }) => ({
          type: "Item" as const,
          key: `color::${value ?? ""}`,
          icon: "BsFolderFill",
          iconColor,
          label,
          callbackEvent: onFolderMenuClick,
        })),
      },
      { type: "Separator" },
      {
        type: "Item",
        key: "delete_folder",
        icon: "RiDeleteBin6Line",
        label: t("folder_item.delete_group"),
        callbackEvent: onFolderMenuClick,
      },
    ],
  };
}

/** Context menu for an entry inside the folder popover ("Remove from group"). */
export function getFolderEntryContextMenu(
  t: (key: string) => string,
  folderId: string,
  entryId: string,
): ContextMenu {
  pendingFolderItemRemove = { folderId, entryId };
  const items: ContextMenuItem[] = [
    {
      type: "Item",
      key: "remove_from_folder",
      icon: "IoRemoveCircleOutline",
      label: t("folder_item.remove_from_group"),
      callbackEvent: onFolderItemMenuClick,
    },
  ];
  return { identifier: folderIdentifier, items };
}

export { invoke, SeelenCommand };
