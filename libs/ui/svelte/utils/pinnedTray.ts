// Shared helpers for the "pin system tray icon to the toolbar" fork feature.
// Used by BOTH the system-tray popup (where icons are pinned/unpinned) and the
// fancy-toolbar (where pinned icons are rendered on the bar). The stable-key
// logic MUST stay identical on both sides, hence this single source of truth.
import type { SysTrayIcon, SysTrayIconId } from "@seelen-ui/lib/types";

/** Global Tauri event emitted by the popup when the pinned set changes, so the
 * toolbar (a separate webview) can refresh without a poll. */
export const PINNED_TRAY_CHANGED_EVENT = "seelen:pinned-tray-icons-changed";
export const GET_PINNED_TRAY_ICONS_COMMAND = "get_pinned_tray_icons";
export const SET_PINNED_TRAY_ICONS_COMMAND = "set_pinned_tray_icons";

export type PinnedTrayIcon = {
  key: string;
  stableId: SysTrayIconId;
  tooltip: string;
  guid: string | null;
  uid: number | null;
};

export function trayIdKey(id: SysTrayIconId) {
  return JSON.stringify(id);
}

export function toPinnedTrayIcon(item: SysTrayIcon): PinnedTrayIcon {
  return {
    key: trayIdKey(item.stable_id),
    stableId: item.stable_id,
    tooltip: item.tooltip,
    guid: item.guid,
    uid: item.uid,
  };
}

// Sensor icons (CPU/GPU temp) have a tooltip whose numbers change every second
// and a HandleUid stable_id that changes across restarts; strip the volatile
// digits so the same icon keeps a stable identity.
function normalizeTooltip(tooltip: string) {
  return tooltip.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
}

/** Stable identity: guid, else a tooltip stripped of volatile numbers, else the
 * serialized id (last resort — not stable across restarts). */
export function stableKey(guid: string | null, tooltip: string, fallback: string) {
  if (guid) return `guid::${guid}`;
  const normalized = normalizeTooltip(tooltip);
  if (normalized) return `tip::${normalized}`;
  return `sid::${fallback}`;
}

export function matchesPinnedTrayIcon(item: SysTrayIcon, pinnedIcon: PinnedTrayIcon) {
  // Exact live id match first: the stable_id (guid or HandleUid) is stable for
  // the session, so this holds even while a sensor icon's tooltip momentarily
  // blanks out during its per-second updates (matching on the churning tooltip
  // alone would drop the icon for a frame → the whole list re-renders/blinks).
  if (trayIdKey(item.stable_id) === pinnedIcon.key) return true;
  // Fallback (survives restarts, when handles change): guid or normalized tooltip.
  return stableKey(item.guid, item.tooltip, trayIdKey(item.stable_id)) ===
    stableKey(pinnedIcon.guid, pinnedIcon.tooltip, pinnedIcon.key);
}
