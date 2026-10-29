import ExpoModulesCore

public class PermissionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPermissions")
    Events("permissions")

    OnCreate { EngineCall.listen("permissions", self) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      PermissionsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  enum PermissionResult: String {
    case accept, deny, dismiss
  }

  static let calls = CallTable(domain: "permissions", handlers: [
    "resolve": { args, reply in
      let id = try args.text("id")
      let result = try args.choice("result", PermissionResult.self)
      PageEngines.owner(of: id).resolvePermission(id, result: result.rawValue, remember: try args.bool("remember"))
      reply.ok()
    },
    "resolveExternalApp": { args, reply in
      let id = try args.text("id")
      PageEngines.owner(of: id).resolveExternalApp(id, open: try args.bool("open"), remember: try args.bool("remember"))
      reply.ok()
    },
    "externalAppAllowances": { args, reply in PageEngines.externalAppAllowances(profile: args.profile) { reply.ok($0) } },
    "removeExternalAppAllowance": { args, reply in
      PageEngines.removeExternalAppAllowance(profile: args.profile, origin: try args.text("origin"), scheme: try args.text("scheme"))
      reply.ok()
    },
    "devExternalLaunches": { _, reply in reply.ok(ArdiaHost.testExternalLaunches()) },
  ])
}
