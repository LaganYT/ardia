import XCTest
@testable import ArdiaUpdaterCore

final class StagedSurveyTests: XCTestCase {
  let bundleId = "com.ardia.browser.surveytest"
  var caches: URL!

  override func setUpWithError() throws {
    caches = FileManager.default.temporaryDirectory.appendingPathComponent("staged-survey-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    if let walk = FileManager.default.enumerator(atPath: caches.path) {
      for case let path as String in walk { chmod(caches.appendingPathComponent(path).path, 0o755) }
    }
    try? FileManager.default.removeItem(at: caches)
  }

  var root: URL { StagedSurvey.root(caches: caches, bundleId: bundleId) }

  @discardableResult
  func stage(_ folder: String = "abc123", bundleId: String? = nil, build: String = "91", channel: String? = "nightly",
             executable: Bool = true, plist: Bool = true) throws -> URL {
    let app = root.appendingPathComponent(folder).appendingPathComponent("Ardia.app")
    let contents = app.appendingPathComponent("Contents")
    try FileManager.default.createDirectory(at: contents.appendingPathComponent("MacOS"), withIntermediateDirectories: true)
    if executable {
      FileManager.default.createFile(atPath: contents.appendingPathComponent("MacOS/Ardia").path, contents: Data(), attributes: [.posixPermissions: 0o755])
    }
    if plist { try writeInfo(app, bundleId: bundleId ?? self.bundleId, build: build, channel: channel) }
    return app
  }

  func writeInfo(_ app: URL, bundleId: String? = nil, build: String = "91", channel: String? = "nightly") throws {
    var info: [String: Any] = ["CFBundleIdentifier": bundleId ?? self.bundleId, "CFBundleVersion": build, "CFBundleExecutable": "Ardia"]
    if let channel { info["ACUpdateChannel"] = channel }
    let data = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
    try data.write(to: app.appendingPathComponent("Contents/Info.plist"))
  }

  func survey() -> [StagedSurvey.Found]? { StagedSurvey.survey(caches: caches, bundleId: bundleId) }

  func testNoSparkleCacheMeansNoCopies() {
    XCTAssertEqual(survey(), [])
  }

  func testAStagedNightlyIsFoundWithTheIdentityOfItsUpdateFolder() throws {
    let app = try stage()
    var info = stat()
    XCTAssertEqual(lstat(root.appendingPathComponent("abc123").path, &info), 0)
    let found = try XCTUnwrap(survey())
    XCTAssertEqual(found.count, 1)
    XCTAssertEqual(found.first?.channel, "nightly")
    XCTAssertEqual(found.first?.bundle.standardizedFileURL, app.standardizedFileURL)
    XCTAssertEqual(found.first?.copy, ChannelSwitch.Copy(folder: root.appendingPathComponent("abc123").path,
                                                         device: UInt64(info.st_dev), inode: UInt64(info.st_ino), build: "91"))
  }

  func testAStableCopyIsFoundWithNoChannel() throws {
    try stage(channel: nil)
    XCTAssertEqual(survey()?.first?.channel, nil)
    XCTAssertEqual(survey()?.count, 1)
  }

  func testAnotherAppsCopyIsNotOurs() throws {
    try stage(bundleId: "com.example.other")
    XCTAssertEqual(survey(), [])
  }

  func testACopyWithoutAnExecutableStillCounts() throws {
    try stage(executable: false)
    XCTAssertEqual(survey()?.count, 1)
  }

  func testACopyStillBeingExtractedIsUnreadableNotAbsent() throws {
    let app = try stage(plist: false)
    XCTAssertNil(survey())
    try writeInfo(app)
    XCTAssertEqual(survey()?.count, 1)
  }

  func testAnInfoPlistThatCantBeReadIsUnreadable() throws {
    let app = try stage()
    chmod(app.appendingPathComponent("Contents/Info.plist").path, 0o000)
    XCTAssertNil(survey())
  }

  func testACorruptInfoPlistIsUnreadable() throws {
    let app = try stage()
    try Data("<plist".utf8).write(to: app.appendingPathComponent("Contents/Info.plist"))
    XCTAssertNil(survey())
  }

  func testAnUpdateFolderThatCantBeListedIsUnreadable() throws {
    try stage()
    chmod(root.appendingPathComponent("abc123").path, 0o000)
    XCTAssertNil(survey())
  }

  func testASymlinkInSparklesCachePathIsUnreadable() throws {
    let elsewhere = caches.appendingPathComponent("elsewhere/org.sparkle-project.Sparkle/Installation", isDirectory: true)
    try FileManager.default.createDirectory(at: elsewhere, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: caches.appendingPathComponent(bundleId), withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: caches.appendingPathComponent(bundleId).appendingPathComponent("org.sparkle-project.Sparkle"),
                                               withDestinationURL: elsewhere.deletingLastPathComponent())
    XCTAssertNil(survey())
  }

  func discard(_ copy: ChannelSwitch.Copy, running: URL? = nil, rename: StagedSurvey.Rename? = nil) -> StagedSurvey.Discard {
    let protected = running.map(StagedSurvey.ancestors(of:)) ?? []
    if let rename { return StagedSurvey.discard(copy, caches: caches, bundleId: bundleId, protected: protected, rename: rename) }
    return StagedSurvey.discard(copy, caches: caches, bundleId: bundleId, protected: protected)
  }

  var trash: URL { StagedSurvey.discarded(caches: caches, bundleId: bundleId) }

  func cleanup(running: URL? = nil) -> StagedSurvey.Cleanup {
    StagedSurvey.emptyDiscarded(caches: caches, bundleId: bundleId, protected: running.map(StagedSurvey.ancestors(of:)) ?? [])
  }

  func make(_ url: URL, file: String = "kept.txt") throws {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: url.appendingPathComponent(file).path, contents: Data("x".utf8))
  }

  func identity(_ url: URL) -> String {
    var info = stat()
    lstat(url.path, &info)
    return "\(info.st_dev)-\(info.st_ino)"
  }

  func swapBeforeMove(_ copy: ChannelSwitch.Copy, then putBack: @escaping () -> Int32) throws -> StagedSurvey.Rename {
    let unrelated = caches.appendingPathComponent("unrelated", isDirectory: true)
    try make(unrelated)
    var calls = 0
    return { from, fromName, to, toName in
      calls += 1
      if calls == 1 {
        try? FileManager.default.moveItem(atPath: copy.folder, toPath: self.caches.appendingPathComponent("aside").path)
        try? FileManager.default.moveItem(at: unrelated, to: URL(fileURLWithPath: copy.folder))
        return renameat(from, fromName, to, toName)
      }
      if calls == 2 { return putBack() }
      return renameat(from, fromName, to, toName)
    }
  }

  func testAMoveThatCaughtAnotherFolderPutsItBack() throws {
    try stage()
    let copy = try checkedCopy()
    var putBack: (() -> Int32)!
    let rename = try swapBeforeMove(copy) { putBack() }
    putBack = { -1 }
    var calls = 0
    let real: StagedSurvey.Rename = { from, fromName, to, toName in
      calls += 1
      return calls == 2 ? renameat(from, fromName, to, toName) : rename(from, fromName, to, toName)
    }
    XCTAssertEqual(discard(copy, rename: real), .refused("a different folder took its place; it was put back"))
    XCTAssertTrue(FileManager.default.fileExists(atPath: URL(fileURLWithPath: copy.folder).appendingPathComponent("kept.txt").path))
    XCTAssertEqual(cleanup().removed, [])
  }

  func testAMoveThatCaughtAnotherFolderAndCantPutItBackIsStrandedAndNeverDeleted() throws {
    try stage()
    let copy = try checkedCopy()
    let rename = try swapBeforeMove(copy) { errno = EPERM; return -1 }
    guard case .stranded(let path) = discard(copy, rename: rename) else { return XCTFail("the move wasn't reported stranded") }
    XCTAssertTrue(FileManager.default.fileExists(atPath: URL(fileURLWithPath: path).appendingPathComponent("kept.txt").path))
    XCTAssertEqual(cleanup().removed, [])
    XCTAssertTrue(FileManager.default.fileExists(atPath: URL(fileURLWithPath: path).appendingPathComponent("kept.txt").path))
  }

  func testCleanupDeletesOnlyAVerifiedMove() throws {
    try stage()
    let copy = try checkedCopy()
    XCTAssertEqual(discard(copy), .gone)
    try make(trash.appendingPathComponent("unverified-\(UUID().uuidString)"))
    try make(trash.appendingPathComponent("somebody-else"))
    try make(trash.appendingPathComponent("1-2-\(UUID().uuidString)"))
    let result = cleanup()
    XCTAssertEqual(result.removed.count, 1)
    XCTAssertEqual(result.kept.count, 3)
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: trash.path).count, 3)
  }

  func testCleanupUnlinksSymlinksInsideAMoveWithoutFollowingThem() throws {
    let app = try stage()
    let outside = caches.appendingPathComponent("outside", isDirectory: true)
    try make(outside, file: "precious.txt")
    try FileManager.default.createSymbolicLink(at: app.appendingPathComponent("Contents/Link"), withDestinationURL: outside)
    let copy = try checkedCopy()
    XCTAssertEqual(discard(copy), .gone)
    XCTAssertEqual(cleanup().removed.count, 1)
    XCTAssertTrue(FileManager.default.fileExists(atPath: outside.appendingPathComponent("precious.txt").path))
  }

  func testCleanupDoesntFollowASymlinkedAncestor() throws {
    let elsewhere = caches.appendingPathComponent("elsewhere", isDirectory: true)
    let entry = elsewhere.appendingPathComponent(StagedSurvey.discardedFolder).appendingPathComponent("placeholder")
    try make(entry, file: "precious.txt")
    let named = entry.deletingLastPathComponent().appendingPathComponent("\(identity(entry))-\(UUID().uuidString)")
    try FileManager.default.moveItem(at: entry, to: named)
    try FileManager.default.createSymbolicLink(at: caches.appendingPathComponent(bundleId), withDestinationURL: elsewhere)
    XCTAssertEqual(cleanup(), StagedSurvey.Cleanup())
    XCTAssertTrue(FileManager.default.fileExists(atPath: named.appendingPathComponent("precious.txt").path))
  }

  func testDiscardDoesntFollowASymlinkedSparkleFolder() throws {
    try stage()
    let copy = try checkedCopy()
    let sparkle = caches.appendingPathComponent(bundleId).appendingPathComponent(StagedSurvey.sparkleInstallationPath[0])
    let moved = caches.appendingPathComponent("real-sparkle")
    try FileManager.default.moveItem(at: sparkle, to: moved)
    try FileManager.default.createSymbolicLink(at: sparkle, withDestinationURL: moved)
    XCTAssertEqual(discard(copy), .refused("Sparkle's Installation folder can't be opened without following links"))
  }

  func testCleanupNeverDeletesTheRunningApp() throws {
    try stage()
    let copy = try checkedCopy()
    XCTAssertEqual(discard(copy), .gone)
    let entry = try XCTUnwrap(try FileManager.default.contentsOfDirectory(atPath: trash.path).first)
    let running = trash.appendingPathComponent(entry).appendingPathComponent("Ardia.app")
    let result = cleanup(running: running)
    XCTAssertEqual(result.removed, [])
    XCTAssertTrue(FileManager.default.fileExists(atPath: running.appendingPathComponent("Contents/Info.plist").path))
  }

  func checkedCopy() throws -> ChannelSwitch.Copy {
    try XCTUnwrap(survey()?.first?.copy)
  }

  func testAVerifiedCopyIsMovedOutOfSparklesFolderAtOnce() throws {
    try stage()
    let copy = try checkedCopy()
    XCTAssertEqual(discard(copy), .gone)
    XCTAssertFalse(FileManager.default.fileExists(atPath: copy.folder))
    XCTAssertEqual(survey(), [])
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: trash.path).count, 1)
  }

  func testACopyAlreadyGoneIsConfirmedGone() throws {
    try stage()
    let copy = try checkedCopy()
    try FileManager.default.removeItem(atPath: copy.folder)
    XCTAssertEqual(discard(copy), .gone)
  }

  func testAFolderReplacedUnderTheSameNameIsLeftAlone() throws {
    try stage()
    let copy = try checkedCopy()
    try FileManager.default.removeItem(atPath: copy.folder)
    try stage()
    XCTAssertEqual(discard(copy), .refused("it isn't the copy that was checked"))
    XCTAssertTrue(FileManager.default.fileExists(atPath: copy.folder))
  }

  func testACopyWhoseBuildChangedIsLeftAlone() throws {
    let app = try stage()
    let copy = try checkedCopy()
    try writeInfo(app, build: "92")
    XCTAssertEqual(discard(copy), .refused("it isn't the copy that was checked"))
    XCTAssertTrue(FileManager.default.fileExists(atPath: copy.folder))
  }

  func testAFolderOutsideSparklesInstallationFolderIsLeftAlone() throws {
    try stage()
    let copy = try checkedCopy()
    let outside = ChannelSwitch.Copy(folder: caches.appendingPathComponent("abc123").path, device: copy.device, inode: copy.inode, build: copy.build)
    XCTAssertEqual(discard(outside), .refused("it isn't in Sparkle's Installation folder"))
    let nested = ChannelSwitch.Copy(folder: root.appendingPathComponent("abc123/Ardia.app").path, device: copy.device, inode: copy.inode, build: copy.build)
    XCTAssertEqual(discard(nested), .refused("it isn't in Sparkle's Installation folder"))
  }

  func testTheRunningAppsFolderIsLeftAlone() throws {
    let app = try stage()
    let copy = try checkedCopy()
    XCTAssertEqual(discard(copy, running: app), .refused("it holds the running app"))
    XCTAssertTrue(FileManager.default.fileExists(atPath: copy.folder))
  }

  func testAMoveThatFailsIsAFailureNotGone() throws {
    try stage()
    let copy = try checkedCopy()
    try FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
    chmod(trash.path, 0o500)
    XCTAssertEqual(discard(copy), .failed(EACCES))
    chmod(trash.path, 0o755)
    XCTAssertTrue(FileManager.default.fileExists(atPath: copy.folder))
  }

  func testNothingIsRemovedWhenTheCacheCantBeRead() throws {
    let app = try stage()
    let copy = try checkedCopy()
    chmod(app.appendingPathComponent("Contents/Info.plist").path, 0o000)
    XCTAssertEqual(discard(copy), .refused("Sparkle's cache can't be read"))
    chmod(app.appendingPathComponent("Contents/Info.plist").path, 0o644)
    XCTAssertTrue(FileManager.default.fileExists(atPath: copy.folder))
  }

  func testCopiesInTwoFoldersAreBothFound() throws {
    try stage("first")
    try stage("second", build: "92")
    XCTAssertEqual(Set(try XCTUnwrap(survey()).map(\.copy.build)), ["91", "92"])
  }
}
