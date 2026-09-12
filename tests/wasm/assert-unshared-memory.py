#!/usr/bin/env python3
import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("wasm")
args = parser.parse_args()
data = Path(args.wasm).read_bytes()

if data[:4] != b"\x00asm":
    raise SystemExit("Not a WebAssembly binary")

pos = 8

def read_u32():
    global pos
    value = 0
    shift = 0
    while True:
        if pos >= len(data):
            raise SystemExit("Unexpected EOF while reading LEB128")
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return value
        shift += 7
        if shift > 35:
            raise SystemExit("Invalid LEB128")

def skip_name():
    global pos
    size = read_u32()
    pos += size

def read_limits():
    flags = read_u32()
    minimum = read_u32()
    maximum = read_u32() if flags & 0x1 else None
    return flags, minimum, maximum

memories = []
while pos < len(data):
    section_id = data[pos]
    pos += 1
    section_size = read_u32()
    section_end = pos + section_size
    if section_end > len(data):
        raise SystemExit("Malformed WebAssembly section length")

    if section_id == 2:
        count = read_u32()
        for _ in range(count):
            skip_name()
            skip_name()
            kind = data[pos]
            pos += 1
            if kind == 0:
                read_u32()
            elif kind == 1:
                pos += 1
                read_limits()
            elif kind == 2:
                flags, minimum, maximum = read_limits()
                memories.append(("import", flags, minimum, maximum))
            elif kind == 3:
                pos += 2
            else:
                raise SystemExit(f"Unsupported WASM import kind {kind}")
    elif section_id == 5:
        count = read_u32()
        for _ in range(count):
            flags, minimum, maximum = read_limits()
            memories.append(("defined", flags, minimum, maximum))

    pos = section_end

if not memories:
    raise SystemExit("No WebAssembly memory declaration/import found")

shared = [item for item in memories if item[1] & 0x2]
if shared:
    raise SystemExit(f"Shared WebAssembly memory detected: {shared}")

print({
    "status": "pass",
    "wasm": args.wasm,
    "memories": memories,
    "sharedMemory": False,
})
