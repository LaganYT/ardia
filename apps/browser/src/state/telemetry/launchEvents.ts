import { useBrowser } from "../browser/store";
import { capture, type startClient } from "./usageClient";
import { contextProperties, hardwareProperties, launchGuardProperties } from "./diagnostics";
import { topAppsSharingAtLaunch } from "./topAppsSharing";
import { appInfo } from "./transport";

const rebootedSince = (lastLaunchAt: number | null) => {
  const boot = appInfo().bootTime;
  return lastLaunchAt != null && boot != null ? boot > lastLaunchAt : null;
};

export async function launchEvents(session: ReturnType<typeof startClient>) {
  const topApps = topAppsSharingAtLaunch(useBrowser.getState(), session.updatedFrom);
  const hardware = await hardwareProperties();
  const previous = session.previous === "unclean" ? { ...contextProperties(session.context, "prev_", Date.now()), rebooted_since: rebootedSince(session.lastLaunchAt) } : {};
  capture("app_launched", { previous_session: session.previous, ...hardware, ...previous, ...launchGuardProperties() });
  if (session.updatedFrom) capture("app_updated", { from_version: session.updatedFrom });
  capture("top_apps_sharing", topApps);
}
