import type { TabsRequest } from "../../platform/extensions";
import { openWindow } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";

export function openRequestedTab(request: TabsRequest) {
  if (request.action === "closeWindow") return closeChromeMadeWindow(request.chromeWindow);
  if (request.chromeWindow && request.tabId) return moveIntoChromeMadeWindow(request, request.chromeWindow, request.tabId);
  if (request.chromeWindow && request.adoptId) return openChromeMadeTab(request, request.chromeWindow, request.adoptId);
  if (!request.url) return;
  const s = useBrowser.getState();
  const ofProfile = (id: string) => !!s.windows[id] && !s.windows[id]!.incognito && engineProfile(s, s.windows[id]!.profileId) === request.profile;
  const windowId =
    (request.window && s.windows[request.window] ? request.window : undefined) ??
    s.ui.focusOrder.find(ofProfile) ??
    s.ui.focusOrder.find((id) => s.windows[id]);
  const background = request.active === false;
  const profileId = request.adoptId
    ? windowId && ofProfile(windowId) ? s.windows[windowId]!.profileId : s.profileOrder.find((p) => engineProfile(s, p) === request.profile)
    : undefined;
  if (request.adoptId && profileId) {
    if (windowId && ofProfile(windowId)) s.newTab(windowId, { url: request.url, adoptId: request.adoptId, profileId, background });
    else openWindow({ url: request.url, adoptId: request.adoptId, profileId });
    return;
  }
  if (windowId) s.newTab(windowId, { url: request.url, background });
  else openWindow({ url: request.url });
}

function openChromeMadeTab(request: TabsRequest, chromeWindow: string, adoptId: string) {
  const s = useBrowser.getState();
  const made = Object.values(s.windows).find((w) => w.chromeWindow === chromeWindow);
  if (made) return void s.newTab(made.id, { url: request.url, adoptId, profileId: made.profileId, background: request.active === false });
  const profileId = s.profileOrder.find((p) => engineProfile(s, p) === request.profile);
  if (!profileId) return void openWindow({ url: request.url, adoptId });
  openWindow({ url: request.url, adoptId, profileId, chromeWindow, background: request.focused === false });
}

function closeChromeMadeWindow(chromeWindow: string | undefined) {
  const s = useBrowser.getState();
  const made = chromeWindow ? Object.values(s.windows).find((w) => w.chromeWindow === chromeWindow) : undefined;
  if (made) s.closeWindow(made.id);
}

function moveIntoChromeMadeWindow(request: TabsRequest, chromeWindow: string, tabId: string) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  if (!tab) return;
  const made = Object.values(s.windows).find((w) => w.chromeWindow === chromeWindow);
  if (made) return void s.moveTabsToWindow([tabId], made.id);
  s.createWindow({ profileId: tab.profileId, tabIds: [tabId], chromeWindow, background: request.focused === false });
}
