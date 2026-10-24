import CryptoKit
import Foundation

public struct NativeOutcome: Codable, Sendable {
    public let done: Bool, correlated: Bool
    public let a: Double, b: Double, factor: Double, maxDistance: Double
    public let points: Int, cueCount: Int, referenceWords: Int
    public init(done: Bool, correlated: Bool, a: Double, b: Double, factor: Double,
                maxDistance: Double, points: Int, cueCount: Int, referenceWords: Int) {
        self.done = done; self.correlated = correlated; self.a = a; self.b = b
        self.factor = factor; self.maxDistance = maxDistance; self.points = points
        self.cueCount = cueCount; self.referenceWords = referenceWords
    }
    public var canonical: Bool {
        done && correlated && a.isFinite && a > 0 && b.isFinite && factor.isFinite
        && maxDistance.isFinite && factor >= 0.9999 && maxDistance >= 0
        && maxDistance <= 2 && points >= 20 && cueCount > 0 && referenceWords > 0
    }
}

public struct MediaJob: Codable, Identifiable, Sendable {
    public let schemaVersion: Int
    public let id: UUID
    public let created: Date
    public let subtitle: StagedInput, media: StagedInput
    public var state: JobState
    public var message: String
    public var duration: Double
    public var processedSeconds: Double
    public var referenceWords: Int
    public var outcome: NativeOutcome?
    public var outputSHA256: String?
    public var events: [WorkEvent]

    public init(subtitle: StagedInput, media: StagedInput) {
        schemaVersion = 1; id = UUID(); created = Date()
        self.subtitle = subtitle; self.media = media; state = .queued
        message = "În așteptarea pornirii native."; duration = 0; processedSeconds = 0
        referenceWords = 0; outcome = nil; outputSHA256 = nil; events = []
    }
    public mutating func event(_ kind: String, metrics: RuntimeMetrics) {
        if events.count >= 2000 { events.removeFirst() }
        let units = processedSeconds.isFinite && processedSeconds >= 0 && processedSeconds < 1_000_000_000
            ? Int64(processedSeconds * 1000) : 0
        events.append(WorkEvent(kind: kind, completedUnits: units, metrics: metrics))
    }
    fileprivate func validate() throws {
        guard schemaVersion == 1, subtitle.kind == .subtitle, media.kind == .media,
              duration.isFinite, duration >= 0, processedSeconds.isFinite, processedSeconds >= 0,
              processedSeconds < 1_000_000_000, referenceWords >= 0, events.count <= 2000 else { throw JobError.invalidRecord }
        if state == .completed {
            guard outcome?.canonical == true, outputSHA256?.count == 64 else { throw JobError.invalidRecord }
        }
    }
}

public final class MediaJobStore: @unchecked Sendable {
    public let root: URL
    private let lock = NSLock()
    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: root.path)
        #endif
        var url = root
        var flags = URLResourceValues(); flags.isExcludedFromBackup = true
        try url.setResourceValues(flags)
    }
    public func create(_ job: MediaJob) throws {
        lock.lock(); defer { lock.unlock() }
        guard !FileManager.default.fileExists(atPath: record(job.id).path) else { throw JobError.alreadyExists }
        try write(job)
    }
    public func all() throws -> [MediaJob] {
        lock.lock(); defer { lock.unlock() }
        return try ids().map(read).sorted { $0.created > $1.created }
    }
    @discardableResult
    public func update(_ id: UUID, _ mutation: (inout MediaJob) throws -> Void) throws -> MediaJob {
        lock.lock(); defer { lock.unlock() }
        var job = try read(id)
        guard !job.state.isTerminal else { throw JobError.invalidTransition }
        try mutation(&job)
        guard job.state != .completed else { throw JobError.invalidTransition }
        try write(job)
        return job
    }
    public func recoverAfterLaunch() throws {
        lock.lock(); defer { lock.unlock() }
        for id in try ids() {
            var job = try read(id)
            if job.state == .queued || job.state == .running {
                job.state = .interrupted
                job.message = "Întrerupt — poți reporni de la început cu fișierele locale păstrate."
                try write(job)
            } else if job.state == .completed {
                do { try verifyOutput(job) }
                catch {
                    job.state = .failed
                    job.message = "Rezultatul nu mai poate fi verificat. Repornește sincronizarea."
                    try write(job)
                }
            }
        }
    }
    public func complete(_ id: UUID, original: Data, outcome: NativeOutcome,
                         metrics: RuntimeMetrics, token: StopToken) throws {
        guard outcome.canonical else { throw SRTError.invalidFormula }
        let subtitle = try SRTDocument(data: original)
        guard subtitle.cueCount == outcome.cueCount else { throw SRTError.invalidStructure }
        let output = try subtitle.applying(a: outcome.a, b: outcome.b)
        try token.commit {
            lock.lock(); defer { lock.unlock() }
            var job = try read(id)
            guard job.state == .running else { throw JobError.invalidTransition }
            try atomic(output, to: result(id))
            job.outcome = outcome
            job.outputSHA256 = digest(output)
            // Read back the actual atomic file before committing completion.
            try verifyOutput(job)
            job.state = .completed
            job.message = "SRT sincronizat și verificat."
            job.event("completed", metrics: metrics)
            try write(job)
        }
    }
    public func exportURL(_ id: UUID) throws -> URL {
        lock.lock(); defer { lock.unlock() }
        let job = try read(id)
        guard job.state == .completed else { throw JobError.missingResult }
        try verifyOutput(job)
        return result(id)
    }
    private func verifyOutput(_ job: MediaJob) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: result(job.id).path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 32 * 1024 * 1024 else { throw JobError.missingResult }
        let bytes = try Data(contentsOf: result(job.id))
        guard digest(bytes) == job.outputSHA256,
              try SRTDocument(data: bytes).cueCount == job.outcome?.cueCount else { throw JobError.missingResult }
    }
    private func ids() throws -> [UUID] {
        try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.map {
                guard let id = UUID(uuidString: $0.deletingPathExtension().lastPathComponent) else { throw JobError.invalidRecord }
                return id
            }
    }
    private func read(_ id: UUID) throws -> MediaJob {
        let size = try FileManager.default.attributesOfItem(atPath: record(id).path)[.size] as? NSNumber
        guard let size, size.intValue <= 4_000_000 else { throw JobError.invalidRecord }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        let job = try decoder.decode(MediaJob.self, from: Data(contentsOf: record(id)))
        try job.validate()
        guard job.id == id else { throw JobError.invalidRecord }
        return job
    }
    private func write(_ job: MediaJob) throws {
        try job.validate()
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try atomic(encoder.encode(job), to: record(job.id))
    }
    private func atomic(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    private func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func record(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString + ".json") }
    private func result(_ id: UUID) -> URL { root.appendingPathComponent("SubSync2-" + id.uuidString + ".srt") }
}
