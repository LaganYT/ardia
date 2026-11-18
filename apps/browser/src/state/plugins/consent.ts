import type { PluginManifest } from "../../lib/pluginManifest";
import { PLATFORM_TERMS } from "../../lib/platformTerms";

export type ConsentLine = { icon: string; text: string };

export function consentLines(m: PluginManifest): ConsentLine[] {
  const lines: ConsentLine[] = [];
  if (m.process) lines.push({ icon: "gearshape", text: `Runs a program in the background: ${m.process.run.join(" ")}` });
  if (m.permissions.includes("network")) lines.push({ icon: "network", text: "That program may connect to the internet" });
  else if (m.process) lines.push({ icon: "antenna.radiowaves.left.and.right.slash", text: `That program can't connect beyond this ${PLATFORM_TERMS.computer}` });
  if (m.permissions.includes("tabs")) lines.push({ icon: "square.on.square", text: m.permissions.includes("fullUrls") ? "Sees the full address and title of your tabs" : "Sees the address (without what follows ? or #) and title of your tabs" });
  if (m.hooks.length) lines.push({ icon: "bell", text: `Hears these events: ${m.hooks.join(", ")}` });
  if (m.permissions.includes("commands")) lines.push({ icon: "command", text: "Runs Ardia commands, like opening and closing tabs" });
  const defaults = Object.keys(m.settings.defaults);
  if (defaults.length) lines.push({ icon: "slider.horizontal.3", text: `Changes these settings while it's on: ${defaults.join(", ")}` });
  if (m.settings.rows.length) lines.push({ icon: "list.bullet", text: `Adds ${m.settings.rows.length === 1 ? "a setting" : `${m.settings.rows.length} settings`} to its page here` });
  if (m.page) lines.push({ icon: m.page.icon, text: `Adds a page you open as a tab: ${m.page.title} (ardia://${m.name})` });
  if (m.commands.some((c) => "open" in c.action && c.action.context)) lines.push({ icon: "rectangle.split.2x1", text: "Its page can be handed the tab you're on when you open it beside that tab" });
  if (m.commands.length) lines.push({ icon: "command", text: `Adds to the command bar: ${m.commands.map((c) => c.title).join(", ")}` });
  if (m.tools.length) lines.push({ icon: "wrench.and.screwdriver", text: `Offers tools to the ardia command and other plugins: ${m.tools.map((t) => t.title).join(", ")}` });
  return lines;
}
