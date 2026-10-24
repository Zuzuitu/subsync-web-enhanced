import Foundation

public final class JobStore: @unchecked Sendable {
    public let root: URL
    private let lock = NSLock()
    private let fm = FileManager.default

    public init(root: URL) throws {
        self.root = root
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        #if os(iOS)
        try fm.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                             ofItemAtPath: root.path)
        #endif
        var directory = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
    }

    public func create(_ job: JobRecord) throws {
        lock.lock(); defer { lock.unlock() }
        guard !fm.fileExists(atPath: recordURL(job.id).path) else { throw JobError.alreadyExists }
        try write(job, to: recordURL(job.id))
    }

    public func load(_ id: UUID) throws -> JobRecord {
        lock.lock(); defer { lock.unlock() }
        return try readJob(id)
    }

    public func all() throws -> [JobRecord] {
        lock.lock(); defer { lock.unlock() }
        return try jobIDs().map { try readJob($0) }.sorted { $0.created > $1.created }
    }

    @discardableResult
    public func update(_ id: UUID, _ change: (inout JobRecord) throws -> Void) throws -> JobRecord {
        lock.lock(); defer { lock.unlock() }
        var job = try readJob(id)
        let previous = job.state
        try change(&job)
        guard !previous.isTerminal, job.state != .completed else { throw JobError.invalidTransition }
        try write(job, to: recordURL(id))
        return job
    }

    /// A CPU checkpoint is evidence only. We deliberately restart from zero;
    /// the audio decoder/ASR cannot yet resume safely at an exact packet/window.
    public func recoverAfterLaunch() throws {
        lock.lock(); defer { lock.unlock() }
        for id in try jobIDs() {
            var job = try readJob(id)
            if job.state == .queued || job.state == .running {
                job.state = .interrupted
                job.message = "Întrerupt — testul poate fi repornit de la început."
                try write(job, to: recordURL(id))
            } else if job.state == .completed {
                // A torn/corrupt/missing final output is never accepted on restart.
                do { try verifyResult(job) }
                catch {
                    job.state = .failed
                    job.message = "Rezultatul nu mai poate fi verificat. Repornește testul."
                    try write(job, to: recordURL(id))
                }
            }
        }
    }

    public func complete(_ id: UUID, checksum: String, metrics: RuntimeMetrics) throws -> JobRecord {
        lock.lock(); defer { lock.unlock() }
        var job = try readJob(id)
        guard job.state == .running, job.completedUnits == job.totalUnits else {
            throw JobError.invalidTransition
        }
        job.checksum = checksum
        job.state = .completed
        job.message = "Test CPU finalizat. Sincronizarea filmelor nu este încă integrată."
        job.append(kind: "completed", metrics: metrics)
        // Both files are atomic. If killed between them, the persisted running
        // record becomes interrupted on launch and this orphan is not reused.
        try write(job, to: resultURL(id))
        try verifyResult(job)
        try write(job, to: recordURL(id))
        return job
    }

    public func export(_ id: UUID, environment: [String: String]) throws -> URL {
        lock.lock(); defer { lock.unlock() }
        let job = try readJob(id)
        if job.state == .completed { try verifyResult(job) }
        struct Evidence: Encodable {
            let schemaVersion = 1
            let scope = "native CPU proof; no media synchronization"
            let environment: [String: String]
            let job: JobRecord
        }
        let url = root.appendingPathComponent("evidence-\(id.uuidString).json")
        try atomic(encoder().encode(Evidence(environment: environment, job: job)), to: url)
        return url
    }

    private func jobIDs() throws -> [UUID] {
        try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("job-") && $0.pathExtension == "json" }
            .map {
                let name = $0.deletingPathExtension().lastPathComponent.dropFirst(4)
                guard let id = UUID(uuidString: String(name)) else { throw JobError.invalidRecord }
                return id
            }
    }

    private func readJob(_ id: UUID) throws -> JobRecord {
        let job = try decode(recordURL(id))
        guard job.id == id else { throw JobError.invalidRecord }
        return job
    }

    private func decode(_ url: URL) throws -> JobRecord {
        let attributes = try fm.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= 4_000_000 else {
            throw JobError.invalidRecord
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let job = try decoder.decode(JobRecord.self, from: Data(contentsOf: url))
        try job.validate()
        return job
    }

    private func verifyResult(_ job: JobRecord) throws {
        let result = try decode(resultURL(job.id))
        guard result.id == job.id, result.state == .completed,
              result.workload == job.workload, result.totalUnits == job.totalUnits,
              result.completedUnits == job.completedUnits, result.checksum == job.checksum else {
            throw JobError.missingResult
        }
    }

    private func write(_ job: JobRecord, to url: URL) throws {
        try job.validate()
        try atomic(encoder().encode(job), to: url)
    }

    private func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }

    private func atomic(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }

    private func recordURL(_ id: UUID) -> URL { root.appendingPathComponent("job-\(id.uuidString).json") }
    private func resultURL(_ id: UUID) -> URL { root.appendingPathComponent("result-\(id.uuidString).json") }
}
