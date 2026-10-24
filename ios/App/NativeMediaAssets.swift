import BackgroundCore
import CryptoKit
import Foundation

enum NativeMediaError: Error { case assets, engine(Int), ambiguousTrack, invalidProgress }

struct NativeMediaAssets: Sendable {
    let dictionary: URL
    let parameters: [String: String]
    let sampleRate: Int32

    init(token: StopToken) throws {
        struct Entry: Decodable { let path: String; let bytes: Int; let sha256: String }
        struct Manifest: Decodable {
            let schemaVersion: Int, language: String, speechDescriptor: String, dictionary: String
            let archives: [String: String]; let files: [Entry]
        }
        struct Model: Decodable { let lang: String, sampleformat: String, samplerate: String; let sphinx: [String: String] }
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("LanguageAssets"),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: Data(contentsOf: root.appendingPathComponent("assets.json"))),
              manifest.schemaVersion == 1, manifest.language == "eng", manifest.files.count < 1000,
              manifest.archives["speechEnglish"] == "b96fa77cc3567c0351d1a1dae2cd87cb38ae815834903cc1e680e48b6cbd45a5",
              manifest.archives["dictionaryEnglishRomanian"] == "04350f06586fc06082142e7a8e9b32f961782bc08341755594a0c4be3b57cfc4" else { throw NativeMediaError.assets }
        func checked(_ path: String) throws -> URL {
            let url = root.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
            guard url.path.hasPrefix(root.standardizedFileURL.path + "/") else { throw NativeMediaError.assets }
            return url
        }
        for entry in manifest.files {
            try token.check()
            let url = try checked(entry.path)
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
            guard size == entry.bytes else { throw NativeMediaError.assets }
            let file = try FileHandle(forReadingFrom: url)
            defer { try? file.close() }
            var hash = SHA256()
            while let bytes = try file.read(upToCount: 1024 * 1024), !bytes.isEmpty {
                try token.check(); hash.update(data: bytes)
            }
            guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == entry.sha256 else { throw NativeMediaError.assets }
        }
        let descriptor = try checked(manifest.speechDescriptor)
        let model = try JSONDecoder().decode(Model.self, from: Data(contentsOf: descriptor))
        guard model.lang == "eng", model.sampleformat == "S16", model.samplerate == "16000" else { throw NativeMediaError.assets }
        var parameters = model.sphinx
        for (key, value) in parameters where value.hasPrefix("./") {
            let resolved = descriptor.deletingLastPathComponent().appendingPathComponent(value).standardizedFileURL
            guard resolved.path.hasPrefix(root.path + "/") else { throw NativeMediaError.assets }
            parameters[key] = resolved.path
        }
        self.parameters = parameters
        self.dictionary = try checked(manifest.dictionary)
        self.sampleRate = 16000
    }
}

/// Work methods are confined to the worker. Only cancel may be invoked from
/// expiration/UI concurrently. Lifetime extends until the worker has stopped.
final class NativeMediaContext: @unchecked Sendable {
    let pointer: OpaquePointer
    init() throws {
        guard let pointer = ss2_media_create() else { throw NativeMediaError.engine(1) }
        self.pointer = pointer
    }
    deinit { ss2_media_destroy(pointer) }
    func cancel() { ss2_media_cancel(pointer) }
    func open(subtitle: URL, reference: URL, assets: NativeMediaAssets) throws {
        for (key, value) in assets.parameters {
            guard ss2_media_set_param(pointer, key, value) == 0 else { throw NativeMediaError.engine(1) }
        }
        guard ss2_media_open(pointer, subtitle.path, reference.path, assets.dictionary.path) == 0 else {
            throw NativeMediaError.engine(Int(ss2_media_error_stage(pointer)))
        }
    }
    func tracks() -> [AudioTrack] {
        let count = max(0, ss2_media_audio_count(pointer))
        return (0..<count).compactMap { index in
            var value = SS2AudioStream()
            guard ss2_media_audio_info(pointer, index, &value) == 0 else { return nil }
            let language = withUnsafePointer(to: &value.language) {
                $0.withMemoryRebound(to: CChar.self, capacity: 32) { String(cString: $0) }
            }
            let codec = withUnsafePointer(to: &value.codec) {
                $0.withMemoryRebound(to: CChar.self, capacity: 64) { String(cString: $0) }
            }
            return AudioTrack(number: value.number, language: language, codec: codec)
        }
    }
}

struct AudioTrack: Identifiable, Sendable {
    let number: Int32
    let language: String, codec: String
    var id: Int32 { number }
}
