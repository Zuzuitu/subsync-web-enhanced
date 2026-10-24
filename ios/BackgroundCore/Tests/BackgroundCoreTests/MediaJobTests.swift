import Foundation
import XCTest
@testable import BackgroundCore

final class MediaJobTests: XCTestCase {
    private func exercise(_ body: (MediaJobStore, MediaJob, Data) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = try MediaJobStore(root: root)
        let sub = StagedInput(relativePath: UUID().uuidString + ".srt", byteCount: 50, sha256: String(repeating: "a", count: 64), kind: .subtitle)
        let media = StagedInput(relativePath: UUID().uuidString + ".mkv", byteCount: 1000, sha256: String(repeating: "b", count: 64), kind: .media)
        let job = MediaJob(subtitle: sub, media: media)
        try store.create(job)
        try store.update(job.id) { $0.state = .running }
        try body(store, job, Data("1\n00:00:18,000 --> 00:00:20,000\n<i>Împreună, țară!</i>\n".utf8))
    }
    private func fit(correlated: Bool = true) -> NativeOutcome {
        NativeOutcome(done: true, correlated: correlated, a: 1, b: -8, factor: 0.99999,
                      maxDistance: 0.1, points: 20, cueCount: 1, referenceWords: 30)
    }
    func testCompletedOutputIsAtomicVerifiedAndTextPreserved() throws {
        try exercise { store, job, bytes in
            try store.complete(job.id, original: bytes, outcome: fit(), metrics: .init(), token: StopToken())
            let url = try store.exportURL(job.id)
            let text = try String(contentsOf: url, encoding: .utf8)
            XCTAssertTrue(text.contains("00:00:10,000 --> 00:00:12,000"))
            XCTAssertTrue(text.contains("<i>Împreună, țară!</i>"))
            try store.recoverAfterLaunch()
            XCTAssertEqual(try store.all().first?.state, .completed)
            XCTAssertThrowsError(try store.update(job.id) { $0.state = .running })
        }
    }
    func testInconclusiveOrExpiredJobsCannotProduceExport() throws {
        try exercise { store, job, bytes in
            XCTAssertThrowsError(try store.complete(job.id, original: bytes, outcome: fit(correlated: false), metrics: .init(), token: StopToken()))
            let token = StopToken(); token.requestStop(.systemExpired)
            XCTAssertThrowsError(try store.complete(job.id, original: bytes, outcome: fit(), metrics: .init(), token: token))
            XCTAssertThrowsError(try store.exportURL(job.id))
            try store.recoverAfterLaunch()
            XCTAssertEqual(try store.all().first?.state, .interrupted)
        }
    }
    func testChangedOutputIsRejectedOnExportAndRelaunch() throws {
        try exercise { store, job, bytes in
            try store.complete(job.id, original: bytes, outcome: fit(), metrics: .init(), token: StopToken())
            let url = try store.exportURL(job.id)
            try Data("corrupted".utf8).write(to: url)
            XCTAssertThrowsError(try store.exportURL(job.id))
            try store.recoverAfterLaunch()
            XCTAssertEqual(try store.all().first?.state, .failed)
        }
    }
}
