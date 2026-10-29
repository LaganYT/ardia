import ExpoModulesCore

public class TabsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaTabs")
    Events("tabs")

    OnCreate {
      EngineCall.listen("tabs", self)
      ArdiaTabStrip.watchStrips()
    }

    Function("prepareTransfer") { (key: String) in
      for engine in PageEngines.all { engine.prepareTransfer(key) }
    }
    Function("releaseTransfer") { (key: String) in
      for engine in PageEngines.all { engine.releaseTransfer(key) }
    }
    Function("claimLaunchTab") { (key: String, url: String, profile: String) in
      ArdiaWebView.claimLaunchTab(key, url: url, profile: profile)
    }
    Function("revealTab") { (key: String) in ArdiaWebView.revealTab(key) }
    Function("dropTabReveals") { (key: String) in ArdiaWebView.dropTabReveals(key) }
    Function("revealOffered") { (adoptId: String, key: String) in ArdiaWebView.revealOffered(adoptId, over: key) }

    AsyncFunction("call") { (name: String, profile: String, args: String, promise: Promise) in
      TabsModule.calls.run(name, profile, args, promise)
    }.runOnQueue(.main)
  }

  static func browserId(_ args: CallArgs) throws -> Int32 { ArdiaWebView.browserId(ofTab: try args.text("tabId")) }

  static let calls = CallTable(domain: "tabs", handlers: [
    "routeLinkTabs": { args, reply in reply.ok(ArdiaWebView.routeLinkTabs(try args.strings("urls"))) },
    "stripCommand": { args, reply in
      ArdiaTabStrip.command(try args.int("id"), command: try args.dict("command"))
      reply.ok()
    },
    "strips": { _, reply in reply.ok(ArdiaTabStrip.allStrips) },
    "lastTabPolicy": EngineCall.passing("ac_tabs_last_tab_policy"),
    "devBrowserId": { args, reply in reply.ok(try browserId(args)) },
    "devEvents": { args, reply in reply.ok(ArdiaWebView.devEvents(browserId: try browserId(args))) },
    "devWindowNumber": { args, reply in reply.ok(ArdiaWebView.devWindowNumber(browserId: try browserId(args))) },
    "devFocusPage": { args, reply in reply.ok(ArdiaWebView.devFocusPage(browserId: try browserId(args))) },
    "devPictureInPicture": { _, reply in reply.ok(ArdiaWebView.devPictureInPicture()) },
    "devPictureInPictureAction": { args, reply in reply.ok(ArdiaWebView.devPictureInPictureAction(try args.text("action"))) },
    "devPostPeekMouseUp": { args, reply in reply.ok(ArdiaWebView.devPostPeekMouseUp(try args.text("keys"), over: try args.text("tabId"))) },
    "devScrollZoom": { args, reply in
      let steps = try args.dicts("steps")
      reply.ok(ArdiaWebView.devScrollZoom(steps, browserId: ArdiaWebView.browserId(ofTab: try args.optionalText("tabId"))))
    },
  ])
}
