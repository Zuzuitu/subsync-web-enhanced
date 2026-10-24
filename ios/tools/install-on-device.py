#!/usr/bin/env python3
"""Build, sign and install using YOUR already-authorized Xcode team/device.

No credentials, certificates or profiles are read into this script or committed.
Xcode and the local Keychain perform signing. This does not publish to TestFlight.
"""
import argparse
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--team", required=True, help="Your authorized Apple development team ID")
parser.add_argument("--device", required=True, help="Paired physical iPhone identifier from Xcode Devices")
parser.add_argument("--prepare", action="store_true", help="First build pinned native dependencies and stage assets")
args = parser.parse_args()
if platform.system() != "Darwin": parser.error("Signing/install requires macOS and Xcode, or a separate authorized IPA-signing route")
if not re.fullmatch(r"[A-Z0-9]{10}", args.team): parser.error("Invalid Apple team ID")
if not re.fullmatch(r"[A-Za-z0-9-]{8,80}", args.device): parser.error("Invalid paired device identifier")

def run(command):
    subprocess.run(command, cwd=ROOT, check=True)

if args.prepare:
    run([sys.executable, "ios/tools/build-dependencies.py", "--platform", "iphoneos", "--arch", "arm64"])
    run([sys.executable, "tests/fixtures/prepare-en-ro-assets.py"])
    run([sys.executable, "ios/tools/stage-language-assets.py"])
    run([sys.executable, "ios/tools/generate-project.py"])
if not (ROOT / "ios/LanguageAssets/assets.json").is_file():
    parser.error("Missing verified language assets. Use --prepare on the first run")
revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
run(["xcodebuild", "-project", "ios/SubSync2Background.xcodeproj", "-scheme", "SubSync2Background",
     "-configuration", "Release", "-destination", "id=" + args.device,
     "-derivedDataPath", "ios/build/signed", "DEVELOPMENT_TEAM=" + args.team,
     "CODE_SIGN_STYLE=Automatic", "CODE_SIGNING_ALLOWED=YES", "SUBSYNC_SOURCE_COMMIT=" + revision,
     "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration", "build"])
app = ROOT / "ios/build/signed/Build/Products/Release-iphoneos/SubSync2Background.app"
if not (app / "embedded.mobileprovision").is_file():
    raise SystemExit("No development provisioning profile; installation is not attempted")
run(["codesign", "--verify", "--deep", "--strict", str(app)])
bundle = plistlib.loads((app / "Info.plist").read_bytes())["CFBundleIdentifier"]
run(["xcrun", "devicectl", "device", "install", "app", "--device", args.device, str(app)])
run(["xcrun", "devicectl", "device", "process", "launch", "--device", args.device,
     bundle])
print("Signed development app installed. Disconnect the debugger and perform the physical acceptance tests.")
