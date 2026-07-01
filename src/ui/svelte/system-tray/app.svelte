<script lang="ts">
  import { SystrayIconAction, type SysTrayIcon, type SysTrayIconId } from "@seelen-ui/lib/types";
  import { state as trayState } from "./state.svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { emit } from "@tauri-apps/api/event";
  import { invoke, SeelenCommand, Widget } from "@seelen-ui/lib";
  import { Icon, MissingIcon } from "libs/ui/svelte/components/Icon";
  import {
    GET_PINNED_TRAY_ICONS_COMMAND,
    matchesPinnedTrayIcon,
    PINNED_TRAY_CHANGED_EVENT,
    type PinnedTrayIcon,
    SET_PINNED_TRAY_ICONS_COMMAND,
    toPinnedTrayIcon,
  } from "libs/ui/svelte/utils/pinnedTray.ts";

  let pinnedTrayIcons = $state<PinnedTrayIcon[]>([]);

  $effect(() => {
    Widget.getCurrent().ready();
  });

  getPinnedTrayIcons().then((icons) => {
    pinnedTrayIcons = icons;
  });

  function onClick(event: MouseEvent, id: SysTrayIconId) {
    // prevent be triggered by double click
    if (event.detail === 2) {
      return;
    }

    let action = SystrayIconAction.LeftClick;

    if (event.button === 1) {
      action = SystrayIconAction.MiddleClick;
    } else if (event.button === 2) {
      action = SystrayIconAction.RightClick;
    }

    invoke(SeelenCommand.SendSystemTrayIconAction, {
      id,
      action,
    });
  }

  function onDoubleClick(e: MouseEvent, id: SysTrayIconId) {
    e.preventDefault();
    e.stopPropagation();
    invoke(SeelenCommand.SendSystemTrayIconAction, {
      id,
      action: SystrayIconAction.LeftDoubleClick,
    });
  }

  function getItemName(item: SysTrayIcon) {
    return item.tooltip || item.guid || `${item.window_handle?.toString(16)}::${item.uid}`;
  }

  async function getPinnedTrayIcons() {
    // The backend file is the single source of truth (no localStorage fallback).
    try {
      return await (invoke as any)(GET_PINNED_TRAY_ICONS_COMMAND) as PinnedTrayIcon[];
    } catch {
      return [];
    }
  }

  async function setPinnedTrayIcons(icons: PinnedTrayIcon[]) {
    pinnedTrayIcons = icons;
    await (invoke as any)(SET_PINNED_TRAY_ICONS_COMMAND, { pinnedIcons: icons });
    emit(PINNED_TRAY_CHANGED_EVENT, icons);
  }

  function isPinned(item: SysTrayIcon) {
    return pinnedTrayIcons.some((pinnedIcon) => matchesPinnedTrayIcon(item, pinnedIcon));
  }

  async function onPinClick(event: Event, item: SysTrayIcon) {
    event.preventDefault();
    event.stopPropagation();

    const pinnedIcons = await getPinnedTrayIcons();
    const exists = pinnedIcons.some((pinnedIcon) => matchesPinnedTrayIcon(item, pinnedIcon));
    await setPinnedTrayIcons(
      exists
        ? pinnedIcons.filter((pinnedIcon) => !matchesPinnedTrayIcon(item, pinnedIcon))
        : [...pinnedIcons, toPinnedTrayIcon(item)],
    );
  }

  const GUIDS_TO_IGNORE = [
    "7820ae73-23e3-4229-82c1-e41cb67d5b9c", // speaker volument icon
    "7820ae74-23e3-4229-82c1-e41cb67d5b9c", // network icon
    "7820ae75-23e3-4229-82c1-e41cb67d5b9c", // battery icon
  ];
</script>

<div class={["slu-std-popover", "system-tray"]}>
  {#each trayState.trayItems as item}
    {#if item.is_visible && (!item.guid || !GUIDS_TO_IGNORE.includes(item.guid))}
      <button
        class="system-tray-item"
        data-skin="transparent"
        onclick={(e) => onClick(e, item.stable_id)}
        ondblclick={(e) => onDoubleClick(e, item.stable_id)}
        oncontextmenu={(e) => onClick(e, item.stable_id)}
        onmouseenter={() => {
          /* invoke(SeelenCommand.SendSystemTrayIconAction, {
            id: item.stable_id,
            action: SystrayIconAction.HoverEnter,
          }); */
        }}
        onmousemove={() => {
          /* invoke(SeelenCommand.SendSystemTrayIconAction, {
            id: item.stable_id,
            action: SystrayIconAction.HoverMove,
          }); */
        }}
        onmouseleave={() => {
          /* invoke(SeelenCommand.SendSystemTrayIconAction, {
            id: item.stable_id,
            action: SystrayIconAction.HoverLeave,
          }); */
        }}
      >
        <div class="system-tray-item-icon-box">
          {#if !!item.icon_path}
            <img
              class="system-tray-item-icon"
              src={convertFileSrc(item.icon_path) + `?hash=${item.icon_image_hash || "null"}`}
              alt=""
            />
          {:else}
            <MissingIcon class="system-tray-item-icon" />
          {/if}
        </div>
        <span class="system-tray-item-label">
          {getItemName(item)}
        </span>
        <span
          class={["system-tray-item-pin", { "system-tray-item-pin-active": isPinned(item) }]}
          role="button"
          tabindex="0"
          title={isPinned(item) ? "Unpin" : "Pin"}
          onclick={(e) => onPinClick(e, item)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              onPinClick(e, item);
            }
          }}
        >
          <Icon iconName={isPinned(item) ? "TbPinnedFilled" : "TbPin"} />
        </span>
      </button>
    {/if}
  {/each}
</div>
