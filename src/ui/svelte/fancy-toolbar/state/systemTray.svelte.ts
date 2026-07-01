// The toolbar is a separate webview from the system-tray popup, so it needs its
// own live view of the tray icons to render the pinned ones on the bar.
import { invoke, SeelenCommand, SeelenEvent, subscribe } from "@seelen-ui/lib";
import type { SysTrayIcon } from "@seelen-ui/lib/types";

export const trayState = $state<{ items: SysTrayIcon[] }>({ items: [] });

invoke(SeelenCommand.GetSystemTrayIcons).then((items) => {
  trayState.items = items;
});

subscribe(SeelenEvent.SystemTrayChanged, (e) => {
  trayState.items = e.payload;
});
