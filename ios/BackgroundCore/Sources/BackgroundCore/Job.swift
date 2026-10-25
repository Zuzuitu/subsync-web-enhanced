import Foundation

public enum JobState: String, Codable, Sendable {
    case queued, running, interrupted, cancelled, failed, completed
    public var isTerminal: Bool { self != .queued && self != .running }
}

public struct RuntimeMetrics: Codable, Sendable {
    public var phase: String
    public var protectedDataAvailable: Bool
    public var processCPUSeconds: Double
    public var peakResidentBytes: UInt64
    public var lowPowerMode: Bool
    public var thermalState: Int
    public var batteryLevel: Float

    public init(phase: String = "unknown", protectedDataAvailable: Bool = true,
                processCPUSeconds: Double = 0, peakResidentBytes: UInt64 = 0,
                lowPowerMode: Bool = false, thermalState: Int = 0, batteryLevel: Float = -1) {
        self.phase = phase
        self.protectedDataAvailable = protectedDataAvailable
        self.processCPUSeconds = processCPUSeconds
        self.peakResidentBytes = peakResidentBytes
        self.lowPowerMode = lowPowerMode
        self.thermalState = thermalState
        self.batteryLevel = batteryLevel
    }
}

public struct WorkEvent: Codable, Sendable {
    public let kind: String
    public let date: Date
    public let uptime: Double
    public let completedUnits: Int64
    public let metrics: RuntimeMetrics

    public init(kind: String, completedUnits: Int64, metrics: RuntimeMetrics) {
        self.kind = kind
        self.date = Date()
        self.uptime = ProcessInfo.processInfo.systemUptime
        self.completedUnits = completedUnits
        self.metrics = metrics
    }
}

public struct JobRecord: Codable, Identifiable, Sendable {
    public static let version = 1
    public static let workload = "sha256-chain-256k-x16-v1"
    public let schemaVersion: Int
    public let workload: String
    public let id: UUID
    public let created: Date
    public let requestedSeconds: Int
    public let totalUnits: Int64
    public var state: JobState
    public var completedUnits: Int64
    public var checksum: String?
    public var message: String
    public var events: [WorkEvent]

    public init(totalUnits: Int64, requestedSeconds: Int) {
        self.schemaVersion = Self.version
        self.workload = Self.workload
        self.id = UUID()
        self.created = Date()
        self.requestedSeconds = requestedSeconds
        self.totalUnits = totalUnits
        self.state = .queued
        self.completedUnits = 0
        self.checksum = nil
        self.message = "În așteptarea pornirii de către iOS."
        self.events = []
    }

    public mutating func append(kind: String, metrics: RuntimeMetrics) {
        // At most one progress sample/second, bounded even on very long runs.
        if events.count >= 2000 { events.removeFirst() }
        events.append(WorkEvent(kind: kind, completedUnits: completedUnits, metrics: metrics))
    }

    public func validate() throws {
        guard schemaVersion == Self.version, workload == Self.workload,
              totalUnits > 0, totalUnits <= 10_000_000,
              (1...900).contains(requestedSeconds),
              completedUnits >= 0, completedUnits <= totalUnits,
              events.count <= 2000 else { throw JobError.invalidRecord }
        if let checksum {
            guard checksum.count == 64, checksum.allSatisfy({ $0.isHexDigit }) else {
                throw JobError.invalidRecord
            }
        }
        if state == .completed {
            guard completedUnits == totalUnits, checksum != nil else { throw JobError.invalidRecord }
        }
    }
}

public enum JobError: Error, Equatable, Sendable {
    case invalidRecord, missingResult, alreadyExists, invalidTransition
    case stopped(StopReason)
}

public enum StopReason: String, Codable, Sendable {
    case userCancelled, systemExpired
}

/// Cancellation is synchronous, thread safe and independent of the main actor.
/// The final disk commit is a linearization point: expiration before it cannot
/// become success, and expiration after it cannot overwrite a completed result.
public final class StopToken: @unchecked Sendable {
    private let lock = NSLock()
    private var reason: StopReason?
    private var finished = false

    public init() {}

    public func requestStop(_ reason: StopReason) {
        lock.lock(); defer { lock.unlock() }
        if !finished && self.reason == nil { self.reason = reason }
    }

    public func check() throws {
        lock.lock(); defer { lock.unlock() }
        if let reason { throw JobError.stopped(reason) }
    }

    /// A native decoder may surface cancellation as its own generic error.
    /// Preserve the actual user/system stop reason across that C/Swift boundary.
    public func failureConsideringCancellation(_ original: Error) -> Error {
        lock.lock(); defer { lock.unlock() }
        if let reason { return JobError.stopped(reason) }
        return original
    }

    public func commit<T>(_ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        if let reason { throw JobError.stopped(reason) }
        guard !finished else { throw JobError.invalidTransition }
        let value = try body()
        finished = true
        return value
    }
}
