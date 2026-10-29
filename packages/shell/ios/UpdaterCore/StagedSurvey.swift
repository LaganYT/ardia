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

  enum Discard: Equatable {
    case gone
    case refused(String)
    case failed(Int32)
    case stranded(String)
  }

  struct FileID: Hashable {
    let device: UInt64
    let inode: UInt64
  }

  struct Cleanup: Equatable {
    var removed: [String] = []
    var kept: [String] = []
  }

  static let discardedFolder = "ArdiaDiscardedUpdates"

  static func discarded(caches: URL, bundleId: String) -> URL {
    caches.resolvingSymlinksInPath().standardizedFileURL.appendingPathComponent(bundleId, isDirectory: true)
      .appendingPathComponent(discardedFolder, isDirectory: true)
  }

  static func ancestors(of item: URL) -> Set<FileID> {
    var found: Set<FileID> = []
    var components = item.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    while !components.isEmpty {
      var info = stat()
      if lstat(NSString.path(withComponents: components), &info) == 0 {
        found.insert(FileID(device: UInt64(info.st_dev), inode: UInt64(info.st_ino)))
      }
      components.removeLast()
    }
    return found
  }

  private final class Directory {
    let descriptor: Int32
    let id: FileID

    init?(descriptor: Int32) {
      guard descriptor >= 0 else { return nil }
      var info = stat()
      guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR else {
        close(descriptor)
        return nil
      }
      self.descriptor = descriptor
      id = FileID(device: UInt64(info.st_dev), inode: UInt64(info.st_ino))
    }

    deinit { close(descriptor) }

    static func trusted(_ url: URL) -> Directory? {
      Directory(descriptor: open(url.path, O_RDONLY | O_DIRECTORY | O_NONBLOCK | O_CLOEXEC))
    }

    static func isName(_ name: String) -> Bool {
      !name.isEmpty && name != "." && name != ".." && !name.contains("/")
    }

    func child(_ name: String) -> Directory? {
      guard Self.isName(name) else { return nil }
      return Directory(descriptor: openat(descriptor, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC))
    }

    func entry(_ name: String) -> (id: FileID, directory: Bool)? {
      var info = stat()
      guard Self.isName(name), fstatat(descriptor, name, &info, AT_SYMLINK_NOFOLLOW) == 0 else { return nil }
      return (FileID(device: UInt64(info.st_dev), inode: UInt64(info.st_ino)), (info.st_mode & S_IFMT) == S_IFDIR)
    }

    func names() -> [String]? {
      let copy = dup(descriptor)
      guard copy >= 0 else { return nil }
      guard let stream = fdopendir(copy) else {
        close(copy)
        return nil
      }
      defer { closedir(stream) }
      var names: [String] = []
      while let item = readdir(stream) {
        let length = Int(item.pointee.d_namlen)
        let name = withUnsafeBytes(of: item.pointee.d_name) { String(decoding: $0.prefix(length), as: UTF8.self) }
        if name != "." && name != ".." { names.append(name) }
      }
      return names
    }
  }

  typealias Rename = (_ from: Int32, _ fromName: String, _ to: Int32, _ toName: String) -> Int32

  static func discard(_ copy: ChannelSwitch.Copy, caches: URL, bundleId: String, protected: Set<FileID>,
                      rename: Rename = { renameat($0, $1, $2, $3) }) -> Discard {
    let name = URL(fileURLWithPath: copy.folder).lastPathComponent
    guard Directory.isName(name), root(caches: caches, bundleId: bundleId).appendingPathComponent(name, isDirectory: true).path == copy.folder else {
      return .refused("it isn't in Sparkle's Installation folder")
    }
    guard let cachesFolder = Directory.trusted(caches), let ours = cachesFolder.child(bundleId),
      let sparkle = ours.child(sparkleInstallationPath[0]), let installation = sparkle.child(sparkleInstallationPath[1])
    else { return .refused("Sparkle's Installation folder can't be opened without following links") }
    let wanted = FileID(device: copy.device, inode: copy.inode)
    guard let seen = installation.entry(name) else { return errno == ENOENT ? .gone : .failed(errno) }
    guard seen.directory, seen.id == wanted else { return .refused("it isn't the copy that was checked") }
    guard !protected.contains(wanted) else { return .refused("it holds the running app") }
    guard let found = survey(caches: caches, bundleId: bundleId) else { return .refused("Sparkle's cache can't be read") }
    let inFolder = found.filter { $0.copy.folder == copy.folder }
    guard !inFolder.isEmpty, inFolder.allSatisfy({ $0.copy == copy }) else { return .refused("it isn't the copy that was checked") }
    if mkdirat(ours.descriptor, discardedFolder, 0o700) != 0, errno != EEXIST { return .failed(errno) }
    guard let trash = ours.child(discardedFolder), trash.id.device == copy.device else {
      return .refused("there's nowhere on its volume to move it")
    }
    let token = UUID().uuidString
    let pending = "unverified-\(token)"
    guard rename(installation.descriptor, name, trash.descriptor, pending) == 0 else {
      let failure = errno
      if installation.entry(name) == nil, errno == ENOENT { return .gone }
      return .failed(failure)
    }
    guard let moved = trash.entry(pending), moved.directory, moved.id == wanted else {
      guard rename(trash.descriptor, pending, installation.descriptor, name) == 0 else {
        return .stranded(discarded(caches: caches, bundleId: bundleId).appendingPathComponent(pending).path)
      }
      return .refused("a different folder took its place; it was put back")
    }
    _ = rename(trash.descriptor, pending, trash.descriptor, "\(copy.device)-\(copy.inode)-\(token)")
    return .gone
  }

  static func emptyDiscarded(caches: URL, bundleId: String, protected: Set<FileID>, unregister: (URL) -> Void = { _ in }) -> Cleanup {
    var cleanup = Cleanup()
    guard let cachesFolder = Directory.trusted(caches), let ours = cachesFolder.child(bundleId), let trash = ours.child(discardedFolder),
      let names = trash.names()
    else { return cleanup }
    let trashPath = discarded(caches: caches, bundleId: bundleId)
    for name in names.sorted() {
      guard let claimed = verifiedIdentity(name), let seen = trash.entry(name), seen.directory, seen.id == claimed,
        !protected.contains(claimed), let folder = trash.child(name), folder.id == claimed,
        removeContents(of: folder, at: trashPath.appendingPathComponent(name, isDirectory: true), protected: protected, unregister: unregister),
        trash.entry(name)?.id == claimed, unlinkat(trash.descriptor, name, AT_REMOVEDIR) == 0
      else {
        cleanup.kept.append(name)
        continue
      }
      cleanup.removed.append(name)
    }
    return cleanup
  }

  private static func verifiedIdentity(_ name: String) -> FileID? {
    let parts = name.split(separator: "-", maxSplits: 2)
    guard parts.count == 3, let device = UInt64(parts[0]), let inode = UInt64(parts[1]), UUID(uuidString: String(parts[2])) != nil else {
      return nil
    }
    return FileID(device: device, inode: inode)
  }

  private static func removeContents(of folder: Directory, at path: URL, protected: Set<FileID>, unregister: (URL) -> Void) -> Bool {
    guard !protected.contains(folder.id), let names = folder.names() else { return false }
    if path.pathExtension == "app" { unregister(path) }
    var complete = true
    for name in names {
      guard let seen = folder.entry(name) else {
        complete = false
        continue
      }
      if seen.directory {
        guard !protected.contains(seen.id), let child = folder.child(name), child.id == seen.id,
          removeContents(of: child, at: path.appendingPathComponent(name, isDirectory: true), protected: protected, unregister: unregister),
          folder.entry(name)?.id == seen.id, unlinkat(folder.descriptor, name, AT_REMOVEDIR) == 0
        else {
          complete = false
          continue
        }
      } else if unlinkat(folder.descriptor, name, 0) != 0 {
        complete = false
      }
    }
    return complete
  }

  static func contains(_ folder: URL, _ item: URL) -> Bool {
    let base = folder.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    let parts = item.resolvingSymlinksInPath().standardizedFileURL.pathComponents
    return parts.count >= base.count && Array(parts.prefix(base.count)) == base
  }

  static func updateFolder(of bundle: URL, in root: URL) -> URL? {
    let base = root.standardizedFileURL.pathComponents
    let parts = bundle.standardizedFileURL.pathComponents
    guard parts.count > base.count + 1, Array(parts.prefix(base.count)) == base else { return nil }
    return URL(fileURLWithPath: NSString.path(withComponents: Array(parts.prefix(base.count + 1))), isDirectory: true)
  }
}
