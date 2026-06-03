import { listen } from "@tauri-apps/api/event";
import { invoke, SeelenCommand, SeelenEvent, subscribe } from "@seelen-ui/lib";
import type { SysTrayIcon, SysTrayIconId, ToolbarItem, ToolbarItem2 } from "@seelen-ui/lib/types";
import { useEffect, useState } from "preact/hooks";
import { baseItem } from "../shared/state/default.ts";
import { $toolbar_dragging, $toolbar_state } from "../shared/state/items.ts";

const PINNED_TRAY_CHANGED_EVENT = "seelen:pinned-tray-icons-changed";
const GET_PINNED_TRAY_ICONS_COMMAND = "get_pinned_tray_icons";
const SET_PINNED_TRAY_ICONS_COMMAND = "set_pinned_tray_icons";

type PinnedTrayIcon = {
  key: string;
  stableId: SysTrayIconId;
  tooltip: string;
  guid: string | null;
  uid: number | null;
};

function trayIdKey(id: SysTrayIconId) {
  return JSON.stringify(id);
}

function normalizePinnedTrayIcon(value: unknown): PinnedTrayIcon | null {
  if (typeof value === "string") {
    try {
      return {
        key: value,
        stableId: JSON.parse(value) as SysTrayIconId,
        tooltip: "",
        guid: null,
        uid: null,
      };
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && value !== null && "key" in value && "stableId" in value) {
    return value as PinnedTrayIcon;
  }

  return null;
}

async function getStoredPinnedTrayIcons(): Promise<PinnedTrayIcon[]> {
  try {
    // The backend file is the single source of truth (no localStorage fallback,
    // so clearing it actually clears the pins).
    return await invoke(GET_PINNED_TRAY_ICONS_COMMAND as any) as PinnedTrayIcon[];
  } catch {
    return [];
  }
}

function getItemName(item: SysTrayIcon) {
  return item.tooltip || item.guid || `${item.window_handle?.toString(16)}::${item.uid}`;
}

/**
 * Stable identity used for a pinned icon's toolbar item id.
 *
 * IMPORTANT: this must NOT depend on the tooltip, because many tray icons
 * (CPU/GPU temperature, battery, network, etc.) update their tooltip and icon
 * image every second. Deriving the id from the tooltip made the item id change
 * constantly, so the sync effect kept removing and re-inserting the item, which
 * is what caused the pinned icons to jump around.
 *
 * `guid` is stable across app/seelen restarts; the serialized `stable_id` is
 * stable for the lifetime of the window. We derive the id from the *stored*
 * pinned icon so it stays consistent even if the underlying window handle
 * changes (the live tray item is still matched via `matchesPinnedTrayIcon`).
 */
/**
 * A tooltip stripped of its volatile, numeric parts (temperatures, fan speeds,
 * percentages, etc.) so it stays the same across tray updates AND across
 * restarts. e.g. "Left: 57%" -> "Left: %", "CPU 0\nCore #0: 56°C" -> stable.
 */
function normalizeTooltip(tooltip: string): string {
  return tooltip.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Stable identity for a pinned tray icon, used for both the toolbar item id and
 * for matching the live tray icon. It must survive restarts, so it never uses
 * the window handle (which changes every boot) nor the raw tooltip (whose
 * numeric values change constantly):
 *   1. guid               — stable when present
 *   2. normalized tooltip — stable label for guid-less icons (sensors, etc.)
 *   3. serialized id       — last-resort fallback (e.g. no tooltip at all)
 */
function stableKey(guid: string | null, tooltip: string, fallback: string): string {
  if (guid) return `guid::${guid}`;
  const normalized = normalizeTooltip(tooltip);
  if (normalized) return `tip::${normalized}`;
  return `sid::${fallback}`;
}

function stableKeyFromPinnedIcon(pinnedIcon: PinnedTrayIcon): string {
  return stableKey(pinnedIcon.guid, pinnedIcon.tooltip, pinnedIcon.key);
}

function stableKeyFromTrayIcon(item: SysTrayIcon): string {
  return stableKey(item.guid, item.tooltip, trayIdKey(item.stable_id));
}

function toolbarIdFromStableKey(key: string): string {
  return `pinned-tray::${btoa(unescape(encodeURIComponent(key)))}`;
}

function toPinnedTrayIcon(item: SysTrayIcon): PinnedTrayIcon {
  return {
    key: trayIdKey(item.stable_id),
    stableId: item.stable_id,
    tooltip: item.tooltip,
    guid: item.guid,
    uid: item.uid,
  };
}

function matchesPinnedTrayIcon(item: SysTrayIcon, pinnedIcon: PinnedTrayIcon) {
  return stableKeyFromTrayIcon(item) === stableKeyFromPinnedIcon(pinnedIcon);
}

function hasIdentityData(pinnedIcon: PinnedTrayIcon) {
  return !!pinnedIcon.tooltip || !!pinnedIcon.guid || pinnedIcon.uid !== null;
}

async function setStoredPinnedTrayIcons(icons: PinnedTrayIcon[]) {
  await (invoke as any)(SET_PINNED_TRAY_ICONS_COMMAND, { pinnedIcons: icons });
}

function createToolbarItem(item: SysTrayIcon, id: string): ToolbarItem {
  const trayIconId = JSON.stringify(item.stable_id);
  const tooltip = JSON.stringify(getItemName(item));

  // The template is STATIC (just the tray id): the icon is resolved live from
  // the shared tray state by `TrayIcon`. This keeps the toolbar item unchanged
  // across icon updates — so it never churns/persists the toolbar state (which
  // made icons jump, especially while dragging) — while still updating live.
  return {
    ...baseItem,
    id,
    // `trayIconId` is already a JSON string; stringify again so it is embedded as
    // a string literal (TrayIcon expects the serialized id as a string).
    template: `return TrayIcon({ id: ${JSON.stringify(trayIconId)} });`,
    tooltip: `return ${tooltip};`,
    onClick: `invoke(SeelenCommand.SendSystemTrayIconAction, { id: ${trayIconId}, action: "LeftClick" });`,
    onDoubleClick: `invoke(SeelenCommand.SendSystemTrayIconAction, { id: ${trayIconId}, action: "LeftDoubleClick" });`,
    onContextMenu: `invoke(SeelenCommand.SendSystemTrayIconAction, { id: ${trayIconId}, action: "RightClick" });`,
    style: { flexShrink: 0 },
  } as ToolbarItem;
}

function isPinnedToolbarItem(item: unknown): item is ToolbarItem {
  return typeof item === "object" && item !== null && "id" in item &&
    typeof item.id === "string" && item.id.startsWith("pinned-tray::");
}

/**
 * Whether two pinned toolbar items render/behave the same. We compare the icon
 * template and every action (click / double-click / right-click) so an item
 * persisted by an older build — e.g. one without `onContextMenu` — gets
 * refreshed in place and regains its right-click handler (otherwise right-click
 * falls back to the toolbar's "remove module" menu instead of opening the tray
 * app's own menu). We still ignore tooltip-only changes so a live tooltip
 * doesn't trigger a state write every second.
 */
function pinnedItemsEqual(a: ToolbarItem, b: ToolbarItem) {
  return a.template === b.template &&
    a.onClick === b.onClick &&
    (a as any).onContextMenu === (b as any).onContextMenu &&
    (a as any).onDoubleClick === (b as any).onDoubleClick;
}

/**
 * Remembered order of pinned toolbar items (by id), so that unpinning then
 * re-pinning an icon drops it back where the user had drag-and-dropped it
 * instead of jumping to the system-tray anchor. It survives unpin (the id is
 * kept in its slot even while absent) and is refreshed from the live toolbar
 * order on every change, so drag-and-drop remains the only thing that reorders.
 */
let pinnedOrderMemory: string[] = [];

/**
 * Merge the live order of currently-present pinned ids into the remembered
 * order: present ids follow `present` (drag order is authoritative), while
 * remembered-but-absent ids (currently unpinned) keep their previous relative
 * slot so re-pinning can restore them.
 */
function mergeOrderMemory(memory: string[], present: string[]): string[] {
  const presentSet = new Set(present);
  const result = [...present];
  memory.forEach((id, idx) => {
    if (presentSet.has(id) || result.includes(id)) return;
    let insertAt = -1;
    for (let j = idx - 1; j >= 0 && insertAt === -1; j--) {
      const pos = result.indexOf(memory[j]!);
      if (pos !== -1) insertAt = pos + 1;
    }
    for (let j = idx + 1; j < memory.length && insertAt === -1; j++) {
      const pos = result.indexOf(memory[j]!);
      if (pos !== -1) insertAt = pos;
    }
    result.splice(insertAt === -1 ? result.length : insertAt, 0, id);
  });
  return result;
}

export function PinnedTrayIcons() {
  const [pinnedIcons, setPinnedIcons] = useState<PinnedTrayIcon[]>([]);
  const [trayItems, setTrayItems] = useState<SysTrayIcon[]>([]);
  // The stored pins load asynchronously. Until that first load resolves,
  // `pinnedIcons` is `[]` which means "unknown", NOT "no pins". Reconciling in
  // that window would treat every persisted pinned toolbar item as unpinned and
  // delete it, then re-append them in backend (pin) order once the data arrives
  // — destroying the user's saved order on every startup. Gate on this flag so
  // the reconcile only runs once we actually know the pins.
  const [pinnedLoaded, setPinnedLoaded] = useState(false);
  const dragging = $toolbar_dragging.value;
  // Subscribe to the toolbar order so we can keep the order memory in sync.
  const toolbarItemsForOrder = $toolbar_state.value.items;

  // Refresh the remembered pinned order from the live toolbar order whenever it
  // changes (drag-and-drop, pins added/removed). Skipped while dragging so the
  // memory captures the final order, not intermediate drag frames.
  useEffect(() => {
    if (dragging) {
      return;
    }
    const ids = toolbarItemsForOrder
      .filter(isPinnedToolbarItem)
      .map((it) => it.id);
    pinnedOrderMemory = mergeOrderMemory(pinnedOrderMemory, ids);
  }, [toolbarItemsForOrder, dragging]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];

    const refreshPinnedIcons = () => {
      getStoredPinnedTrayIcons().then((icons) => {
        if (!disposed) {
          setPinnedIcons(icons);
          setPinnedLoaded(true);
        }
      });
    };

    invoke(SeelenCommand.GetSystemTrayIcons).then((items) => {
      if (!disposed) {
        setTrayItems(items);
      }
    });

    refreshPinnedIcons();
    timeouts.push(
      setTimeout(refreshPinnedIcons, 1000),
      setTimeout(refreshPinnedIcons, 3000),
      setTimeout(refreshPinnedIcons, 6000),
    );

    subscribe(SeelenEvent.SystemTrayChanged, ({ payload }) => {
      setTrayItems(payload);
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<unknown[]>(PINNED_TRAY_CHANGED_EVENT, ({ payload }) => {
      setPinnedIcons(
        payload
          .map(normalizePinnedTrayIcon)
          .filter((entry): entry is PinnedTrayIcon => !!entry),
      );
      setPinnedLoaded(true);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      disposed = true;
      timeouts.forEach(clearTimeout);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  // Reconcile pinned icons with the toolbar items. Positions live in the
  // (persisted) toolbar items array, so they stay fixed across restarts and can
  // be reordered by the user via drag & drop. We only ever:
  //   - add a brand new pinned item (at the system tray position),
  //   - remove an item the user actually unpinned,
  //   - refresh an existing item's icon in place (without moving it).
  useEffect(() => {
    // Don't touch the toolbar items while the user is dragging — reconciling
    // here (e.g. on a live tray-icon update) would fight the drag reorder and
    // make icons jump around.
    if (dragging) {
      return;
    }

    // Wait for the first real load of the stored pins. Before it resolves,
    // `pinnedIcons` is `[]` (unknown) and reconciling would delete every
    // persisted pinned item and then re-append them in pin order — wiping out
    // the user's drag-and-drop order on every startup/restart.
    if (!pinnedLoaded) {
      return;
    }

    const toolbarItems = $toolbar_state.peek().items;

    const existingById = new Map<string, ToolbarItem>();
    for (const item of toolbarItems) {
      if (isPinnedToolbarItem(item)) {
        existingById.set(item.id, item);
      }
    }

    // Desired pinned items keyed by a stable id (regardless of visibility).
    // Each entry must be unique by BOTH its toolbar id and the live tray icon it
    // resolves to, so the same icon never shows up twice (e.g. when it was
    // pinned once by tooltip and once by guid, producing two ids for one icon).
    const desired = new Map<string, ToolbarItem>();
    const claimedTrayKeys = new Set<string>();
    for (const pinnedIcon of pinnedIcons) {
      const id = toolbarIdFromStableKey(stableKeyFromPinnedIcon(pinnedIcon));
      if (desired.has(id)) {
        continue; // same pinned id listed twice
      }
      const trayItem = trayItems.find((t) => matchesPinnedTrayIcon(t, pinnedIcon));
      if (trayItem) {
        const trayKey = stableKeyFromTrayIcon(trayItem);
        if (claimedTrayKeys.has(trayKey)) {
          continue; // another pin already represents this live icon
        }
        claimedTrayKeys.add(trayKey);
        desired.set(id, createToolbarItem(trayItem, id));
      } else if (existingById.has(id)) {
        // Keep the last known item so its slot/position survives a temporary
        // disappearance (overflow toggle, app briefly closing, etc.).
        desired.set(id, existingById.get(id)!);
      }
    }
    const desiredIds = new Set(desired.keys());

    let changed = false;
    const next: ToolbarItem2[] = [];
    const seenIds = new Set<string>();
    for (const item of toolbarItems) {
      if (!isPinnedToolbarItem(item)) {
        next.push(item);
        continue;
      }
      if (!desiredIds.has(item.id) || seenIds.has(item.id)) {
        changed = true; // unpinned by the user, or a duplicate of one already kept
        continue;
      }
      seenIds.add(item.id);
      const fresh = desired.get(item.id)!;
      if (!pinnedItemsEqual(fresh, item)) {
        changed = true; // icon/action changed → refresh in place (keep position)
        next.push(fresh);
      } else {
        next.push(item);
      }
    }

    // Place pinned items that aren't in the toolbar yet (freshly pinned, or
    // re-pinned after an unpin). Use the remembered order so a re-pinned icon
    // returns to the slot the user drag-dropped it to; brand-new icons (no
    // memory) fall back to the system tray anchor.
    const present = new Set(
      next.filter(isPinnedToolbarItem).map((it) => it.id),
    );
    const systemTrayIndex = () => {
      const i = next.findIndex((item) => item === "@seelen/tb-system-tray");
      return i === -1 ? next.length : i;
    };
    for (const [id, item] of desired) {
      if (present.has(id)) {
        continue;
      }
      changed = true;
      let insertAt = -1;
      const memIdx = pinnedOrderMemory.indexOf(id);
      if (memIdx !== -1) {
        // after the nearest preceding remembered id that's currently present
        for (let j = memIdx - 1; j >= 0 && insertAt === -1; j--) {
          const pos = next.findIndex((it) => isPinnedToolbarItem(it) && it.id === pinnedOrderMemory[j]);
          if (pos !== -1) insertAt = pos + 1;
        }
        // else before the nearest following remembered id that's present
        for (let j = memIdx + 1; j < pinnedOrderMemory.length && insertAt === -1; j++) {
          const pos = next.findIndex((it) => isPinnedToolbarItem(it) && it.id === pinnedOrderMemory[j]);
          if (pos !== -1) insertAt = pos;
        }
      }
      if (insertAt === -1) {
        insertAt = systemTrayIndex();
      }
      next.splice(insertAt, 0, item);
      present.add(id);
    }

    if (changed) {
      $toolbar_state.value = {
        ...$toolbar_state.peek(),
        items: next,
      };
    }
  }, [pinnedIcons, trayItems, dragging, pinnedLoaded]);

  // Enrich legacy pins (stored without identity data) once their tray item is
  // seen, so matching/ids stay stable afterwards.
  useEffect(() => {
    if (!pinnedIcons.length || !trayItems.length) {
      return;
    }

    let changed = false;
    const hydratedIcons = pinnedIcons.map((pinnedIcon) => {
      if (hasIdentityData(pinnedIcon)) {
        return pinnedIcon;
      }

      const item = trayItems.find((trayItem) => matchesPinnedTrayIcon(trayItem, pinnedIcon));
      if (!item) {
        return pinnedIcon;
      }

      changed = true;
      return toPinnedTrayIcon(item);
    });

    if (changed) {
      setPinnedIcons(hydratedIcons);
      setStoredPinnedTrayIcons(hydratedIcons).catch(console.error);
    }
  }, [pinnedIcons, trayItems]);

  return null;
}
