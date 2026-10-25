import BackgroundCore
import SwiftUI
import UIKit

@main
@MainActor
struct SubSync2BackgroundApp: App {
    @StateObject private var controller = BackgroundController()
    @StateObject private var mediaController = MediaController()
    @Environment(\.scenePhase) private var scenePhase
    @State private var seconds = 600

    var body: some Scene {
        WindowGroup {
            TabView {
                MediaSyncView(controller: mediaController, diagnosticsBusy: controller.busy)
                    .tabItem { Label("Sincronizare", systemImage: "captions.bubble") }
            NavigationStack {
                List {
                    Section("Verificare iOS 26+") {
                        Text("Test nativ pentru procesare în fundal")
                            .font(.headline)
                        Text("Acest test verifică separat execuția CPU și recuperarea după întrerupere. Pentru filme folosește tabul Sincronizare.")
                        Text("Progresul măsoară date procesate efectiv. Durata aleasă este o estimare bazată pe viteza inițială a telefonului.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Picker("Durată estimată", selection: $seconds) {
                            Text("5 minute").tag(300)
                            Text("10 minute").tag(600)
                            Text("15 minute").tag(900)
                        }.disabled(controller.busy)
                        Button(controller.preparing ? "Se calibrează volumul de lucru…" : "Pornește testul nativ") {
                            controller.start(seconds: seconds)
                        }.disabled(controller.busy || !controller.ready || mediaController.busy)
                        if controller.busy {
                            Button("Anulează", role: .destructive) { controller.cancel() }
                        }
                        if let error = controller.error { Text(error).foregroundStyle(.red) }
                    }
                    Section("Verificări salvate pe acest iPhone") {
                        if controller.jobs.isEmpty { Text("Niciun test pornit.") }
                        ForEach(controller.jobs) { job in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(state(job.state)).font(.headline)
                                ProgressView(value: Double(job.completedUnits), total: Double(job.totalUnits))
                                Text("\(job.completedUnits) / \(job.totalUnits) unități × 4 MiB")
                                    .font(.caption).monospacedDigit()
                                Text(job.message).font(.footnote)
                                if job.state.isTerminal {
                                    HStack {
                                        Button("Exportă dovezile JSON") { controller.export(job) }
                                        if job.state != .completed {
                                            Button("Repornește de la zero") { controller.start(seconds: job.requestedSeconds) }.disabled(mediaController.busy)
                                        }
                                    }.buttonStyle(.bordered).disabled(controller.busy)
                                }
                            }.padding(.vertical, 6)
                        }
                        if let url = controller.evidenceURL {
                            ShareLink("Salvează / distribuie raportul", item: url)
                        }
                    }
                    Section("Motor și licență") {
                        Text(controller.nativeCoreLinked
                            ? "Corelatorul C++ și motorul audio nativ sunt incluse. Acest tab verifică separat execuția CPU în fundal."
                            : "Legătura cu motorul nativ nu a fost verificată.")
                        Text("SubSync2 derivă din SubSync de Michał Szymaniak (sc0ty), GPLv3. Procesare exclusiv locală.")
                            .font(.footnote)
                        Link("Cod sursă și licență GPLv3", destination: URL(string: "https://github.com/Zuzuitu/subsync-web-enhanced")!)
                    }
                }
                .navigationTitle("SubSync2 Background Lab")
            }
            .tabItem { Label("Diagnostic CPU", systemImage: "cpu") }
            }
            .onChange(of: scenePhase) { _, phase in
                controller.lifecycle(phase == .active ? "active" : phase == .background ? "background" : "inactive")
                mediaController.lifecycle(phase == .active ? "active" : phase == .background ? "background" : "inactive")
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.protectedDataWillBecomeUnavailableNotification)) { _ in
                controller.lifecycle(scenePhase == .background ? "background" : "inactive", protectedDataAvailable: false)
                mediaController.lifecycle(scenePhase == .background ? "background" : "inactive", protectedDataAvailable: false)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.protectedDataDidBecomeAvailableNotification)) { _ in
                controller.lifecycle(scenePhase == .background ? "background" : "active", protectedDataAvailable: true)
                mediaController.lifecycle(scenePhase == .background ? "background" : "active", protectedDataAvailable: true)
            }
        }
    }

    private func state(_ state: JobState) -> String {
        switch state {
        case .queued: "În așteptare"
        case .running: "Test în desfășurare"
        case .interrupted: "Întrerupt — se poate reporni"
        case .cancelled: "Anulat"
        case .failed: "Eșuat"
        case .completed: "Test CPU finalizat"
        }
    }
}
