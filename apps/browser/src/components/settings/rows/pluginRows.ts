import type { SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const pluginRows = {
  plugins: [
    {
      section: "Plugins",
      rows: {
        plugins: {
          title: "Plugins",
          description: "Plugins add commands, panels, settings, helper programs and commands on your PATH. One you add stays off until you turn it on and see what it gets; the ones built into Ardia say so.",
          keywords: ["plugin", "add-on", "addon", "install plugin", "ardia plugins"],
        },
      },
    },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "plugins">;
