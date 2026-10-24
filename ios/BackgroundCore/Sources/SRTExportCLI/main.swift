import BackgroundCore
import Foundation

struct Fit: Decodable { let a: Double; let b: Double }
struct Result: Decodable {
    let done: Bool; let correlated: Bool; let points: Int; let factor: Double
    let maxDistance: Double; let cueCount: Int; let formula: Fit
}
do {
    let args = CommandLine.arguments
    guard args.count == 4 else { throw SRTError.invalidStructure }
    let status = try JSONDecoder().decode(Result.self, from: Data(contentsOf: URL(fileURLWithPath: args[2])))
    guard status.done, status.correlated, status.points >= 20, status.factor >= 0.9999,
          status.maxDistance <= 2 else { throw SRTError.invalidFormula }
    let document = try SRTDocument(data: Data(contentsOf: URL(fileURLWithPath: args[1])))
    guard document.cueCount == status.cueCount else { throw SRTError.invalidStructure }
    let output = try document.applying(a: status.formula.a, b: status.formula.b)
    try output.write(to: URL(fileURLWithPath: args[3]), options: .atomic)
} catch {
    FileHandle.standardError.write(Data("SRT export refused\n".utf8))
    exit(2)
}
