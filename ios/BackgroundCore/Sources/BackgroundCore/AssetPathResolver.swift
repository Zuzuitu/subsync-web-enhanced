import Foundation

/// Canonicalize BOTH sides of a resource containment check. Apple sandbox
/// paths may use /var aliases while resolving a child produces /private/var.
public struct AssetPathResolver: Sendable {
    public let root: URL
    public init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    }
    public func resolve(_ relative: String) throws -> URL {
        guard !relative.isEmpty, !relative.hasPrefix("/") else { throw FileStageError.invalidIdentity }
        return try contained(root.appendingPathComponent(relative))
    }
    public func contained(_ url: URL) throws -> URL {
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        guard canonical.path.hasPrefix(root.path + "/") else { throw FileStageError.invalidIdentity }
        return canonical
    }
}
