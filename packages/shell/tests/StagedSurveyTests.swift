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

  func testCopiesInTwoFoldersAreBothFound() throws {
    try stage("first")
    try stage("second", build: "92")
    XCTAssertEqual(Set(try XCTUnwrap(survey()).map(\.copy.build)), ["91", "92"])
  }
}
