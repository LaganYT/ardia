import Foundation

struct ChannelSwitch {
  struct Copy: Hashable {
    let folder: String
    let device: UInt64
    let inode: UInt64
    let build: String
  }

  enum Staged: Equatable {
    case none
    case present(Set<Copy>)
    case unreadable
  }

  struct Facts {
    var busy: Bool
    var staged: Staged
    var automaticChecks: Bool
  }

  struct Round: Equatable {
    var cancelled: Set<Copy> = []
    var switched = false
  }

  enum Phase: Equatable {
    case idle
    case waitingForIdle(Round)
    case resuming(Round)
    case cancelling(Round)
    case unconfirmed
  }

  enum Effect: Equatable {
    case resume
    case resetCycle
    case watch
    case unwatch
    case release([Int])
    case log(String)
  }

  private(set) var phase = Phase.idle
  private(set) var waiting: [Int] = []

  static func holdsQuit(_ facts: Facts) -> Bool { facts.staged != .none }

  mutating func switched() -> [Effect] {
    switch phase {
    case .idle:
      phase = .waitingForIdle(Round(switched: true))
      return []
    case .waitingForIdle(var round):
      round.switched = true
      phase = .waitingForIdle(round)
      return []
    case .resuming(var round):
      round.switched = true
      phase = .resuming(round)
      return []
    case .cancelling(var round):
      round.switched = true
      phase = .waitingForIdle(round)
      return [.unwatch]
    case .unconfirmed:
      phase = .waitingForIdle(Round(switched: true))
      return [.unwatch]
    }
  }

  mutating func installerCancelled(build: String, _ facts: Facts) -> [Effect] {
    guard case .present(let copies) = facts.staged else { return [] }
    let dropped = copies.filter { $0.build == build }
    guard !dropped.isEmpty else { return [] }
    switch phase {
    case .idle:
      phase = .waitingForIdle(Round(cancelled: dropped))
      return []
    case .unconfirmed:
      phase = .waitingForIdle(Round(cancelled: dropped))
      return [.unwatch]
    case .waitingForIdle(var round):
      round.cancelled.formUnion(dropped)
      phase = .waitingForIdle(round)
      return []
    case .resuming(var round):
      round.cancelled.formUnion(dropped)
      phase = .resuming(round)
      return []
    case .cancelling(var round):
      round.cancelled.formUnion(dropped)
      phase = .cancelling(round)
      return []
    }
  }

  mutating func changed(_ facts: Facts) -> [Effect] {
    switch phase {
    case .idle:
      return []
    case .waitingForIdle(let round):
      guard !facts.busy else { return [] }
      switch facts.staged {
      case .none:
        return settle(facts, reset: round.switched)
      case .present(let copies) where copies.isSubset(of: round.cancelled):
        phase = .cancelling(round)
        return [.watch]
      case .present, .unreadable:
        phase = .resuming(round)
        return [.resume]
      }
    case .resuming(let round):
      guard !facts.busy else { return [] }
      switch facts.staged {
      case .none:
        return settle(facts, reset: round.switched)
      case .present(let copies) where copies.isSubset(of: round.cancelled):
        phase = .cancelling(round)
        return [.watch]
      case .unreadable where !round.cancelled.isEmpty:
        phase = .cancelling(round)
        return [.watch]
      case .present, .unreadable:
        phase = .unconfirmed
        return [.watch, .log("Sparkle's installer didn't confirm dropping the staged nightly; quitting waits for its deadline")]
      }
    case .cancelling(let round):
      switch facts.staged {
      case .none:
        return [.unwatch] + settle(facts, reset: round.switched)
      case .present(let copies) where copies.isSubset(of: round.cancelled):
        return []
      case .unreadable:
        return []
      case .present:
        guard !facts.busy else { return [] }
        phase = .resuming(round)
        return [.unwatch, .resume]
      }
    case .unconfirmed:
      guard facts.staged == .none else { return [] }
      return [.unwatch] + settle(facts, reset: false)
    }
  }

  mutating func quit(_ id: Int, _ facts: Facts) -> [Effect] {
    guard Self.holdsQuit(facts) else { return [.release([id])] }
    waiting.append(id)
    switch phase {
    case .idle:
      phase = .waitingForIdle(Round())
      return changed(facts)
    case .unconfirmed:
      phase = .waitingForIdle(Round())
      return [.unwatch] + changed(facts)
    case .waitingForIdle, .resuming, .cancelling:
      return []
    }
  }

  mutating func deadline(_ id: Int, _ facts: Facts) -> [Effect] {
    guard let index = waiting.firstIndex(of: id) else { return [] }
    waiting.remove(at: index)
    guard Self.holdsQuit(facts) else { return [.release([id])] }
    return [.log("Sparkle didn't drop the staged nightly before the quit deadline; quitting, and it may install"), .release([id])]
  }

  private mutating func settle(_ facts: Facts, reset: Bool) -> [Effect] {
    phase = .idle
    let released = waiting
    waiting = []
    return (reset && facts.automaticChecks ? [.resetCycle] : []) + (released.isEmpty ? [] : [.release(released)])
  }
}
