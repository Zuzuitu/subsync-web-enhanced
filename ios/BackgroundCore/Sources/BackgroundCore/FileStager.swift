import CryptoKit
import Foundation

public enum InputKind: String, Codable, Sendable { case subtitle, media }
public struct StagedInput: Codable, Sendable, Equatable {
    public let relativePath: String
    public let byteCount: Int64
    public let sha256: String
    public let kind: InputKind
}
public enum FileStageError: Error { case notRegularFile, insufficientSpace, changedDuringRead, invalidIdentity }

public final class FileStager: Sendable {
    public let root: URL
    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: root.path)
        #endif
        var url = root
        var flags = URLResourceValues(); flags.isExcludedFromBackup = true
        try url.setResourceValues(flags)
    }

    /// Called with a coordinated/security-scoped readable URL. Copies in 1 MiB
    /// chunks so movie size does not determine RAM use or ephemeral URL lifetime.
    public func stage(_ source: URL, kind: InputKind, token: StopToken,
                      availableBytes: Int64? = nil,
                      progress: @Sendable (Int64, Int64) -> Void = { _, _ in }) throws -> StagedInput {
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size > 0 else { throw FileStageError.notRegularFile }
        if kind == .subtitle && size > 32 * 1024 * 1024 { throw FileStageError.notRegularFile }
        let capacity = try availableBytes ?? root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
        guard capacity >= Int64(size) + 64 * 1024 * 1024 else { throw FileStageError.insufficientSpace }
        try token.check()
        let extensionText = source.pathExtension.lowercased()
        let safeExtension = !extensionText.isEmpty && extensionText.count <= 12
            && extensionText.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII }
        let suffix = kind == .subtitle ? "srt" : safeExtension ? extensionText : "media"
        let name = UUID().uuidString + "." + suffix
        let partial = root.appendingPathComponent(name + ".part")
        let final = root.appendingPathComponent(name)
        defer { try? FileManager.default.removeItem(at: partial) }
        #if os(iOS)
        let attributes: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        #else
        let attributes: [FileAttributeKey: Any] = [:]
        #endif
        guard FileManager.default.createFile(atPath: partial.path, contents: nil, attributes: attributes) else {
            throw FileStageError.insufficientSpace
        }
        let input = try FileHandle(forReadingFrom: source)
        let output = try FileHandle(forWritingTo: partial)
        defer { try? input.close(); try? output.close() }
        var hash = SHA256(), count: Int64 = 0
        while true {
            try token.check()
            guard let chunk = try input.read(upToCount: 1024 * 1024), !chunk.isEmpty else { break }
            try output.write(contentsOf: chunk)
            hash.update(data: chunk)
            count += Int64(chunk.count)
            progress(count, Int64(size))
            guard count <= Int64(size) else { throw FileStageError.changedDuringRead }
        }
        let after = try source.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        guard count == Int64(size), after.fileSize == size,
              after.contentModificationDate == values.contentModificationDate else { throw FileStageError.changedDuringRead }
        try output.synchronize()
        try output.close()
        try token.check()
        try FileManager.default.moveItem(at: partial, to: final)
        let result = StagedInput(relativePath: name, byteCount: count,
            sha256: hash.finalize().map { String(format: "%02x", $0) }.joined(), kind: kind)
        return result
    }

    public func verifiedURL(_ input: StagedInput, token: StopToken) throws -> URL {
        guard input.relativePath == (input.relativePath as NSString).lastPathComponent,
              UUID(uuidString: String(input.relativePath.split(separator: ".").first ?? "")) != nil,
              input.byteCount > 0, input.sha256.count == 64 else { throw FileStageError.invalidIdentity }
        let url = root.appendingPathComponent(input.relativePath)
        let attrs = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard attrs.isRegularFile == true, attrs.isSymbolicLink != true,
              attrs.fileSize.map(Int64.init) == input.byteCount else { throw FileStageError.invalidIdentity }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            try token.check()
            hash.update(data: data)
        }
        guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == input.sha256 else { throw FileStageError.invalidIdentity }
        try token.check()
        return url
    }
}
