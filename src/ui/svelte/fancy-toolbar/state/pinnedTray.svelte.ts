// Shared pinned-tray state for the toolbar: the live pinned list (kept in sync
// with the popup + the other monitor's toolbar) plus the reorder/persist action.
// Both PinnedTrayIcons (rendering) and Toolbar (drag reorder) read/write this.
import { invoke } from "@seelen-ui/lib";
import { emit, listen } from "@tauri-apps/api/event";
import {
  GET_PINNED_TRAY_ICONS_COMMAND,
  matchesPinnedTrayIcon,
  PINNED_TRAY_CHANGED_EVENT,
  type PinnedTrayIcon,
  SET_PINNED_TRAY_ICONS_COMMAND,
  stableKey,
} from "libs/ui/svelte/utils/pinnedTray.ts";
import { trayState } from "./systemTray.svelte.ts";

export const PINNED_TRAY_SORTABLE_PREFIX = "pinned-tray::";

export const pinnedTray = $state<{ icons: PinnedTrayIcon[] }>({ icons: [] });

(async () => {
  try {
    pinnedTray.icons = await (invoke as any)(GET_PINNED_TRAY_ICONS_COMMAND) as PinnedTrayIcon[];
  } catch {
    pinnedTray.icons = [];
  }
})();

// The popup (pin/unpin) and the other monitor's toolbar (reorder) emit this.
listen<PinnedTrayIcon[]>(PINNED_TRAY_CHANGED_EVENT, ({ payload }) => {
  pinnedTray.icons = payload ?? [];
});

export function pinnedSortableId(icon: PinnedTrayIcon) {
  return PINNED_TRAY_SORTABLE_PREFIX + icon.key;
}

// Only currently-running pinned icons are shown as sortables on the bar (an
// empty/collapsed slot for a non-running app would break @dnd-kit's grouping).
// Returns a STABLE array reference while the running set + order are unchanged,
// so the per-second tray-icon churn never re-renders the sortable list (which
// would disrupt an in-progress drag). A real change (drag reorder, app
// start/stop) produces a new reference.
// The backend occasionally emits a tray snapshot that momentarily omits an icon
// (icon-only updates), so a naive "matches right now" filter makes the running
// set flicker every second → the whole list re-renders (visible blink). Keep an
// icon in the set for a short grace period after it was last matched to smooth
// those single-frame gaps.
const RUNNING_GRACE_MS = 2500;
const _lastSeen = new Map<string, number>();
let _lastKeys = "";
let _lastList: PinnedTrayIcon[] = [];
export function runningPinnedIcons(): PinnedTrayIcon[] {
  const now = Date.now();
  for (const icon of pinnedTray.icons) {
    if (trayState.items.some((it) => matchesPinnedTrayIcon(it, icon))) {
      _lastSeen.set(icon.key, now);
    }
  }
  // Also dedup by stable identity so the same app pinned twice (e.g. once by
  // tooltip and once by guid) only shows once — the first pin wins its slot.
  const claimed = new Set<string>();
  const list = pinnedTray.icons.filter((icon) => {
    const seen = _lastSeen.get(icon.key);
    if (seen === undefined || now - seen >= RUNNING_GRACE_MS) return false;
    const sk = stableKey(icon.guid, icon.tooltip, icon.key);
    if (claimed.has(sk)) return false;
    claimed.add(sk);
    return true;
  });
  const keys = list.map((i) => i.key).join("|");
  if (keys === _lastKeys) return _lastList;
  _lastKeys = keys;
  _lastList = list;
  return list;
}

/** Move a pinned icon (by sortable id) to another's slot within the FULL pinned
 * array, preserving non-running icons' positions. Used by the drag reorder. */
export function reorderPinned(srcId: string, tgtId: string) {
  const arr = [...pinnedTray.icons];
  const from = arr.findIndex((i) => pinnedSortableId(i) === srcId);
  const to = arr.findIndex((i) => pinnedSortableId(i) === tgtId);
  if (from === -1 || to === -1 || from === to) return;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved!);
  pinnedTray.icons = arr;
}

/** Persist the current pinned order and notify the popup + other toolbar. */
export async function persistPinnedOrder() {
  const icons = pinnedTray.icons;
  await (invoke as any)(SET_PINNED_TRAY_ICONS_COMMAND, { pinnedIcons: icons });
  emit(PINNED_TRAY_CHANGED_EVENT, icons);
}

// Re-pin slot memory: unpinning removes an icon from the list and re-pinning
// (from the popup) appends it at the end. Remember each removed icon's slot so a
// re-pin drops it back where the user had it, instead of jumping to the end.
// Session-scoped (the persisted order already survives restarts).
let _prevKeys: string[] = [];
const _rememberedIndex = new Map<string, number>();

$effect.root(() => {
  $effect(() => {
    const keys = pinnedTray.icons.map((i) => i.key);
    // Remember the slot of icons that just disappeared (unpinned).
    for (let i = 0; i < _prevKeys.length; i++) {
      if (!keys.includes(_prevKeys[i]!)) _rememberedIndex.set(_prevKeys[i]!, i);
    }
    // Move any just-added icon back to its remembered slot.
    let changed = false;
    const arr = [...pinnedTray.icons];
    for (const key of keys) {
      if (_prevKeys.includes(key) || !_rememberedIndex.has(key)) continue;
      const to = Math.min(_rememberedIndex.get(key)!, arr.length - 1);
      _rememberedIndex.delete(key);
      const from = arr.findIndex((x) => x.key === key);
      if (from !== -1 && to !== -1 && from !== to) {
        const [m] = arr.splice(from, 1);
        arr.splice(to, 0, m!);
        changed = true;
      }
    }
    _prevKeys = arr.map((i) => i.key);
    if (changed) {
      pinnedTray.icons = arr;
      persistPinnedOrder();
    }
  });
});
