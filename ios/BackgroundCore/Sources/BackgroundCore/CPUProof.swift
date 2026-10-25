import CryptoKit
import Foundation

public struct WorkProgress: Sendable {
    public let completed: Int64
    public let checksum: String
}

/// Fixed, measurable CPU work, not a timer pretending to be a synchronization.
/// Each unit hashes 4 MiB in a dependent chain; live memory stays below 1 MiB.
public enum CPUProof {
    public static let bytesPerUnit: Int64 = 256 * 1024 * 16

    private struct Chain {
        var buffer = Data(repeating: 0xa5, count: 256 * 1024)
        var digest = Data(repeating: 0, count: 32)
        var index: UInt64 = 0

        mutating func unit(token: StopToken) throws {
            for _ in 0..<16 {
                try token.check()
                buffer.replaceSubrange(0..<32, with: digest)
                var value = index.littleEndian
                withUnsafeBytes(of: &value) { buffer.replaceSubrange(32..<40, with: $0) }
                digest = Data(SHA256.hash(data: buffer))
                index += 1
            }
        }

        var checksum: String { digest.map { String(format: "%02x", $0) }.joined() }
    }

    public static func calibratedUnits(seconds: Int, token: StopToken) throws -> Int64 {
        guard (1...900).contains(seconds) else { throw JobError.invalidRecord }
        var chain = Chain()
        let start = ProcessInfo.processInfo.systemUptime
        var units: Int64 = 0
        repeat {
            try chain.unit(token: token)
            units += 1
        } while ProcessInfo.processInfo.systemUptime - start < 0.3
        let elapsed = ProcessInfo.processInfo.systemUptime - start
        return min(10_000_000, max(1, Int64(Double(units) / elapsed * Double(seconds))))
    }

    public static func run(totalUnits: Int64, token: StopToken,
                           onProgress: @Sendable (WorkProgress) throws -> Void) throws -> String {
        guard totalUnits > 0, totalUnits <= 10_000_000 else { throw JobError.invalidRecord }
        var chain = Chain()
        var previous = ProcessInfo.processInfo.systemUptime
        for completed in 1...totalUnits {
            try chain.unit(token: token)
            let now = ProcessInfo.processInfo.systemUptime
            if now - previous >= 1 || completed == totalUnits {
                try token.check()
                try onProgress(WorkProgress(completed: completed, checksum: chain.checksum))
                previous = now
            }
        }
        try token.check()
        return chain.checksum
    }
}
