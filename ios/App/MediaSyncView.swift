import BackgroundCore
import SwiftUI
import UniformTypeIdentifiers

struct MediaSyncView: View {
    @ObservedObject var controller: MediaController
    let diagnosticsBusy: Bool
    @State private var showImporter = false
    @State private var importKind = InputKind.media

    var body: some View {
        NavigationStack {
            List {
                Section("Sincronizare locală EN → RO") {
                    Text("Versiune experimentală iOS 26+").font(.headline)
                    Text("Alege un film sau audio în engleză și o subtitrare SRT în română. Motorul procesează fișierele pe acest iPhone.")
                    Text("Funcționarea cu ecranul blocat și în alte aplicații necesită încă validare pe iPhone fizic. iOS poate întrerupe operațiunea.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button(controller.media == nil ? "Alege filmul / fișierul audio" : "Schimbă filmul / fișierul audio") {
                        importKind = .media; showImporter = true
                    }.disabled(controller.busy || diagnosticsBusy)
                    if let media = controller.media { Text("Copie locală: \(ByteCountFormatter.string(fromByteCount: media.byteCount, countStyle: .file))").font(.caption) }
                    Button(controller.subtitle == nil ? "Alege SRT în română" : "Schimbă SRT în română") {
                        importKind = .subtitle; showImporter = true
                    }.disabled(controller.busy || diagnosticsBusy)
                    if let subtitle = controller.subtitle { Text("SRT importat: \(ByteCountFormatter.string(fromByteCount: subtitle.byteCount, countStyle: .file))").font(.caption) }
                    Text("La import se creează copii locale. Păstrează aplicația deschisă până se termină importul; originalele rămân în Files.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if controller.importing { ProgressView(value: controller.importFraction); Text("Se importă local…") }
                    if !controller.tracks.isEmpty {
                        Picker("Pista audio engleză", selection: $controller.trackNumber) {
                            Text(controller.canAutoSelect ? "Automat — engleză / singura pistă" : "Alege pista audio").tag(Int32(-1))
                            ForEach(controller.tracks) { track in
                                Text("Pista \(track.number + 1) · \(track.language.isEmpty ? "limbă necunoscută" : track.language) · \(track.codec)").tag(track.number)
                            }
                        }.disabled(controller.busy || diagnosticsBusy)
                    } else if controller.media != nil && controller.subtitle != nil && !controller.busy {
                        Button("Citește pistele audio") { controller.probe() }.disabled(diagnosticsBusy)
                    }
                    Button("Sincronizează în fundal") { controller.start() }
                        .disabled(!controller.ready || controller.busy || diagnosticsBusy || controller.subtitle == nil || controller.media == nil
                                  || (controller.trackNumber == -1 && !controller.canAutoSelect))
                    if controller.busy { Button("Anulează", role: .destructive) { controller.cancel() } }
                    if let error = controller.error { Text(error).foregroundStyle(.red) }
                }
                Section("Operațiuni salvate") {
                    if controller.jobs.isEmpty { Text("Nicio sincronizare pornită.") }
                    ForEach(controller.jobs) { job in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(label(job.state)).font(.headline)
                            if !job.state.isTerminal {
                                if job.duration > 0 { ProgressView(value: min(job.processedSeconds, job.duration), total: job.duration) }
                                else { ProgressView() }
                            }
                            Text(job.message).font(.footnote)
                            if job.referenceWords > 0 { Text("\(job.referenceWords) cuvinte de referință procesate").font(.caption) }
                            if job.state == .completed {
                                Button("Salvează / distribuie SRT") { controller.export(job) }
                            } else if job.state.isTerminal {
                                Button("Repornește de la început") { controller.start(previous: job) }
                                    .disabled(controller.busy || diagnosticsBusy)
                            }
                        }.padding(.vertical, 4)
                    }
                    if let url = controller.exportURL { ShareLink("Exportă SRT verificat", item: url) }
                }
                Section("Motor") {
                    Text("FFmpeg + PocketSphinx + dicționar EN/RO + corelatorul original SubSync, cu pragurile canonice păstrate. GPLv3, Michał Szymaniak (sc0ty).")
                        .font(.footnote)
                }
            }.navigationTitle("SubSync2 nativ")
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            if case .success(let urls) = result, let url = urls.first { controller.importFile(url, kind: importKind) }
        }
    }
    private func label(_ state: JobState) -> String {
        switch state {
        case .queued: "În așteptare"
        case .running: "Sincronizare în desfășurare"
        case .interrupted: "Întrerupt — se poate reporni"
        case .cancelled: "Anulat"
        case .failed: "Neconcludent / eșuat"
        case .completed: "SRT final verificat"
        }
    }
}
