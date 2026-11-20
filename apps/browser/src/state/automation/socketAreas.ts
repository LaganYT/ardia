import { AIR_TRAFFIC_METHODS } from "./socketAirTraffic";
import { registerSocketMethods } from "./socketCatalog";
import { DOWNLOAD_METHODS } from "./socketDownloads";
import { FAVICON_METHODS } from "./socketFavicons";
import { HISTORY_METHODS } from "./socketHistory";
import { LIBRARY_METHODS } from "./socketLibrary";
import { LIVE_METHODS } from "./socketLive";
import { MISC_METHODS } from "./socketMisc";
import { PIN_METHODS } from "./socketPins";
import { PRESET_METHODS } from "./socketPresets";
import { SHARED_FOLDER_METHODS } from "./socketSharedFolders";
import { SITE_METHODS } from "./socketSites";
import { SETTINGS_METHODS } from "./socketSettings";
import { PROFILE_METHODS } from "./socketProfiles";
import { SPLIT_METHODS } from "./socketSplits";
import { TAB_METHODS } from "./socketTabs";
import { WINDOW_METHODS } from "./socketWindows";

let registered = false;

export function registerSocketAreas() {
  if (registered) return;
  registered = true;
  registerSocketMethods([...TAB_METHODS, ...WINDOW_METHODS, ...PROFILE_METHODS, ...SPLIT_METHODS, ...LIBRARY_METHODS, ...HISTORY_METHODS, ...DOWNLOAD_METHODS, ...SETTINGS_METHODS, ...SITE_METHODS, ...MISC_METHODS, ...PIN_METHODS, ...FAVICON_METHODS, ...SHARED_FOLDER_METHODS, ...LIVE_METHODS, ...PRESET_METHODS, ...AIR_TRAFFIC_METHODS]);
}
