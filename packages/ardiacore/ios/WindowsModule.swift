import AppKit
import ExpoModulesCore

public class WindowsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaWindows")

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      WindowsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static let calls = CallTable(domain: "windows", handlers: [
    "list": { _, reply in reply.ok(ArdiaHost.chromeWindows) },
    "dev": { args, reply in
      let action = try args.text("action")
      guard let window = NSApp.window(withWindowNumber: try args.int("window")) else { return reply.ok("") }
      reply.ok(ArdiaChromeWindowHost.devAction(action, window: window) ?? "")
    },
  ])
}
