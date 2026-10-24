@preconcurrency import BackgroundTasks
import BackgroundCore
import Foundation
import SwiftUI
import UIKit

/// BGTask's lifecycle is synchronized separately from UI/actor delivery.
/// An expiration callback can stop native CPU work even if the main actor is busy.
private final class NativeSession: @unchecked Sendable {
    let id: UUID
    let token: StopToken
    let task: BGContinuedProcessingTask
    private let lock = NSLock()
    private var finished = false

    init(id: UUID, token: StopToken, task: BGContinuedProcessingTask, total: Int64) {
        self.id = id
        self.token = token
        self.task = task
        task.progress.totalUnitCount = total
        task.progress.completedUnitCount = 0
        task.expirationHandler = { token.requestStop(.systemExpired) }
    }

    func finish(success: Bool) {
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }
        finished = true
        task.expirationHandler = nil
        task.setTaskCompleted(success: success)
    }
}

@MainActor
final class BackgroundController: ObservableObject {
    @Published private(set) var jobs: [JobRecord] = []
    @Published private(set) var preparing = false
    @Published private(set) var busy = false
    @Published private(set) var ready = false
    @Published var error: String?
    @Published var evidenceURL: URL?
    let nativeCoreLinked = ss2_abi_version() == 1

    private let identifier: String
    private let telemetry = Telemetry()
    private var store: JobStore?
    private var activeID: UUID?
    private var token: StopToken?
    private var session: NativeSession?
    private var phase = "active"

    init() {
        identifier = (Bundle.main.bundleIdentifier ?? "media.alexlab.subsync2.backgroundlab") + ".cpuProof"
        do {
            let applicationSupport = try FileManager.default.url(for: .applicationSupportDirectory,
                                                                 in: .userDomainMask,
                                                                 appropriateFor: nil, create: true)
            let store = try JobStore(root: applicationSupport.appendingPathComponent("BackgroundJobs"))
            try store.recoverAfterLaunch()
            self.store = store
            // Continued tasks are in-process. Never revive a stale queue on app launch.
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            ready = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
                // Registration explicitly chooses DispatchQueue.main.
                MainActor.assumeIsolated {
                    guard let self, let continued = task as? BGContinuedProcessingTask else {
                        task.setTaskCompleted(success: false)
                        return
                    }
                    self.launch(continued)
                }
            }
            if !ready { error = "iOS nu a înregistrat sarcina de fundal. Testul nu poate porni." }
            UIDevice.current.isBatteryMonitoringEnabled = true
            refreshTelemetry()
            refresh()
        } catch {
            self.error = "Coada locală nu poate fi citită sau verificată. Fișierele existente au fost păstrate."
        }
    }

    func start(seconds: Int) {
        guard ready, !busy, let store, UIApplication.shared.applicationState == .active else { return }
        error = nil
        evidenceURL = nil
        busy = true
        preparing = true
        let token = StopToken()
        self.token = token
        Task {
            do {
                let total = try await Task.detached(priority: .utility) {
                    try CPUProof.calibratedUnits(seconds: seconds, token: token)
                }.value
                try token.check()
                guard UIApplication.shared.applicationState == .active else {
                    throw JobError.stopped(.systemExpired)
                }
                var job = JobRecord(totalUnits: total, requestedSeconds: seconds)
                job.append(kind: "submitted", metrics: telemetry.sample())
                try store.create(job)
                activeID = job.id
                preparing = false
                let request = BGContinuedProcessingTaskRequest(identifier: identifier,
                    title: "SubSync2 — test CPU nativ",
                    subtitle: "Verificarea procesării locale în fundal")
                // Admission must be immediate. No invisible auto-start/retry later.
                request.strategy = .fail
                do { try BGTaskScheduler.shared.submit(request) }
                catch {
                    try store.update(job.id) {
                        $0.state = .interrupted
                        $0.message = "iOS nu a permis pornirea acum. Poți reîncerca explicit."
                        $0.append(kind: "admissionRejected", metrics: telemetry.sample())
                    }
                    throw error
                }
                refresh()
            } catch {
                self.error = "Testul nu a pornit. Revino în aplicație și încearcă din nou."
                resetActive()
                refresh()
            }
        }
    }

    private func launch(_ task: BGContinuedProcessingTask) {
        guard let id = activeID, let token, let store,
              let job = try? store.load(id), job.state == .queued else {
            task.setTaskCompleted(success: false)
            return
        }
        let session = NativeSession(id: id, token: token, task: task, total: job.totalUnits)
        self.session = session
        let telemetry = self.telemetry
        Task.detached(priority: .utility) { [weak self] in
            var success = false
            do {
                try token.check()
                try store.update(id) {
                    guard $0.state == .queued else { throw JobError.invalidTransition }
                    $0.state = .running
                    $0.message = "Procesare CPU nativă. Progresul reprezintă date hash-uite efectiv."
                    $0.append(kind: "started", metrics: telemetry.sample())
                }
                let checksum = try CPUProof.run(totalUnits: job.totalUnits, token: token) { progress in
                    try store.update(id) {
                        guard $0.state == .running else { throw JobError.invalidTransition }
                        $0.completedUnits = progress.completed
                        $0.checksum = progress.checksum
                        $0.append(kind: "progress", metrics: telemetry.sample())
                    }
                    session.task.progress.completedUnitCount = progress.completed
                    Task { @MainActor [weak self] in self?.refresh() }
                }
                _ = try token.commit { try store.complete(id, checksum: checksum, metrics: telemetry.sample()) }
                success = true
            } catch {
                do {
                    try store.update(id) {
                        if case JobError.stopped(let reason) = error {
                            $0.state = reason == .userCancelled ? .cancelled : .interrupted
                            $0.message = reason == .userCancelled ? "Anulat de utilizator."
                                : "Întrerupt de iOS — poți reporni de la început."
                            $0.append(kind: reason.rawValue, metrics: telemetry.sample())
                        } else {
                            $0.state = .failed
                            $0.message = "Test eșuat. Nu există rezultat final verificat."
                            $0.append(kind: "failed", metrics: telemetry.sample())
                        }
                    }
                } catch {
                    // Preserve the last atomic record. Launch recovery treats it
                    // as interrupted; never replace persistence failure by success.
                    await self?.reportStorageFailure()
                }
            }
            session.finish(success: success)
            await self?.didFinish(id)
        }
    }

    func cancel() {
        guard busy else { return }
        token?.requestStop(.userCancelled)
        if preparing || session != nil { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        if let id = activeID, let store {
            do {
                try store.update(id) {
                    $0.state = .cancelled
                    $0.message = "Anulat înainte de pornire."
                    $0.append(kind: "userCancelled", metrics: telemetry.sample())
                }
            } catch { reportStorageFailure() }
        }
        resetActive()
        refresh()
    }

    func lifecycle(_ phase: String) {
        self.phase = phase
        refreshTelemetry()
        if preparing && phase != "active" { token?.requestStop(.systemExpired) }
        if let id = activeID, let store {
            do {
                let current = try store.load(id)
                if !current.state.isTerminal {
                    try store.update(id) { $0.append(kind: "lifecycle", metrics: telemetry.sample()) }
                }
            } catch { reportStorageFailure() }
        }
        refresh()
    }

    func export(_ job: JobRecord) {
        guard !busy, let store else { return }
        #if targetEnvironment(simulator)
        let kind = "simulator"
        #else
        let kind = "physical-device"
        #endif
        do {
            evidenceURL = try store.export(job.id, environment: [
                "kind": kind, "systemVersion": UIDevice.current.systemVersion,
                "model": UIDevice.current.model,
                "sourceCommit": Bundle.main.object(forInfoDictionaryKey: "SubSyncSourceCommit") as? String ?? "unknown",
                "debuggerDetached": "must-be-confirmed-by-tester",
                "screenLockTest": "must-be-confirmed-by-tester"
            ])
        } catch { reportStorageFailure() }
    }

    private func refreshTelemetry() {
        telemetry.update(phase: phase, protectedDataAvailable: UIApplication.shared.isProtectedDataAvailable,
                         batteryLevel: UIDevice.current.batteryLevel)
    }

    fileprivate func refresh() {
        do { jobs = try store?.all() ?? [] }
        catch { reportStorageFailure() }
    }

    private func reportStorageFailure() {
        error = "Salvarea sau verificarea locală a eșuat. Nu considera testul finalizat."
    }

    private func didFinish(_ id: UUID) {
        guard activeID == id else { return }
        resetActive()
        refresh()
    }

    private func resetActive() {
        activeID = nil
        session = nil
        token = nil
        busy = false
        preparing = false
    }
}
