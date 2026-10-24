import Foundation
import XCTest
@testable import BackgroundCore

final class BackgroundCoreTests: XCTestCase {
    private func withStore(_ body: (JobStore) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(JobStore(root: root))
    }

    private func running(_ store: JobStore, total: Int64 = 2) throws -> JobRecord {
        let job = JobRecord(totalUnits: total, requestedSeconds: 300)
        try store.create(job)
        return try store.update(job.id) { $0.state = .running }
    }

    func testRealCPUChecksumMatchesIndependentPythonSHA256() throws {
        // Generated independently with Python hashlib: 16 dependent SHA-256
        // hashes of 256 KiB; this detects a timer/stub or a changed workload.
        let result = try CPUProof.run(totalUnits: 1, token: StopToken()) { progress in
            XCTAssertEqual(progress.completed, 1)
        }
        XCTAssertEqual(result, "124f21e3275e3340fb75c4535628086b98d1c2c11dc7b0c72831f498a3fefe13")
    }

    func testCancellationBeforeCPUWorkDoesNotReportProgress() {
        let token = StopToken()
        token.requestStop(.userCancelled)
        XCTAssertThrowsError(try CPUProof.run(totalUnits: 1, token: token) { _ in XCTFail("No work permitted") }) {
            XCTAssertEqual($0 as? JobError, .stopped(.userCancelled))
        }
    }

    func testExpirationAtLastProgressCannotBecomeSuccess() throws {
        let token = StopToken()
        XCTAssertThrowsError(try CPUProof.run(totalUnits: 1, token: token) { _ in
            token.requestStop(.systemExpired)
        }) { XCTAssertEqual($0 as? JobError, .stopped(.systemExpired)) }
        XCTAssertThrowsError(try token.commit { XCTFail("Expired task cannot commit") })
    }

    func testFinalizationRunsExactlyOnceAndRejectsLateExpiration() throws {
        let token = StopToken()
        XCTAssertEqual(try token.commit { 42 }, 42)
        token.requestStop(.systemExpired)
        XCTAssertThrowsError(try token.commit { XCTFail("Second finalization") })
    }

    func testQueuedAndRunningJobsRecoverAsInterrupted() throws {
        try withStore { store in
            let queued = JobRecord(totalUnits: 2, requestedSeconds: 300)
            try store.create(queued)
            let job = try running(store)
            try store.update(job.id) { $0.completedUnits = 1 }
            try store.recoverAfterLaunch()
            XCTAssertEqual(try store.load(queued.id).state, .interrupted)
            XCTAssertEqual(try store.load(job.id).state, .interrupted)
            XCTAssertEqual(try store.load(job.id).completedUnits, 1) // evidence, not resume state
        }
    }

    func testRetryCreatesNewIdentityAndRestartsFromZero() throws {
        try withStore { store in
            let previous = try running(store)
            try store.update(previous.id) { $0.completedUnits = 1; $0.state = .interrupted }
            let retry = JobRecord(totalUnits: previous.totalUnits, requestedSeconds: previous.requestedSeconds)
            try store.create(retry)
            XCTAssertNotEqual(previous.id, retry.id)
            XCTAssertEqual(try store.load(retry.id).completedUnits, 0)
            XCTAssertEqual(try store.load(previous.id).state, .interrupted)
        }
    }

    func testIncompleteWorkCannotBeCompletedOrOverwriteExistingJob() throws {
        try withStore { store in
            let job = try running(store)
            XCTAssertThrowsError(try store.complete(job.id, checksum: String(repeating: "a", count: 64), metrics: .init()))
            XCTAssertThrowsError(try store.create(job))
            XCTAssertEqual(try store.load(job.id).state, .running)
        }
    }

    func testCompletedResultSurvivesReopenAndExportsWithoutPrivateInputs() throws {
        try withStore { store in
            let job = try running(store)
            try store.update(job.id) { $0.completedUnits = $0.totalUnits }
            try store.complete(job.id, checksum: String(repeating: "b", count: 64), metrics: .init())
            let reopened = try JobStore(root: store.root)
            try reopened.recoverAfterLaunch()
            XCTAssertEqual(try reopened.load(job.id).state, .completed)
            let url = try reopened.export(job.id, environment: ["kind": "unit-test"])
            let text = try String(contentsOf: url, encoding: .utf8)
            XCTAssertTrue(text.contains("native CPU proof"))
            XCTAssertFalse(text.contains("file://"))
        }
    }

    func testMissingFinalResultNeverAppearsCompletedAfterLaunch() throws {
        try withStore { store in
            let job = try running(store)
            try store.update(job.id) { $0.completedUnits = $0.totalUnits }
            try store.complete(job.id, checksum: String(repeating: "c", count: 64), metrics: .init())
            try FileManager.default.removeItem(at: store.root.appendingPathComponent("result-\(job.id.uuidString).json"))
            try store.recoverAfterLaunch()
            XCTAssertEqual(try store.load(job.id).state, .failed)
        }
    }

    func testCorruptRecordIsPreservedAndNeverSilentlyReset() throws {
        try withStore { store in
            let job = try running(store)
            let url = store.root.appendingPathComponent("job-\(job.id.uuidString).json")
            let corrupt = Data("{broken".utf8)
            try corrupt.write(to: url, options: .atomic)
            XCTAssertThrowsError(try store.recoverAfterLaunch())
            XCTAssertThrowsError(try store.load(job.id))
            XCTAssertEqual(try Data(contentsOf: url), corrupt)
        }
    }

    func testInvalidProgressDoesNotReplaceLastAtomicRecord() throws {
        try withStore { store in
            let job = try running(store)
            XCTAssertThrowsError(try store.update(job.id) { $0.completedUnits = $0.totalUnits + 1 })
            XCTAssertEqual(try store.load(job.id).completedUnits, 0)
            XCTAssertThrowsError(try store.update(job.id) { $0.state = .completed })
        }
    }

    func testCancelledRecordCannotBeReopenedByStaleCallback() throws {
        try withStore { store in
            let job = try running(store)
            try store.update(job.id) { $0.state = .cancelled }
            XCTAssertThrowsError(try store.update(job.id) { $0.state = .running })
            XCTAssertEqual(try store.load(job.id).state, .cancelled)
        }
    }

    func testEvidenceBoundAndNoNonfiniteOrInvalidWorkloads() throws {
        var job = JobRecord(totalUnits: 1, requestedSeconds: 300)
        for _ in 0..<2100 { job.append(kind: "progress", metrics: .init()) }
        XCTAssertEqual(job.events.count, 2000)
        XCTAssertThrowsError(try JobRecord(totalUnits: 0, requestedSeconds: 300).validate())
        XCTAssertThrowsError(try CPUProof.run(totalUnits: 0, token: StopToken()) { _ in })
    }
}
