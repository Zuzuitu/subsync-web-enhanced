import Foundation

public enum SRTError: Error { case invalidUTF8, invalidStructure, invalidTiming, invalidFormula }

/// Edits only the two timestamp ranges of each cue. Labels, markup, whitespace,
/// line endings, BOM, Romanian diacritics and payload bytes stay unchanged.
public struct SRTDocument: Sendable {
    private struct Cue: Sendable {
        let startRange: NSRange
        let endRange: NSRange
        let start: Double
        let end: Double
    }
    private let text: String
    private let cues: [Cue]
    public var cueCount: Int { cues.count }

    public init(data: Data) throws {
        guard data.count <= 32 * 1024 * 1024, String(data: data, encoding: .utf8) != nil else {
            throw SRTError.invalidUTF8
        }
        // Unlike an encoding auto-detector, this keeps an existing UTF-8 BOM.
        let text = String(decoding: data, as: UTF8.self)
        let timestamp = #"\d{2,}:\d{2}:\d{2},\d{3}"#
        let pattern = #"(?:\A\uFEFF?|\r?\n[ \t]*\r?\n)([0-9]+)[ \t]*\r?\n("#
            + timestamp + #")([ \t]+-->[ \t]+)("# + timestamp + #")([^\r\n]*)(?:\r?\n|\z)"#
        let regex = try NSRegularExpression(pattern: pattern)
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        var cues: [Cue] = []
        for match in matches {
            let startRange = match.range(at: 2), endRange = match.range(at: 4)
            guard let first = Range(startRange, in: text), let last = Range(endRange, in: text) else {
                throw SRTError.invalidStructure
            }
            let start = try Self.seconds(String(text[first]))
            let end = try Self.seconds(String(text[last]))
            guard end > start else { throw SRTError.invalidTiming }
            cues.append(Cue(startRange: startRange, endRange: endRange, start: start, end: end))
        }
        // Every nonempty standard SRT block must be understood. A malformed cue
        // must not silently disappear or get left with uncorrected timestamps.
        let split = try NSRegularExpression(pattern: #"\r?\n[ \t]*\r?\n"#)
        let marked = split.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "\u{0}")
        let blocks = marked.split(separator: "\u{0}").filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !cues.isEmpty, cues.count == blocks.count else { throw SRTError.invalidStructure }
        self.text = text
        self.cues = cues
    }

    public func applying(a: Double, b: Double) throws -> Data {
        guard a.isFinite, b.isFinite, a > 0 else { throw SRTError.invalidFormula }
        var result = text
        // Reverse-order UTF-16 ranges remain valid as later replacements grow.
        for cue in cues.reversed() {
            for (range, time) in [(cue.endRange, cue.end), (cue.startRange, cue.start)] {
                let mapped = max(0, a * time + b)
                guard mapped.isFinite, mapped < 1_000_000_000,
                      let replacement = Range(range, in: result) else { throw SRTError.invalidFormula }
                result.replaceSubrange(replacement, with: Self.timestamp(mapped))
            }
        }
        let data = Data(result.utf8)
        let verified = try SRTDocument(data: data)
        // Clamping can produce a zero-length cue. Refuse instead of exporting
        // a malformed output; never delete its text to make validation succeed.
        guard verified.cueCount == cueCount else { throw SRTError.invalidStructure }
        return data
    }

    private static func seconds(_ value: String) throws -> Double {
        let parts = value.split(whereSeparator: { $0 == ":" || $0 == "," }).compactMap(Double.init)
        guard parts.count == 4, parts.allSatisfy(\.isFinite), parts[1] < 60, parts[2] < 60 else {
            throw SRTError.invalidTiming
        }
        return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000
    }

    private static func timestamp(_ time: Double) -> String {
        // Same positive-time floor/modulo semantics as web/src/subtitle.js.
        let hours = Int(floor(time / 3600))
        let minutes = Int(floor((time / 60).truncatingRemainder(dividingBy: 60)))
        let seconds = Int(floor(time.truncatingRemainder(dividingBy: 60)))
        let millis = Int(floor((time * 1000).truncatingRemainder(dividingBy: 1000)))
        return String(format: "%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
    }
}
