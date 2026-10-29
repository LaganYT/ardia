import AppKit
import ExpoModulesCore

enum ShellEvents {
  enum Channel: String {
    case command = "onCommand"
    case openURLs = "onOpenURLs"
    case window = "onWindowEvent"
    case app = "onAppEvent"
    case notificationResponse = "onNotificationResponse"
    case scriptCommand = "onScriptCommand"
  }

  private struct Sink {
    let owner: ObjectIdentifier
    let send: ([String: Any]) -> Void
  }

  private static var sinks: [Channel: Sink] = [:]

  static func attach(_ channel: Channel, to module: Module) {
    DispatchQueue.main.async { [weak module] in
      guard let module else { return }
      attach(channel, owner: ObjectIdentifier(module)) { [weak module] body in module?.sendEvent(channel.rawValue, body) }
    }
  }

  private static func attach(_ channel: Channel, owner: ObjectIdentifier, send: @escaping ([String: Any]) -> Void) {
    sinks[channel] = Sink(owner: owner, send: send)
    switch channel {
    case .openURLs: OpenURLInbox.flush()
    case .notificationResponse: NotificationHub.shared.flushPending()
    default: break
    }
  }

  static func detach(_ module: Module, then: @escaping (Set<Channel>) -> Void = { _ in }) {
    let owner = ObjectIdentifier(module)
    DispatchQueue.main.async {
      let owned = Set(sinks.filter { $0.value.owner == owner }.keys)
      for channel in owned { sinks[channel] = nil }
      then(owned)
    }
  }

  static func isAttached(_ channel: Channel) -> Bool { sinks[channel] != nil }

  @discardableResult
  static func send(_ channel: Channel, _ body: [String: Any]) -> Bool {
    guard let sink = sinks[channel] else { return false }
    sink.send(body)
    return true
  }
}
