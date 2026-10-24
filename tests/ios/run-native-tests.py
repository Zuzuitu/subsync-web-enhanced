#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "ios"
sources = json.loads((IOS / "native-sources.json").read_text())
with tempfile.TemporaryDirectory(prefix="subsync2-native-") as directory:
    output = Path(directory) / "bridge-tests"
    subprocess.run([
        os.environ.get("CXX", "c++"), "-std=c++14", "-O2", "-Wall", "-Wextra", "-include", "cstdint",
        "-I" + str(ROOT / "gizmo"), "-I" + str(IOS / "Native/include"),
        *[str(IOS / path) for path in sources], str(ROOT / "tests/ios/native-bridge.cpp"),
        "-o", str(output)
    ], check=True)
    subprocess.run([str(output)], check=True)
