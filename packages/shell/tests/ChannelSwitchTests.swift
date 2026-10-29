import XCTest
@testable import ArdiaUpdaterCore

final class ChannelSwitchTests: XCTestCase {
  typealias Copy = ChannelSwitch.Copy
  let staged = Copy(folder: "/Installation/a", device: 1, inode: 10, build: "91")
  let restaged = Copy(folder: "/Installation/b", device: 1, inode: 11, build: "91")
  let deadlineLine = ChannelSwitch.Effect.log("Sparkle didn't drop the staged nightly before the quit deadline; removing its copy")
  let unreadableLine = ChannelSwitch.Effect.log("Sparkle's cache can't be read to confirm the staged nightly is gone; quitting waits for its deadline")

  func unconfirmed(_ copies: Set<Copy>) -> [ChannelSwitch.Effect] {
    [.watch, .log("Sparkle's installer didn't confirm dropping the staged nightly; removing its copy"), .discard(copies)]
  }

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
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed([staged]))
    XCTAssertEqual(machine.phase, .unconfirmed)
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.quit(1, facts([staged])), [.unwatch, .resume])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed([staged]))
    XCTAssertEqual(machine.deadline(1, facts([staged])), [deadlineLine, .discard([staged]), .release([1])])
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
    XCTAssertEqual(machine.changed(unreadable()), [.watch, unreadableLine])
    XCTAssertTrue(machine.holdsQuit(unreadable()))
  }

  func testADeadlineWithAnUnreadableCacheQuitsWithTheWarningAndRemovesNothing() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.quit(1, unreadable()), [.resume])
    XCTAssertEqual(machine.deadline(1, unreadable(busy: true)),
                   [.log("Sparkle's cache can't be read at the quit deadline; quitting, and a staged nightly may install"), .release([1])])
  }

  func testAnUnconfirmedRemovalSettlesTheRoundOnceTheCopyIsGone() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.quit(1, facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed([staged]))
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .release([1])])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testOnlyCopiesNoInstallerWasToldToCancelAreRemoved() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged, restaged]))
    _ = machine.installerCancelled(build: "91", facts(busy: true, [staged]))
    XCTAssertEqual(machine.changed(facts([staged, restaged])), unconfirmed([restaged]))
  }

  func testALeftoverNightlyAtLaunchStartsADropWithNoQuitOrSwitch() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.noticed(facts()), [])
    XCTAssertEqual(machine.noticed(facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.noticed(facts([staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed([staged]))
    XCTAssertEqual(machine.changed(facts()), [.unwatch])
    XCTAssertEqual(machine.phase, .idle)
  }

  func testAFailedReadWhileCancellingKeepsWaitingForTheSameCopy() {
    var machine = ChannelSwitch()
    cancelling(&machine)
    XCTAssertEqual(machine.changed(unreadable()), [])
    XCTAssertEqual(machine.phase, .cancelling(ChannelSwitch.Round(cancelled: [staged], switched: true)))
    XCTAssertEqual(machine.changed(facts([staged])), [])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle])
  }

  func testAFailedReadAfterACancellationKeepsItsEvidence() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    _ = machine.installerCancelled(build: "91", facts(busy: true, [staged]))
    XCTAssertEqual(machine.changed(unreadable()), [.watch])
    XCTAssertEqual(machine.phase, .cancelling(ChannelSwitch.Round(cancelled: [staged], switched: true)))
    XCTAssertTrue(machine.holdsQuit(unreadable()))
  }

  func testQuitWithNothingStagedAndNothingPendingGoesAtOnce() {
    var machine = ChannelSwitch()
    XCTAssertEqual(machine.quit(1, facts()), [.release([1])])
    XCTAssertEqual(machine.quit(2, facts(busy: true)), [.release([2])])
  }

  func testAPendingSwitchHoldsQuitWhileSparkleIsBusyEvenWithNothingStagedYet() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertTrue(machine.holdsQuit(facts(busy: true)))
    XCTAssertEqual(machine.quit(1, facts(busy: true)), [])
    XCTAssertEqual(machine.changed(facts(busy: true)), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.resume])
    XCTAssertEqual(machine.installerCancelled(build: "91", facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), [.watch])
    XCTAssertEqual(machine.changed(facts()), [.unwatch, .resetCycle, .release([1])])
  }

  func testAPendingSwitchReleasesQuitOnceSparkleIsIdleWithNothingStaged() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.quit(1, facts(busy: true)), [])
    XCTAssertEqual(machine.changed(facts()), [.resetCycle, .release([1])])
  }

  func testAPendingSwitchHoldIsBoundByTheDeadline() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    XCTAssertEqual(machine.quit(1, facts(busy: true)), [])
    XCTAssertEqual(machine.deadline(1, facts(busy: true)), [.release([1])])
    XCTAssertFalse(machine.holdsQuit(facts()))
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
    XCTAssertEqual(machine.deadline(1, facts(busy: true, [staged])), [deadlineLine, .discard([staged]), .release([1])])
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
    XCTAssertEqual(machine.changed(facts([restaged])), unconfirmed([restaged]))
  }

  func testACancellationWithNoMatchingCopyIsNotEvidence() {
    var machine = ChannelSwitch()
    _ = machine.switched()
    _ = machine.changed(facts([staged]))
    XCTAssertEqual(machine.installerCancelled(build: "92", facts(busy: true, [staged])), [])
    XCTAssertEqual(machine.changed(facts([staged])), unconfirmed([staged]))
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
