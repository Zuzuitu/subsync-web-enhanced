#!/usr/bin/env python3
"""Apply exactly one decoder-0 RNG reset to prepared, pinned whisper.cpp v1.5.4.

This is a narrow SubSync2 issue #111 *candidate* fix, not an upstream change.
The PWA remains local. A test must confirm original RED and candidate GREEN.
"""
import argparse
from pathlib import Path

ANCHOR = (
    "    // TAGS: WHISPER_DECODER_INIT\n"
    "    for (int j = 1; j < n_decoders; j++) {"
)
INJECTION = (
    "    // SubSync2 #111 candidate: reset decoder 0's RNG for each independent\n"
    "    // whisper_full() call. no_context clears prompt tokens, not this RNG.\n"
    "    state->decoders[0].rng = std::mt19937(0);\n\n"
)
def patch_text(source: str) -> str:
    if source.count(ANCHOR) != 1 or INJECTION.strip() in source:
        raise RuntimeError("Pinned Whisper RNG anchor absent, duplicated or already patched")
    # Require both the exact pinned default seed and no_context prompt reset.
    if source.count("state->decoders[0].rng = std::mt19937(0);") != 1:
        raise RuntimeError("Unexpected decoder-0 initial RNG seed")
    if "if (params.no_context) {\n        prompt_past.clear();" not in source:
        raise RuntimeError("Unexpected pinned no_context semantics")
    return source.replace(ANCHOR, INJECTION + ANCHOR, 1)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    args = parser.parse_args()
    destination = Path(args.file)
    if destination.name != "whisper.cpp" or not destination.is_file():
        parser.error("Expected existing prepared whisper.cpp")
    original = destination.read_text(encoding="utf-8")
    patched = patch_text(original)
    destination.write_text(patched, encoding="utf-8")
    print("Applied one decoder-0 RNG reset to isolated prepared Whisper; candidate only")

if __name__ == "__main__":
    main()
