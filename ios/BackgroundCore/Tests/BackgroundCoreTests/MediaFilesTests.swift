import Foundation
import XCTest
@testable import BackgroundCore

final class MediaFilesTests: XCTestCase {
    func testSandboxRootAliasAndCanonicalChildResolveToSameAsset() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let actual = temporary.appendingPathComponent("real/speech")
        try FileManager.default.createDirectory(at: actual, withIntermediateDirectories: true)
        let model = actual.appendingPathComponent("model.bin")
        try Data([1, 2, 3]).write(to: model)
        let alias = temporary.appendingPathComponent("alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: actual.deletingLastPathComponent())
        let resolver = AssetPathResolver(root: alias)
        XCTAssertEqual(try resolver.resolve("speech/model.bin"), model.standardizedFileURL.resolvingSymlinksInPath())
    }

    func testAssetTraversalAndEscapingSymlinkAreRejected() throws {
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let root = temporary.appendingPathComponent("assets")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let outside = temporary.appendingPathComponent("outside.bin")
        try Data([1]).write(to: outside)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape.bin"), withDestinationURL: outside)
        let resolver = AssetPathResolver(root: root)
        XCTAssertThrowsError(try resolver.resolve("../outside.bin"))
        XCTAssertThrowsError(try resolver.resolve("escape.bin"))
        XCTAssertThrowsError(try resolver.resolve(outside.path))
    }

    func testOnlyTimestampBytesChangeIncludingBOMCRLFAndDiacritics() throws {
        let source = "\u{FEFF}7\r\n00:00:18,000 --> 00:00:20,000 X1:2\r\n<i>Știință, țară, împreună</i>\r\n\r\n9\r\n00:02:18,000 --> 00:02:21,000\r\nAcelași text! ăâîșț\r\n"
        let expected = source.replacingOccurrences(of: "00:00:18,000", with: "00:00:10,000")
            .replacingOccurrences(of: "00:00:20,000", with: "00:00:12,000")
            .replacingOccurrences(of: "00:02:18,000", with: "00:02:10,000")
            .replacingOccurrences(of: "00:02:21,000", with: "00:02:13,000")
        let document = try SRTDocument(data: Data(source.utf8))
        XCTAssertEqual(document.cueCount, 2)
        XCTAssertEqual(try document.applying(a: 1, b: -8), Data(expected.utf8))
    }

    func testRealDriftIsAppliedAndTextNeverSuppliesGroundTruth() throws {
        let input = Data("1\n00:10:00,000 --> 00:10:04,000\nText\n".utf8)
        let document = try SRTDocument(data: input)
        let output = String(decoding: try document.applying(a: 1.04, b: 2), as: UTF8.self)
        XCTAssertTrue(output.contains("00:10:26,000 --> 00:10:30,160"))
    }

    func testMalformedCueOrInvalidUTF8NeverSilentlyDisappears() throws {
        XCTAssertThrowsError(try SRTDocument(data: Data([0xff, 0xfe])))
        let source = "1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\nwrong timestamp\nȘță\n"
        XCTAssertThrowsError(try SRTDocument(data: Data(source.utf8)))
        XCTAssertThrowsError(try SRTDocument(data: Data("1\n00:99:00,000 --> 00:99:01,000\nA".utf8)))
    }

    func testInvalidFormulaAndCollapsedCueRefuseExport() throws {
        let document = try SRTDocument(data: Data("1\n00:00:01,000 --> 00:00:02,000\nText".utf8))
        XCTAssertThrowsError(try document.applying(a: .nan, b: 0))
        XCTAssertThrowsError(try document.applying(a: -1, b: 0))
        XCTAssertThrowsError(try document.applying(a: 1, b: -100))
    }

    func testStagingLargeInputIsBoundedChecksummedAndCancellationCleansPartial() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source.mkv")
        try Data(repeating: 0x5a, count: 3 * 1024 * 1024).write(to: source)
        let stager = try FileStager(root: root.appendingPathComponent("inputs"))
        let token = StopToken()
        XCTAssertThrowsError(try stager.stage(source, kind: .media, token: token, availableBytes: Int64.max) { _, _ in
            token.requestStop(.userCancelled)
        })
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: stager.root.path).isEmpty)
        let input = try stager.stage(source, kind: .media, token: StopToken(), availableBytes: Int64.max)
        let staged = try stager.verifiedURL(input, token: StopToken())
        XCTAssertEqual(input.byteCount, 3 * 1024 * 1024)
        try FileManager.default.removeItem(at: source) // picker URL no longer needed
        XCTAssertEqual(try stager.verifiedURL(input, token: StopToken()), staged)
        try Data([1]).write(to: staged)
        XCTAssertThrowsError(try stager.verifiedURL(input, token: StopToken()))
    }

    func testInsufficientSpaceAndSymlinksFailBeforeCopy() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("sub.srt")
        try Data("1\n00:00:01,000 --> 00:00:02,000\nȚară\n".utf8).write(to: source)
        let stager = try FileStager(root: root.appendingPathComponent("inputs"))
        XCTAssertThrowsError(try stager.stage(source, kind: .subtitle, token: StopToken(), availableBytes: 1))
        let link = root.appendingPathComponent("link.srt")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
        XCTAssertThrowsError(try stager.stage(link, kind: .subtitle, token: StopToken(), availableBytes: Int64.max))
    }
}
