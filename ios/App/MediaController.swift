@preconcurrency import BackgroundTasks
import BackgroundCore
import Foundation
import SwiftUI
import UIKit

private final class MediaExecution: @unchecked Sendable {
    let context: NativeMediaContext
    let token: StopToken
    let task: BGContinuedProcessingTask
    init(task: BGContinuedProcessingTask, token: StopToken, context: NativeMediaContext) {
        self.task = task; self.token = token; self.context = context
        task.progress.totalUnitCount = 1000
        task.expirationHandler = { token.requestStop(.systemExpired); context.cancel() }
    }
    func cancel() { token.requestStop(.userCancelled); context.cancel() }
    func finish(_ success: Bool) { task.expirationHandler = nil; task.setTaskCompleted(success: success) }
}

private final class CoordinatedInputResult: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Result<StagedInput, Error>?
    func set(_ value: Result<StagedInput, Error>) { lock.lock(); self.value = value; lock.unlock() }
    func get() -> Result<StagedInput, Error>? { lock.lock(); defer { lock.unlock() }; return value }
}

@MainActor
final class MediaController: ObservableObject {
    @Published private(set) var jobs: [MediaJob] = []
    @Published private(set) var subtitle: StagedInput?
    @Published private(set) var media: StagedInput?
    @Published private(set) var tracks: [AudioTrack] = []
    @Published var trackNumber: Int32 = -1
    @Published private(set) var busy = false
    @Published private(set) var importing = false
    @Published private(set) var importFraction: Double = 0
    @Published private(set) var ready = false
    @Published var error: String?
    @Published var exportURL: URL?
    private let identifier = (Bundle.main.bundleIdentifier ?? "media.alexlab.subsync2.backgroundlab") + ".mediaSync"
    private let telemetry = Telemetry()
    private var store: MediaJobStore?
    private var stager: FileStager?
    private var activeID: UUID?
    private var token: StopToken?
    private var execution: MediaExecution?
    private var probeContext: NativeMediaContext?
    private var phase = "active"
    var canAutoSelect: Bool {
        tracks.count == 1 || tracks.filter { ["eng", "en"].contains($0.language) }.count == 1
    }
    var preparingInputs: Bool { busy && !importing && activeID == nil }

    init() {
        do {
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true).appendingPathComponent("NativeMedia")
            stager = try FileStager(root: root.appendingPathComponent("inputs"))
            let store = try MediaJobStore(root: root.appendingPathComponent("jobs"))
            try store.recoverAfterLaunch(); self.store = store
            jobs = try store.all()
            if let previous = jobs.first { subtitle = previous.subtitle; media = previous.media }
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            ready = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
                MainActor.assumeIsolated {
                    guard let self, let task = task as? BGContinuedProcessingTask else {
                        task.setTaskCompleted(success: false); return
                    }
                    self.launch(task)
                }
            }
            if !ready { error = "iOS nu a înregistrat sarcina nativă. Sincronizarea nu poate porni pe acest dispozitiv." }
            refreshTelemetry()
        } catch { self.error = "Datele locale nu pot fi verificate. Fișierele au fost păstrate." }
    }

    func importFile(_ url: URL, kind: InputKind) {
        guard !busy, let stager else { return }
        busy = true; importing = true; importFraction = 0; error = nil; exportURL = nil
        let token = StopToken(); self.token = token
        let controller = self
        Task {
            do {
                let input = try await Task.detached(priority: .utility) {
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    var coordinatorError: NSError?
                    let result = CoordinatedInputResult()
                    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinatorError) { coordinated in
                        result.set(Result {
                            let staged = try stager.stage(coordinated, kind: kind, token: token) { done, total in
                                Task { @MainActor in controller.importFraction = Double(done) / Double(total) }
                            }
                            if kind == .subtitle {
                                do { _ = try SRTDocument(data: Data(contentsOf: stager.verifiedURL(staged, token: token))) }
                                catch { try? FileManager.default.removeItem(at: stager.root.appendingPathComponent(staged.relativePath)); throw error }
                            }
                            return staged
                        })
                    }
                    if let coordinatorError { throw coordinatorError }
                    guard let value = result.get() else { throw FileStageError.notRegularFile }
                    return try value.get()
                }.value
                if kind == .subtitle { subtitle = input } else { media = input }
                tracks = []; trackNumber = -1
                busy = false; importing = false; self.token = nil
                if subtitle != nil && media != nil { probe() }
            } catch {
                self.error = "Import nereușit sau anulat. Verifică fișierul și spațiul liber; pentru SRT folosește UTF-8 valid."
                busy = false; importing = false; self.token = nil
            }
        }
    }

    func probe() {
        guard !busy, let subtitle, let media, let stager else { return }
        busy = true; error = nil
        let token = StopToken(); self.token = token
        guard let context = try? NativeMediaContext() else { busy = false; self.token = nil; return }
        probeContext = context
        Task {
            do {
                let tracks = try await Task.detached(priority: .utility) {
                    let assets = try NativeMediaAssets(token: token)
                    let sub = try stager.verifiedURL(subtitle, token: token)
                    let ref = try stager.verifiedURL(media, token: token)
                    try context.open(subtitle: sub, reference: ref, assets: assets)
                    try token.check()
                    return context.tracks()
                }.value
                self.tracks = tracks
            } catch { self.error = "Nu am putut citi pistele sau modelele locale. Fișierele originale nu au fost modificate." }
            busy = false; self.token = nil; probeContext = nil
        }
    }

    func start(previous: MediaJob? = nil) {
        guard ready, !busy, let store, let stager,
              let subtitle = previous?.subtitle ?? subtitle,
              let media = previous?.media ?? media,
              UIApplication.shared.applicationState == .active else { return }
        if previous == nil && trackNumber == -1 && !canAutoSelect { error = "Alege explicit pista audio engleză."; return }
        do {
            let job = MediaJob(subtitle: subtitle, media: media, audioStream: previous?.audioStream ?? trackNumber)
            try store.create(job)
            activeID = job.id; token = StopToken(); busy = true; exportURL = nil; error = nil
            let request = BGContinuedProcessingTaskRequest(identifier: identifier,
                title: "SubSync2 — sincronizare subtitrare", subtitle: "Audio engleză → SRT română, local")
            request.strategy = .fail
            do { try BGTaskScheduler.shared.submit(request) }
            catch {
                try store.update(job.id) { $0.state = .interrupted; $0.message = "iOS nu a permis pornirea acum. Poți reîncerca." }
                throw error
            }
            refresh()
        } catch { self.error = "Sincronizarea nu a pornit. Reîncearcă din aplicația activă."; reset(); refresh() }
        _ = stager // Presence was checked before creating a persistent job.
    }

    private func launch(_ task: BGContinuedProcessingTask) {
        guard let id = activeID, let token, let store, let stager,
              let job = try? store.all().first(where: { $0.id == id }), job.state == .queued else {
            task.setTaskCompleted(success: false); return
        }
        do {
            let execution = MediaExecution(task: task, token: token, context: try NativeMediaContext())
            self.execution = execution
            let track = job.audioStream, controller = self, telemetry = self.telemetry
            Task.detached(priority: .utility) {
                var success = false
                do {
                    try token.check()
                    try store.update(id) { $0.state = .running; $0.message = "Verificare fișiere și modele locale…" }
                    await controller.refresh()
                    let assets = try NativeMediaAssets(token: token)
                    let sub = try stager.verifiedURL(job.subtitle, token: token)
                    let ref = try stager.verifiedURL(job.media, token: token)
                    let original = try Data(contentsOf: sub)
                    try execution.context.open(subtitle: sub, reference: ref, assets: assets)
                    try token.check()
                    guard ss2_media_start(execution.context.pointer, track, assets.sampleRate) == 0 else {
                        throw NativeMediaError.engine(Int(ss2_media_error_stage(execution.context.pointer)))
                    }
                    var status = SS2MediaStatus(), result: Int32 = 0
                    var last = ProcessInfo.processInfo.systemUptime
                    while result == 0 {
                        try token.check()
                        result = ss2_media_step(execution.context.pointer, 100, &status)
                        try token.check()
                        guard result >= 0 else { throw NativeMediaError.engine(Int(ss2_media_error_stage(execution.context.pointer))) }
                        let now = ProcessInfo.processInfo.systemUptime
                        if now - last >= 1 || result == 1 {
                            guard status.position.isFinite, status.duration.isFinite, status.duration >= 0,
                                  status.duration < 1_000_000_000, status.position >= 0,
                                  status.position < 1_000_000_000 else { throw NativeMediaError.invalidProgress }
                            try store.update(id) {
                                $0.duration = status.duration
                                $0.processedSeconds = max($0.processedSeconds, max(0, status.position))
                                $0.referenceWords = Int(status.reference_words)
                                $0.message = "Recunoaștere audio și corelație nativă…"
                                $0.event("mediaProgress", metrics: telemetry.sample())
                            }
                            if status.duration > 0 {
                                let total = max(1, Int64(status.duration * 1000))
                                execution.task.progress.totalUnitCount = total
                                execution.task.progress.completedUnitCount = min(total - 1, max(0, Int64(status.position * 1000)))
                            }
                            Task { @MainActor in controller.refresh() }
                            last = now
                        }
                    }
                    let fit = status.fit
                    let outcome = NativeOutcome(done: status.done != 0, correlated: fit.correlated != 0,
                        a: fit.a, b: fit.b, factor: fit.factor, maxDistance: fit.max_distance,
                        points: Int(fit.points), cueCount: Int(status.cues), referenceWords: Int(status.reference_words))
                    try token.check()
                    guard outcome.canonical else { throw SRTError.invalidFormula }
                    try store.complete(id, original: original, outcome: outcome, metrics: telemetry.sample(), token: token)
                    execution.task.progress.completedUnitCount = execution.task.progress.totalUnitCount
                    success = true
                } catch {
                    let terminalFailure = token.failureConsideringCancellation(error)
                    do {
                        try store.update(id) {
                            if case JobError.stopped(let reason) = terminalFailure {
                                $0.state = reason == .userCancelled ? .cancelled : .interrupted
                                $0.message = reason == .userCancelled ? "Anulat. Fișierele locale sunt păstrate."
                                    : "Întrerupt de iOS — poți reporni de la început."
                            } else {
                                $0.state = .failed
                                $0.message = "Sincronizare neconcludentă sau eroare de procesare. Nu există SRT final validat."
                            }
                            $0.event("stopped", metrics: telemetry.sample())
                        }
                    } catch { await controller.storageFailure() }
                }
                execution.finish(success)
                await controller.finished(id)
            }
        } catch {
            _ = try? store.update(id) { $0.state = .failed; $0.message = "Motorul nativ nu a putut porni. Poți reîncerca." }
            task.setTaskCompleted(success: false); storageFailure(); reset(); refresh()
        }
    }

    func cancel() {
        token?.requestStop(.userCancelled)
        probeContext?.cancel()
        if let execution { execution.cancel(); return }
        if importing || activeID == nil { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        if let id = activeID { _ = try? store?.update(id) { $0.state = .cancelled; $0.message = "Anulat înainte de pornire." } }
        reset(); refresh()
    }
    func export(_ job: MediaJob) {
        exportURL = nil
        do { exportURL = try store?.exportURL(job.id) }
        catch { storageFailure() }
    }
    func lifecycle(_ phase: String, protectedDataAvailable: Bool? = nil) {
        self.phase = phase; refreshTelemetry(protectedDataAvailable)
        if activeID == nil && phase != "active" {
            token?.requestStop(.systemExpired)
            probeContext?.cancel()
        }
        if let id = activeID {
            do { try store?.update(id) { $0.event("lifecycle", metrics: telemetry.sample()) } }
            catch JobError.invalidTransition { /* Completed concurrently with this scene transition. */ }
            catch { storageFailure() }
        }
        refresh()
    }
    private func refreshTelemetry(_ protectedDataAvailable: Bool? = nil) {
        telemetry.update(phase: phase, protectedDataAvailable: protectedDataAvailable ?? UIApplication.shared.isProtectedDataAvailable,
                         batteryLevel: UIDevice.current.batteryLevel)
    }
    private func refresh() { do { jobs = try store?.all() ?? [] } catch { storageFailure() } }
    private func storageFailure() { error = "Datele sau rezultatul local nu pot fi verificate. Nu considera operațiunea finalizată." }
    private func finished(_ id: UUID) { if activeID == id { reset() }; refresh() }
    private func reset() { activeID = nil; execution = nil; token = nil; busy = false }
}
