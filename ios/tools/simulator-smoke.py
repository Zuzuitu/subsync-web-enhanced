#!/usr/bin/env python3
"""Launch/render the actual app. Simulator evidence never proves phone background."""
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "ios/build"
APP = BUILD / "simulator/Build/Products/Release-iphonesimulator/SubSync2Background.app"
BUNDLE = "media.alexlab.subsync2.backgroundlab"

def run(*args, timeout=180):
    result = subprocess.run(["xcrun", "simctl", *args], text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result.stdout

devices = json.loads(run("list", "devices", "available", "--json"))["devices"]
selected = [(runtime, device) for runtime, items in devices.items() if "iOS-26" in runtime
            for device in items if device.get("isAvailable") and "iPhone" in device["name"]]
if not selected: raise SystemExit("No available iOS 26 iPhone simulator runtime")
runtime, device = selected[0]
identifier = device["udid"]
if device["state"] != "Booted": run("boot", identifier)
run("bootstatus", identifier, "-b")
run("install", identifier, str(APP))
launch = run("launch", "--terminate-running-process", identifier, BUNDLE)
time.sleep(3)
processes = run("spawn", identifier, "launchctl", "list")
(BUILD / "simulator-processes.log").write_text(processes)
assert BUNDLE in processes, "The app exited/crashed after launch"
run("io", identifier, "screenshot", str(BUILD / "native-simulator.png"))
(BUILD / "simulator-smoke.json").write_text(json.dumps({
    "scope": "simulator app launch/render only; no physical/background synchronization proof",
    "runtime": runtime, "device": device["name"], "launch": launch.strip(),
    "processAlive": True, "screenshot": "native-simulator.png"
}, indent=2) + "\n")
run("terminate", identifier, BUNDLE)
print("Simulator app installed, launched, remained alive and rendered a screenshot")
