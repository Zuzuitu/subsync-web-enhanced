import BackgroundCore
import Darwin
import Foundation

/// UIKit state is supplied by the main actor; CPU/RSS come from the native
/// process, including when UIKit is no longer rendering our interface.
final class Telemetry: @unchecked Sendable {
    private let lock = NSLock()
    private var value = RuntimeMetrics()

    func update(phase: String, protectedDataAvailable: Bool, batteryLevel: Float) {
        lock.lock(); defer { lock.unlock() }
        value.phase = phase
        value.protectedDataAvailable = protectedDataAvailable
        value.batteryLevel = batteryLevel
    }

    func sample() -> RuntimeMetrics {
        lock.lock()
        var result = value
        lock.unlock()
        var usage = rusage()
        if getrusage(RUSAGE_SELF, &usage) == 0 {
            result.processCPUSeconds = Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec)
                + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1_000_000
            // Darwin ru_maxrss is bytes (Linux uses KiB).
            result.peakResidentBytes = UInt64(max(0, usage.ru_maxrss))
        }
        result.lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
        result.thermalState = ProcessInfo.processInfo.thermalState.rawValue
        return result
    }
}
