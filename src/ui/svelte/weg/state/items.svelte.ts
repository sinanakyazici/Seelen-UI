import { invoke, SeelenCommand, SeelenEvent, subscribe } from "@seelen-ui/lib";
import { type PluginId, type WegItem, type WegItems, WegItemType } from "@seelen-ui/lib/types";
import { debounce } from "lodash";
import { emit, listen } from "@tauri-apps/api/event";
import type { AppOrFileWegItem, SeparatorWegItem } from "../types.ts";
import { getWindowsForItem, interactables } from "./windows.svelte.ts";
import { wegItems } from "./getters.svelte.ts";

interface OptimisticDockState {
  isReorderDisabled: boolean;
  items: WegItem[];
}

interface SyncPayload {
  source: string;
  state: OptimisticDockState;
}

const CLIENT_ID = crypto.randomUUID();

export const HARDCODED_SEPARATOR_LEFT: SeparatorWegItem = {
  id: "hardcoded-separator-1",
  type: WegItemType.Separator,
};

export const HARDCODED_SEPARATOR_RIGHT: SeparatorWegItem = {
  id: "hardcoded-separator-2",
  type: WegItemType.Separator,
};

function getStateFromStored(state: WegItems): OptimisticDockState {
  return {
    isReorderDisabled: state.isReorderDisabled,
    items: [
      ...state.left,
      HARDCODED_SEPARATOR_LEFT,
      ...state.center,
      HARDCODED_SEPARATOR_RIGHT,
      ...state.right,
    ],
  };
}

let _dockState = $state(getStateFromStored(wegItems.value));

export const dockState = {
  get isReorderDisabled() {
    return _dockState.isReorderDisabled;
  },
  get items() {
    return _dockState.items;
  },
  get state() {
    return _dockState;
  },
  set state(value: OptimisticDockState) {
    _dockState = value;
  },
  set items(value: WegItem[]) {
    _dockState = { ..._dockState, items: value };
  },
};

subscribe(SeelenEvent.WegAddItem, (e) => {
  const item: WegItem = {
    ...e.payload,
    id: crypto.randomUUID(),
    type: WegItemType.AppOrFile,
  };

  const items = [..._dockState.items];
  const separatorIdx = items.findIndex((i) => i.id === HARDCODED_SEPARATOR_RIGHT.id);
  items.splice(separatorIdx, 0, item);
  _dockState = { ..._dockState, items };
});

let isRemoteUpdate = false;
listen<SyncPayload>("hidden::sync-dock-items", ({ payload }) => {
  if (payload.source === CLIENT_ID) return;
  if (JSON.stringify(payload.state) !== JSON.stringify(_dockState)) {
    isRemoteUpdate = true;
    _dockState = payload.state;
  }
});

const emitSyncEvent = debounce((state: OptimisticDockState) => {
  emit<SyncPayload>("hidden::sync-dock-items", { source: CLIENT_ID, state });
}, 300);

const saveDockState = debounce(async (state: OptimisticDockState) => {
  console.trace("Saving dock state");

  const index1 = state.items.findIndex((i) => i.id === HARDCODED_SEPARATOR_LEFT.id);
  const index2 = state.items.findIndex((i) => i.id === HARDCODED_SEPARATOR_RIGHT.id);

  await invoke(SeelenCommand.StateWriteWegItems, {
    items: {
      isReorderDisabled: state.isReorderDisabled,
      left: state.items.slice(0, index1),
      center: state.items.slice(index1 + 1, index2),
      right: state.items.slice(index2 + 1),
    },
  });
}, 1000);

let mounted = false;
$effect.root(() => {
  $effect(() => {
    const state = _dockState;

    if (!mounted) {
      mounted = true;
      return;
    }

    if (isRemoteUpdate) {
      isRemoteUpdate = false;
      return;
    }

    emitSyncEvent(state);
    saveDockState(state);
  });
});

export const dockStateActions = {
  remove(idToRemove: string) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.filter((item) => item.id !== idToRemove),
    };
  },
  pinApp(id: string) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.map((item) => (item.id === id ? { ...item, pinned: true } : item)),
    };
  },
  unpinApp(id: string) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.map((item) => (item.id === id ? { ...item, pinned: false } : item)),
    };
  },
  addMediaModule() {
    if (!_dockState.items.some((i) => i.type === WegItemType.Media)) {
      _dockState = {
        ..._dockState,
        items: [..._dockState.items, { id: crypto.randomUUID(), type: WegItemType.Media }],
      };
    }
  },
  addStartModule() {
    if (!_dockState.items.some((i) => i.type === WegItemType.StartMenu)) {
      _dockState = {
        ..._dockState,
        items: [{ id: crypto.randomUUID(), type: WegItemType.StartMenu }, ..._dockState.items],
      };
    }
  },
  addDesktopModule() {
    if (!_dockState.items.some((i) => i.type === WegItemType.ShowDesktop)) {
      _dockState = {
        ..._dockState,
        items: [{ id: crypto.randomUUID(), type: WegItemType.ShowDesktop }, ..._dockState.items],
      };
    }
  },
  addTrashBinModule() {
    if (!_dockState.items.some((i) => i.type === WegItemType.TrashBin)) {
      _dockState = {
        ..._dockState,
        items: [..._dockState.items, { id: crypto.randomUUID(), type: WegItemType.TrashBin }],
      };
    }
  },
  // ---- Folder (group) actions — fork feature, re-ported to the Svelte weg ----
  createFolder() {
    const folder = {
      id: crypto.randomUUID(),
      type: WegItemType.Folder,
      displayName: "Group",
      color: null,
      items: [],
    } as unknown as WegItem;
    const items = [..._dockState.items];
    const sepIdx = items.findIndex((i) => i.id === HARDCODED_SEPARATOR_RIGHT.id);
    items.splice(sepIdx === -1 ? items.length : sepIdx, 0, folder);
    _dockState = { ..._dockState, items };
  },
  deleteFolder(id: string) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.filter((i) => i.id !== id),
    };
  },
  changeFolderColor(id: string, color: string | null) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.map((i) => i.id === id && i.type === WegItemType.Folder ? { ...i, color } : i),
    };
  },
  /** Move a dock app item into a folder. Deduped by app identity so the same
   * app can't be added to the same group twice. */
  moveItemToFolder(itemId: string, folderId: string) {
    const items = _dockState.items;
    const moving = items.find((i) => i.id === itemId && i.type === WegItemType.AppOrFile);
    if (!moving || itemId === folderId) return;
    const { type: _t, ...data } = moving as Extract<WegItem, { type: "AppOrFile" }>;
    const movingKey = appIdentity(data);
    _dockState = {
      ..._dockState,
      items: items
        .filter((i) => i.id !== itemId)
        .map((i) => {
          if (i.id === folderId && i.type === WegItemType.Folder) {
            if (i.items.some((it) => appIdentity(it) === movingKey)) return i;
            return { ...i, items: [...i.items, data] };
          }
          return i;
        }),
    };
  },
  /** Remove an entry from a folder, discarding it (not restored to the dock). */
  deleteItemFromFolder(folderId: string, entryId: string) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.map((i) =>
        i.id === folderId && i.type === WegItemType.Folder
          ? { ...i, items: i.items.filter((it) => it.id !== entryId) }
          : i
      ),
    };
  },
  /** Extract an entry out of a folder back onto the dock, before `beforeItemId`
   * (or just before the right separator when null). */
  insertItemFromFolderAt(folderId: string, entryId: string, beforeItemId: string | null) {
    const items = [..._dockState.items];
    const folder = items.find(
      (i): i is Extract<WegItem, { type: "Folder" }> => i.id === folderId && i.type === WegItemType.Folder,
    );
    if (!folder) return;
    const data = folder.items.find((it) => it.id === entryId);
    if (!data) return;
    const next = items.map((i) =>
      i.id === folderId && i.type === WegItemType.Folder
        ? { ...i, items: i.items.filter((it) => it.id !== entryId) }
        : i
    );
    const restored = { type: WegItemType.AppOrFile, ...data } as unknown as WegItem;
    const beforeIdx = beforeItemId ? next.findIndex((i) => i.id === beforeItemId) : -1;
    if (beforeIdx === -1) {
      const sepIdx = next.findIndex((i) => i.id === HARDCODED_SEPARATOR_RIGHT.id);
      next.splice(sepIdx === -1 ? next.length : sepIdx, 0, restored);
    } else {
      next.splice(beforeIdx, 0, restored);
    }
    _dockState = { ..._dockState, items: next };
  },
  addPlugin(plugin: PluginId) {
    if (!_dockState.items.some((i) => i.type === WegItemType.Plugin && i.plugin === plugin)) {
      _dockState = {
        ..._dockState,
        items: [
          ..._dockState.items,
          { id: crypto.randomUUID(), type: WegItemType.Plugin, plugin },
        ],
      };
    }
  },
  removePlugin(plugin: PluginId) {
    _dockState = {
      ..._dockState,
      items: _dockState.items.filter(
        (i) => !(i.type === WegItemType.Plugin && i.plugin === plugin),
      ),
    };
  },
};

/** Stable identity for an app/file entry (same app across pinned instances):
 * umid, else relaunch command, else path. Used to dedup folder contents. */
function appIdentity(
  item: { umid?: string | null; path?: string | null; relaunch?: { command?: string | null } | null },
) {
  return (item.umid || item.relaunch?.command || item.path || "").toLowerCase();
}

$effect.root(() => {
  $effect(() => {
    const windows = interactables.value;
    const state = _dockState;

    const appOrFileItems = state.items.filter(
      (item): item is AppOrFileWegItem => item.type === WegItemType.AppOrFile,
    );

    const itemsToRemove = new Set(
      appOrFileItems
        .filter((item) => !item.pinned && getWindowsForItem(item, windows).length === 0)
        .map((item) => item.id),
    );

    const remainingItems = appOrFileItems.filter((item) => !itemsToRemove.has(item.id));

    // Apps nested inside folders also "cover" their windows, so launching one
    // from the folder popover must NOT spawn a duplicate temporal item on the
    // dock (the folder already represents it).
    const folderEntries = state.items
      .filter((i): i is Extract<WegItem, { type: "Folder" }> => i.type === WegItemType.Folder)
      .flatMap((f) => f.items.map((e) => ({ type: WegItemType.AppOrFile, ...e } as AppOrFileWegItem)));
    const coveringItems = [...remainingItems, ...folderEntries];

    const uncoveredWindows = windows.filter(
      (w) => !coveringItems.some((item) => getWindowsForItem(item, [w]).length > 0),
    );

    const seen = new Set<string>();
    const newItems: AppOrFileWegItem[] = [];

    for (const w of uncoveredWindows) {
      const key = w.umid ?? w.process.path?.toString();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);

      newItems.push({
        id: crypto.randomUUID(),
        type: WegItemType.AppOrFile,
        displayName: w.appName,
        umid: w.umid ?? null,
        path: w.process.path?.toString() ?? "",
        pinned: false,
        preventPinning: w.preventPinning,
        relaunch: w.relaunch ?? null,
      });
    }

    if (itemsToRemove.size === 0 && newItems.length === 0) return;

    const filteredItems = state.items.filter((item) => !itemsToRemove.has(item.id));
    const separatorRightIdx = filteredItems.findIndex((i) => i.id === HARDCODED_SEPARATOR_RIGHT.id);
    _dockState = {
      ...state,
      items: [
        ...filteredItems.slice(0, separatorRightIdx),
        ...newItems,
        ...filteredItems.slice(separatorRightIdx),
      ],
    };
  });
});
