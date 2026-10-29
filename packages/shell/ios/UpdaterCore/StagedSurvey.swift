import Foundation

enum StagedSurvey {
  struct Found: Equatable {
    let copy: ChannelSwitch.Copy
    let bundle: URL
    let channel: String?
  }

  static let sparkleInstallationPath = ["org.sparkle-project.Sparkle", "Installation"]

  static func root(caches: URL, bundleId: String) -> URL {
    ([bundleId] + sparkleInstallationPath).reduce(caches.resolvingSymlinksInPath().standardizedFileURL) {
      $0.appendingPathComponent($1, isDirectory: true)
    }
  }

  static func survey(caches: URL, bundleId: String) -> [Found]? {
    var folder = caches.resolvingSymlinksInPath().standardizedFileURL
    for name in [bundleId] + sparkleInstallationPath {
      folder.appendPathComponent(name, isDirectory: true)
      switch kind(folder.path) {
      case .directory: continue
      case .missing: return []
      case .other, .unreadable: return nil
      }
    }
    return copies(in: folder, bundleId: bundleId)
  }

  private enum Kind {
    case directory, missing, other, unreadable
  }

  private enum Inspection {
    case copy(Found), notOurs, gone, unreadable
  }

  private static func kind(_ path: String) -> Kind {
    var info = stat()
    guard lstat(path, &info) == 0 else { return errno == ENOENT || errno == ENOTDIR ? .missing : .unreadable }
    return (info.st_mode & S_IFMT) == S_IFDIR ? .directory : .other
  }

  private static func isMissing(_ error: Error) -> Bool {
    let error = error as NSError
    if error.domain == NSCocoaErrorDomain, [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return true }
    if error.domain == NSPOSIXErrorDomain, [Int(ENOENT), Int(ENOTDIR)].contains(error.code) { return true }
    return (error.userInfo[NSUnderlyingErrorKey] as? Error).map(isMissing) ?? false
  }

  private static func copies(in root: URL, bundleId: String) -> [Found]? {
    var failed = false
    guard let walk = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil, options: [.skipsPackageDescendants],
                                                     errorHandler: { _, error in
                                                       if !isMissing(error) { failed = true }
                                                       return true
                                                     })
    else { return nil }
    var found: [Found] = []
    for case let url as URL in walk {
      if walk.level > 4 {
        walk.skipDescendants()
        continue
      }
      guard url.pathExtension == "app" else { continue }
      switch kind(url.path) {
      case .directory: break
      case .missing, .other: continue
      case .unreadable: return nil
      }
      switch inspect(url, in: root, bundleId: bundleId) {
      case .copy(let copy): found.append(copy)
      case .notOurs, .gone: continue
      case .unreadable: return nil
      }
    }
    return failed ? nil : found
  }

  private static func inspect(_ app: URL, in root: URL, bundleId: String) -> Inspection {
    let data: Data
    do {
      data = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
    } catch {
      return isMissing(error) && kind(app.path) == .missing ? .gone : .unreadable
    }
    guard let info = (try? PropertyListSerialization.propertyList(from: data, format: nil)) as? [String: Any] else { return .unreadable }
    guard info["CFBundleIdentifier"] as? String == bundleId else { return .notOurs }
    guard let build = info["CFBundleVersion"] as? String, let folder = updateFolder(of: app, in: root) else { return .unreadable }
    var stats = stat()
    guard lstat(folder.path, &stats) == 0 else { return errno == ENOENT ? .gone : .unreadable }
    guard (stats.st_mode & S_IFMT) == S_IFDIR else { return .unreadable }
    let copy = ChannelSwitch.Copy(folder: folder.path, device: UInt64(stats.st_dev), inode: UInt64(stats.st_ino), build: build)
    return .copy(Found(copy: copy, bundle: app, channel: info["ACUpdateChannel"] as? String))
  }

  static func updateFolder(of bundle: URL, in root: URL) -> URL? {
    let base = root.standardizedFileURL.pathComponents
    let parts = bundle.standardizedFileURL.pathComponents
    guard parts.count > base.count + 1, Array(parts.prefix(base.count)) == base else { return nil }
    return URL(fileURLWithPath: NSString.path(withComponents: Array(parts.prefix(base.count + 1))), isDirectory: true)
  }
}
