#!/usr/bin/env python3
"""Deterministic Xcode project; no XcodeGen, CocoaPods or remote dependencies."""
import hashlib
import json
from pathlib import Path

IOS = Path(__file__).resolve().parents[1]
PROJECT = IOS / "SubSync2Background.xcodeproj"
PROJECT.mkdir(exist_ok=True)

def uid(label):
    return hashlib.sha256(label.encode()).hexdigest()[:24].upper()

def q(value):
    return json.dumps(value, ensure_ascii=False)

objects = []
def obj(label, body):
    objects.append(f"\t\t{uid(label)} = {{ {body} }};")
    return uid(label)

sources = ["App/Telemetry.swift", "App/BackgroundController.swift", "App/SubSync2BackgroundApp.swift"]
sources += json.loads((IOS / "native-sources.json").read_text())
sources += json.loads((IOS / "media-sources.json").read_text())
resources = ["../LICENSE", "../THIRD_PARTY_NOTICES.md", "LanguageAssets"]
refs, builds, resource_builds = [], [], []
for path in sources + resources + ["App/Info.plist", "Native/include/SubSyncNative.h"]:
    kind = "folder" if path == "LanguageAssets" else "sourcecode.swift" if path.endswith(".swift") else "sourcecode.cpp.cpp" if path.endswith(".cpp") else "text"
    ref = obj(path, f"isa = PBXFileReference; lastKnownFileType = {q(kind)}; path = {q(path)}; sourceTree = SOURCE_ROOT;")
    refs.append(ref)
    if path in sources or path in resources:
        build = obj("build:" + path, f"isa = PBXBuildFile; fileRef = {ref};")
        (builds if path in sources else resource_builds).append(build)

product = obj("product", 'isa = PBXFileReference; explicitFileType = wrapper.application; path = SubSync2Background.app; sourceTree = BUILT_PRODUCTS_DIR;')
obj("rootGroup", f"isa = PBXGroup; children = ({','.join(refs + [uid('products')])}); sourceTree = \"<group>\";")
obj("products", f"isa = PBXGroup; children = ({product}); name = Products; sourceTree = \"<group>\";")
obj("sources", f"isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({','.join(builds)}); runOnlyForDeploymentPostprocessing = 0;")
obj("resources", f"isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({','.join(resource_builds)}); runOnlyForDeploymentPostprocessing = 0;")
obj("localPackage", 'isa = XCLocalSwiftPackageReference; relativePath = BackgroundCore;')
obj("coreProduct", f'isa = XCSwiftPackageProductDependency; package = {uid("localPackage")}; productName = BackgroundCore;')
obj("coreBuild", f'isa = PBXBuildFile; productRef = {uid("coreProduct")};')
obj("frameworks", f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({uid("coreBuild")}); runOnlyForDeploymentPostprocessing = 0;')

for mode in ("Debug", "Release"):
    project_settings = {
        "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++14", "CLANG_CXX_LIBRARY": "libc++",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES", "IPHONEOS_DEPLOYMENT_TARGET": "26.0",
        "SDKROOT": "iphoneos", "SWIFT_VERSION": "6.0",
        "SWIFT_STRICT_CONCURRENCY": "complete",
        "SWIFT_OPTIMIZATION_LEVEL": "-O" if mode == "Release" else "-Onone",
        "GCC_OPTIMIZATION_LEVEL": "2" if mode == "Release" else "0",
    }
    target_settings = {
        "PRODUCT_BUNDLE_IDENTIFIER": "media.alexlab.subsync2.backgroundlab",
        "PRODUCT_NAME": "SubSync2Background", "INFOPLIST_FILE": "App/Info.plist",
        "GENERATE_INFOPLIST_FILE": "NO", "TARGETED_DEVICE_FAMILY": "1,2",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "CODE_SIGN_STYLE": "Automatic", "SWIFT_OBJC_BRIDGING_HEADER": "Native/include/SubSyncBridge.h",
        "SUBSYNC_SOURCE_COMMIT": "working-tree",
        "NATIVE_MEDIA_PREFIX": "$(SRCROOT)/vendor/$(PLATFORM_NAME)-$(CURRENT_ARCH)",
        "HEADER_SEARCH_PATHS": ["$(inherited)", "$(SRCROOT)/../gizmo", "$(NATIVE_MEDIA_PREFIX)/include", "$(NATIVE_MEDIA_PREFIX)/include/sphinxbase", "$(NATIVE_MEDIA_PREFIX)/include/pocketsphinx"],
        "LIBRARY_SEARCH_PATHS": ["$(inherited)", "$(NATIVE_MEDIA_PREFIX)/lib"],
        "OTHER_LDFLAGS": ["$(inherited)", "-lpocketsphinx", "-lsphinxbase", "-lavformat", "-lavcodec", "-lswresample", "-lavutil", "-lm", "-lz", "-liconv"],
        # Existing canonical headers rely on a transitive cstdint include; do
        # not modify the browser's source or algorithm for this build adapter.
        "OTHER_CPLUSPLUSFLAGS": ["$(inherited)", "-include", "cstdint", "-include", "cmath"],
        "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
    }
    for scope, settings in (("project", project_settings), ("target", target_settings)):
        entries = []
        for key, value in settings.items():
            val = "(" + ",".join(map(q, value)) + ")" if isinstance(value, list) else q(value)
            entries.append(f"{key} = {val};")
        obj(f"{scope}:{mode}", f'isa = XCBuildConfiguration; buildSettings = {{ {" ".join(entries)} }}; name = {mode};')
for scope in ("project", "target"):
    obj(scope + "Configs", f'isa = XCConfigurationList; buildConfigurations = ({uid(scope + ":Debug")},{uid(scope + ":Release")}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')

obj("target", f'isa = PBXNativeTarget; buildConfigurationList = {uid("targetConfigs")}; buildPhases = ({uid("sources")},{uid("frameworks")},{uid("resources")}); buildRules = (); dependencies = (); name = SubSync2Background; productName = SubSync2Background; productReference = {product}; productType = "com.apple.product-type.application"; packageProductDependencies = ({uid("coreProduct")});')
obj("project", f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2600; }}; buildConfigurationList = {uid("projectConfigs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = ro; hasScannedForEncodings = 0; knownRegions = (ro,en,Base); mainGroup = {uid("rootGroup")}; productRefGroup = {uid("products")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")}); packageReferences = ({uid("localPackage")});')

text = '// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n'
text += "\n".join(objects) + f'\n}}; rootObject = {uid("project")}; }}\n'
(PROJECT / "project.pbxproj").write_text(text)
schemes = PROJECT / "xcshareddata/xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
buildable = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid("target")}" BuildableName="SubSync2Background.app" BlueprintName="SubSync2Background" ReferencedContainer="container:SubSync2Background.xcodeproj"/>'
(schemes / "SubSync2Background.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{buildable}</BuildActionEntry></BuildActionEntries></BuildAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable}</BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable}</BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/>
 <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print("Generated ios/SubSync2Background.xcodeproj")
