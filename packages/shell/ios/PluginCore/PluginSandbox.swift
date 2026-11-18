import Foundation

struct PluginSandbox {
  let home: String
  let appData: String
  let configFolder: String
  let pluginFolder: String
  let pluginData: String
  let program: String
  let network: Bool

  static let searchPath = ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/opt/homebrew/bin", "/usr/local/bin"]

  static let profile = """
    (version 1)
    (allow default)
    (deny appleevent-send)
    (deny file-read* file-write* (subpath (param "HOME")) (subpath (param "APP_DATA")) (subpath (param "CONFIG")))
    (deny file-write* (subpath "/"))
    (allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/dtracehelper") (subpath "/dev/fd"))
    (deny network-outbound (remote unix-socket (subpath (param "HOME"))) (remote unix-socket (subpath (param "APP_DATA"))))
    (allow file-read* (subpath (param "PLUGIN")) (literal (param "PROGRAM")) (subpath (param "INSTALL")))
    (allow file-read* file-write* (subpath (param "DATA")))
    (allow file-read-metadata (literal (param "HOME")))
    """

  static let offline = """

    (deny network-outbound (remote ip))
    (allow network-outbound (remote ip "localhost:*"))
    """

  enum Refusal: Error {
    case unsafe(String)
  }

  static func resolved(_ path: String) -> String? {
    guard let real = realpath(path, nil) else { return nil }
    defer { free(real) }
    return String(cString: real)
  }

  static func isInside(_ path: String, _ folder: String) -> Bool {
    path == folder || path.hasPrefix(folder.hasSuffix("/") ? folder : folder + "/")
  }

  static func overlaps(_ a: String, _ b: String) -> Bool { isInside(a, b) || isInside(b, a) }

  static func program(_ first: String, pluginFolder: String) -> String? {
    if first.hasPrefix("/") { return resolved(first) }
    if first.contains("/") {
      guard let real = resolved((pluginFolder as NSString).appendingPathComponent(first)), isInside(real, pluginFolder) else { return nil }
      return real
    }
    for dir in searchPath {
      let candidate = (dir as NSString).appendingPathComponent(first)
      if FileManager.default.isExecutableFile(atPath: candidate) { return resolved(candidate) }
    }
    return nil
  }

  private var protected: [String] { [home, appData, configFolder] }

  func installFolder() -> String {
    let parent = (program as NSString).deletingLastPathComponent
    let folder = (parent as NSString).lastPathComponent == "bin" ? (parent as NSString).deletingLastPathComponent : parent
    if folder == "/" || folder.split(separator: "/").count < 2 || protected.contains(where: { Self.overlaps($0, folder) }) { return program }
    return folder
  }

  func checked() throws {
    for path in [pluginFolder, pluginData, program] where path.isEmpty || path.contains("\0") {
      throw Refusal.unsafe("a path the sandbox can't name")
    }
    let pluginsRoot = (configFolder as NSString).appendingPathComponent("plugins")
    let inPluginsRoot = Self.isInside(pluginFolder, pluginsRoot) && pluginFolder != pluginsRoot
    if pluginFolder == "/" || [home, configFolder, appData].contains(where: { Self.isInside($0, pluginFolder) }) {
      throw Refusal.unsafe("its folder takes in Ardia's data, its settings or your home folder")
    }
    if (Self.isInside(pluginFolder, configFolder) || Self.isInside(pluginFolder, appData)) && !inPluginsRoot {
      throw Refusal.unsafe("its folder is in Ardia's data or config folder")
    }
    if !Self.isInside(program, pluginFolder) && (Self.isInside(program, appData) || Self.isInside(program, configFolder)) {
      throw Refusal.unsafe("its program is in Ardia's data or config folder")
    }
    guard Self.isInside(pluginData, appData), !Self.isInside(appData, pluginData) else { throw Refusal.unsafe("its data folder is in the wrong place") }
  }

  func arguments() throws -> [String] {
    try checked()
    let parameters = [
      "HOME": home, "APP_DATA": appData, "CONFIG": configFolder, "PLUGIN": pluginFolder, "DATA": pluginData, "PROGRAM": program,
      "INSTALL": installFolder(),
    ]
    return ["-p", Self.profile + (network ? "" : Self.offline)] + parameters.sorted { $0.key < $1.key }.flatMap { ["-D", "\($0.key)=\($0.value)"] }
  }
}
