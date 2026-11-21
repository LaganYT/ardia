import Darwin
import Foundation
import JavaScriptCore

final class HostGlobals {
  static let maxTimerMs = Double(Int32.max)
  static let maxRandomBytes = 65536

  private let context: JSContext
  private let queue: DispatchQueue
  private var channel: HostChannel?
  private var lineHandler: JSValue?
  private var timerHandler: JSValue?
  private var earlyLines: [String] = []

  init(context: JSContext, queue: DispatchQueue) {
    self.context = context
    self.queue = queue
  }

  func attach(_ channel: HostChannel) {
    self.channel = channel
  }

  func deliver(_ line: String) {
    guard let handler = lineHandler else {
      if earlyLines.count < 256 { earlyLines.append(line) }
      return
    }
    handler.call(withArguments: [line])
  }

  static func write(_ text: String) {
    FileHandle.standardError.write(Data((text.hasSuffix("\n") ? text : text + "\n").utf8))
  }

  func native() -> JSValue {
    let object = JSValue(newObjectIn: context)!
    let log: @convention(block) (String, String) -> Void = { level, text in
      let tag = level == "log" ? "" : "[\(level)] "
      Self.write(tag + text)
    }
    let onLine: @convention(block) (JSValue) -> Void = { [weak self] handler in
      guard let self else { return }
      self.lineHandler = handler
      let early = self.earlyLines
      self.earlyLines = []
      for line in early { handler.call(withArguments: [line]) }
    }
    let onTimer: @convention(block) (JSValue) -> Void = { [weak self] handler in self?.timerHandler = handler }
    let schedule: @convention(block) (Double, Double) -> Void = { [weak self] id, ms in
      guard let self else { return }
      let delay = ms.isFinite ? min(Self.maxTimerMs, max(0, ms)) : 0
      self.queue.asyncAfter(deadline: .now() + .milliseconds(Int(delay))) { [weak self] in
        self?.timerHandler?.call(withArguments: [id])
      }
    }
    let send: @convention(block) (String) -> Any = { [weak self] line in
      guard let channel = self?.channel else { return "the channel to Ardia is closed" }
      return channel.send(line)?.message ?? NSNull()
    }
    let btoa: @convention(block) (String) -> Any = { text in PluginBase64.encode(text) ?? NSNull() }
    let atob: @convention(block) (String) -> Any = { text in PluginBase64.decode(text) ?? NSNull() }
    let randomUUID: @convention(block) () -> String = { UUID().uuidString.lowercased() }
    let randomBytes: @convention(block) (Int) -> [UInt8] = { count in
      var bytes = [UInt8](repeating: 0, count: min(Self.maxRandomBytes, max(0, count)))
      if !bytes.isEmpty { arc4random_buf(&bytes, bytes.count) }
      return bytes
    }
    let parseURL: @convention(block) (String, JSValue) -> Any = { input, base in
      PluginURLParser.parse(input, base: base.isString ? base.toString() : nil) ?? NSNull()
    }
    let functions: [String: Any] = [
      "log": log, "onLine": onLine, "onTimer": onTimer, "schedule": schedule, "send": send, "btoa": btoa, "atob": atob, "randomUUID": randomUUID,
      "randomBytes": randomBytes, "parseURL": parseURL,
    ]
    for (name, function) in functions { object.setObject(function, forKeyedSubscript: name as NSString) }
    return object
  }
}
