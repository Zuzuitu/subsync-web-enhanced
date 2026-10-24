// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BackgroundCore",
    platforms: [.macOS(.v14), .iOS("26.0")],
    products: [.library(name: "BackgroundCore", targets: ["BackgroundCore"])],
    targets: [
        .target(name: "BackgroundCore"),
        .testTarget(name: "BackgroundCoreTests", dependencies: ["BackgroundCore"])
    ]
)
