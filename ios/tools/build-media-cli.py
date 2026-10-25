#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "ios"
parser = argparse.ArgumentParser()
parser.add_argument("--prefix", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
prefix = args.prefix.resolve()
sources = json.loads((IOS / "native-sources.json").read_text()) + json.loads((IOS / "media-sources.json").read_text())
args.output.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(["c++", "-std=c++14", "-O2", "-include", "cstdint", "-include", "cmath",
    "-I" + str(ROOT / "gizmo"), "-I" + str(IOS / "Native/include"),
    "-I" + str(prefix / "include"), "-I" + str(prefix / "include/sphinxbase"),
    "-I" + str(prefix / "include/pocketsphinx"),
    *[str(IOS / path) for path in sources], str(ROOT / "tests/ios/media-cli.cpp"),
    "-L" + str(prefix / "lib"), "-lpocketsphinx", "-lsphinxbase", "-lavformat", "-lavcodec", "-lswresample", "-lavutil",
    "-lm", "-lz", "-liconv", "-o", str(args.output)], check=True)
