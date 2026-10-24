// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BackgroundCore",
    platforms: [.macOS(.v14), .iOS("26.0")],
    products: [.library(name: "BackgroundCore", targets: ["BackgroundCore"]),
               .executable(name: "srt-export", targets: ["SRTExportCLI"])],
    targets: [
        .target(name: "BackgroundCore"),
        .executableTarget(name: "SRTExportCLI", dependencies: ["BackgroundCore"]),
        .testTarget(name: "BackgroundCoreTests", dependencies: ["BackgroundCore"])
    ]
)
