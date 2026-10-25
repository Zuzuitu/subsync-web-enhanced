# Offline SRT pair audit — original versus known shifted reference

This is a **local, read-only** tool for validating a reference SRT pair before evaluating SubSync2's timing on a soundtrack.

```sh
node scripts/audit-srt-pair.js /private/Original.srt /private/Decalare.srt
```

Both SRTs remain on the caller's machine. No media file is opened, no network request is made, and the console JSON contains **no filenames, dialogue, cue payloads or file paths**. This command only reports source cue counts, exact per-cue time deltas, whether text/indices and durations match, chronological thirds, and whether one constant offset explains **all** starts and ends. The checker rejects unparsable timestamps, missing or reordered cues, changed subtitle text, empty cues or differing cue counts instead of aligning by index speculatively. Nonuniform shifts are reported as observations, **not** as proof of a film cut.

## Interpretation

- `singleExactShiftMs: 10000` means **Decalare.srt is 10 seconds later** than Original.srt in every cue. A transformation of -10,000 ms restores the original timestamps byte-for-byte at millisecond precision for matching timing lines; media timing is **not** independently verified.
- `audioReferenceChecked: false` and `alignmentWithSoundtrackVerified: false` must **never** be overwritten from this script's results. A file named Original.srt is not automatically accurate ground truth for the soundtrack.
- `singleExactShiftMs: null` means the two files have nonuniform timestamp changes, *not* that a cut, drift or soundtrack mismatch is confirmed.
- Further validation requires running the unchanged canonical engine on the **corresponding soundtrack**, exporting an SRT and comparing the output against an independently verified reference. The actual soundtrack language and edition must be checked, not inferred from a file name.

This research helper is **not imported into the PWA or WASM synchronization path** and must never alter canonical sc0ty thresholds, dictionary/model inventories, Save eligibility, or user media processing. No private media, dialogue, SRT files or title-specific offsets are committed to the public repository.

Test coverage: `node tests/js/audit-srt-pair.js`. Tests use small synthetic subtitles only.
