import type { SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const pluginRows = {
  plugins: [
    {
      section: "Plugins",
      rows: {
        plugins: {
          title: "Plugins",
          description: "Plugins add commands, panels, settings and helper programs. Each one stays off until you turn it on and see what it gets.",
          keywords: ["plugin", "add-on", "addon", "install plugin", "ardia plugins"],
        },
      },
    },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "plugins">;
