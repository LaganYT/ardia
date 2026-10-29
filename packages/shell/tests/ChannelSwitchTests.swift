import XCTest
@testable import ArdiaUpdaterCore

final class ChannelSwitchTests: XCTestCase {
  typealias Copy = ChannelSwitch.Copy
  let staged = Copy(folder: "/Installation/a", device: 1, inode: 10, build: "91")
  let restaged = Copy(folder: "/Installation/b", device: 1, inode: 11, build: "91")
  let deadlineLine = ChannelSwitch.Effect.log("Sparkle didn't drop the staged nightly before the quit deadline; quitting, and it may install")
  let unconfirmedLine = ChannelSwitch.Effect.log("Sparkle's installer didn't confirm dropping the staged nightly; quitting waits for its deadline")

  func facts(busy: Bool = false, _ copies: Set<Copy> = [], checks: Bool = true) -> ChannelSwitch.Facts {
    ChannelSwitch.Facts(busy: busy, staged: copies.isEmpty ? .none : .present(copies), automaticChecks: checks)
  }

  func unreadable(busy: Bool = false) -> ChannelSwitch.Facts {
    ChannelSwitch.Facts(busy: busy, staged: .unreadable, automaticChecks: true)
  }

  func cancelling(_ machine: inout ChannelSwitch) {
    XCTAssertEqual(machine.switched(), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91", facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
  }

  func testASwitchWithNothingStagedResetsTheUpdateCycle() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.switched(), [])
    XCTAssertEqual(machine.changed(facts()), [.resetCycle])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testWithAutomaticChecksOffASwitchWithNothingStagedDoesNothing() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts(checks: false)), [])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testAStagedNightlyIsResumedEvenWithAutomaticChecksOff() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts([staged], checks: false)), [.resume])
  }

  func testACancelledInstallerIsWatchedUntilItsCopyGoes() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testASwitchWhileSparkleIsBusyWaitsForIdleEvenWithoutACallback() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
  }

  func testAResumeThatEndsWithoutACancellationIsUnconfirmedNotStale() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.changed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch, unconfirmedLine])
    XCTAssertEqual(machine.phase, .unconfirmed)
    XCTAssertEqual(machine.quit(1, facts([staged])), [.unwatch, .resume])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch, unconfirmedLine])
    XCTAssertEqual(machine.deadline(1, facts([staged])), [deadlineLine, .release([1])])
  }

  func testAnUnconfirmedCopyThatGoesAfterAllSettles() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.changed(facts()), [.unwatch])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testAnUnreadableCacheIsTriedButNeverConfirmed() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.changed(unreadable()), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91", unreadable(busy: true)), [])
    XCTAssertEqual(machine.changed(unreadable()), [.watch, unconfirmedLine])
    XCTAssertTrue(ChannelSwitch.holdsQuit(unreadable()))
  }

  func testQuitWithNothingStagedGoesAtOnce() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.quit(1, facts()), [.release([1])])
    _ = machine.switched()
    XCTAssertEqual(machine.quit(2, facts(busy: true)), [.release([2])])
  }

  func testQuitWithALiveStagedNightlyAndNoSwitchStartsADrop() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.quit(1, facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91", facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .release([1])])
  }

  func testQuitsDuringARoundWaitForTheSameEnd() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.quit(1, facts([staged])), [])
    XCTAssertEqual(machine.quit(2, facts([staged])), [])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle, .release([1, 2])])
  }

  func testADeadlineReleasesItsQuitOnceAndTheLaterDropDoesntAgain() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.quit(1, facts([staged])), [.resume])
    XCTAssertEqual(machine.deadline(1, facts(busy: true, [staged])), [deadlineLine, .release([1])])
    XCTAssertEqual(machine.deadline(1, facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts()), [])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testADeadlineAfterTheDropIsIgnored() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    _ = machine.quit(1, facts([staged]))
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle, .release([1])])
    XCTAssertEqual(machine.deadline(1, facts()), [])
  }

  func testADeadlineWithTheCopyAlreadyGoneQuitsWithoutTheWarning() {
    var machine = ChannelSwitch()
    _ = machine.quit(1, facts([staged]))
    XCTAssertEqual(machine.deadline(1, facts(busy: true)), [.release([1])])
  }

  func testASecondSwitchDuringTheResumeIsAppliedWhenItEnds() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.switched(), [])
    XCTAssertEqual(machine.changed(facts()), [.resetCycle])
  }

  func testASwitchWhileCancellingKeepsTheEvidence() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.switched(), [.unwatch])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
  }

  func testReturningToNightlyWhileCancellingSettlesAndAppliesIt() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    _ = machine.switched()
    XCTAssertEqual(machine.changed(facts()), [.resetCycle])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testEvidenceCoversOnlyTheCopyItWasGivenFor() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.changed(facts(busy: true, [restaged])), [])
    XCTAssertEqual(machine.changed(facts([restaged])), [.unwatch, .resume])
    XCTAssertEqual(machine.changed(facts([restaged])), [.watch, unconfirmedLine])
  }

  func testACancellationWithNoMatchingCopyIsNotEvidence() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.installerCancelled(build: "92", facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch, unconfirmedLine])
  }

  func testACancellationInSparklesOwnSessionIsTrackedForQuit() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.installerCancelled(build: "91", facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.quit(1, facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .release([1])])
  }

  func testACancellationAfterAnUnconfirmedRoundWatchesAgain() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.installerCancelled(build: "91", facts(busy: true, [staged])), [.unwatch])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
  }
}
