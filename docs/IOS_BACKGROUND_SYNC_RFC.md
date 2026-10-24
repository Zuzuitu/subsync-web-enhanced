# RFC: procesare reală în fundal pentru SubSync2 pe iOS 26+

**Status: native CPU PoC implemented and Xcode builds verified in PR #97; physical runtime proof and media synchronization integration pending.** This is not a shipped iPhone feature. Priority P0 ahead of the EN-audio / RO-subtitle precision roadmap; see docs/PROJECT_STATE.md. Main production PWA remains unchanged.

## User-visible target

User selects a local English-language MKV/MKA/MP4 and Romanian SRT from iOS Files, explicitly starts synchronization, switches to another iOS app (or locks the screen), sees truthful native system progress, and later retrieves a correct SRT with Romanian characters preserved. On interruption/cancellation, no partial or corrupted output is presented as complete.

## Platform facts and constraints

- WebKit conserves power and may suspend background iOS tabs/pages/JavaScript. PWA installation, Web Workers, Service Workers, web Background Sync and media playback hacks do **not** provide guaranteed continuous long-running CPU/WebAssembly processing.
- iOS 26+ adds Apple's native BackgroundTasks `BGContinuedProcessingTaskRequest` / `BGContinuedProcessingTask`, designed for explicitly user-started long tasks and potentially presenting progress in a system Live Activity. Source: https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados and https://developer.apple.com/videos/play/wwdc2025/227/
- The OS can expire/cancel tasks for memory/energy/system pressure; force-quitting app may cancel the running task. BGTask is not a perpetual-execution promise. Test actual device behavior.
- `BGContinuedProcessingTask` protects **native task work**. It does not establish that a `WKWebView` or WebAssembly web worker remains runnable when hidden. A native Swift wrapper around the existing PWA is a research experiment at best; do not call it a solution without background completion evidence.
- Native iOS development, code signing, entitlements, bundle ID, Background Modes and physical-install testing require Apple tooling/permissions. No iOS native project/IPA is confirmed by this RFC.

## Candidates, evaluated in order

1. **A (preferred to investigate): a first-party native iOS execution engine**, started through `BGContinuedProcessingTask` on iOS 26+. Reuse pinned sc0ty/SubSync2 native components where licensed/technically possible. Keep PWA as the stable UI/product; a minimal SwiftUI/FileImporter or WKWebView UI may control a genuinely native background engine, with explicit local bridging. Porting the canonical JS correlation logic may be significant. First inventory source and licensing and prove native-parity on the pinned EN->RO fixture.
2. **B (short-term mitigation, not true background): checkpoint or safe pause/resume on the PWA**, with user-visible explanation on app switch and reliable resumption when reopened. Investigate whether file handles and recognition state can be recreated safely on iOS; do not advertise continuous execution. Avoid storing large copyrighted source media transparently if it violates storage/privacy expectations.
3. **C (optional architectural change, separate user approval): process on user-controlled Rock64** and retrieve results later, with end-to-end progress and retention/cleanup. Requires explicit choice to upload private movie/audio or a derived audio track. This changes the current local-only privacy policy and may be too costly for large files/limited ARM performance; do not enable automatically.

## Phase gates (no fictional implementation)

### 0. Baseline and compatibility
- Read docs/PROJECT_STATE.md, config/project-invariants.json and AGENTS.md, then inventory actual source paths. Identify exact EN->RO code path: MKV demux/decoder, PocketSphinx speech model, English/Romanian dictionary, correlator, SRT export and progress callbacks. Locate existing synthetic EN->RO fixture and output metrics. Compare with upstream only where useful.
- Check which native libraries can build for arm64 iOS with acceptable license constraints, and whether canonical JS behavior can be reused outside WKWebView. No duplicate unmaintained algorithm fork without a parity strategy.

### 1. Real background runtime proof
- Build a minimal native iOS 26+ prototype: user taps Start, creates BGContinuedProcessingTaskRequest with correct permitted IDs/capabilities, processes incremental CPU work and updates Progress/Live Activity, tracks expiration and cancellation.
- Demonstrate on a **physical iPhone** that true CPU work progresses after switching to another app and locking screen for 5–15 minutes; distinguish launched, running, suspended, expired, user canceled, force quit and device-lock states. State actual elapsed/completion evidence; CI/macOS compilation alone is insufficient.
- If testing WebKit Worker as an alternative, measure monotonic CPU work from inside the worker while backgrounded. If it stalls, reject the approach and keep native worker path.

### 2. Genuine SubSync2 engine parity
- Import file(s) using Files with security-scoped access / protected persistence; never rely on ephemeral picker URLs for deferred work. Process exact EN audio -> RO SRT, without cloud upload.
- Run the same **known-ground-truth** synthetic fixture through the browser baseline and native processor; compare full-title errors (median, P95, max, thirds, drift), cue counts, text and diacritics, and deterministic handling. Maintain existing canonical acceptance/save gates. Never use the expected shift during estimation.
- Prove 1:1 or quantify differences. If not comparable, do not silently substitute a weaker synchronizer.

### 3. Durable lifecycle
- Local persisted job records: queued/running/paused/needs-reselect/completed/failed/cancelled; input identity/checksum or safe file locator; temporary output using atomic rename; checkpoint format and algorithm version; progress not based on guessed timer; minimal privacy-preserving diagnostics.
- Implement idempotent start, cancel, expiration, retry, app restart, lost security-scoped access, storage low, memory pressure, offline (after resources are pinned) and force quit behavior. Resume only from proven safe checkpoints; otherwise restart from beginning transparently.
- Only show completion/success after SRT fully exported and passed basic structural checks. Preserve original SRT bytes and processed state separately.

### 4. Release and rollback
- Build with Xcode / macOS runner; add CI for native unit/parity tests. Sign/distribute only with authorized Apple credentials. Test a signed build physically on iOS 26+ before any promise of compatibility. Do not change or deploy the existing web origin while native path remains experimental.
- Explicit opt-in user experience; no fake background mode, silent audio loops, push tricks, unlimited execution promises or automatic media upload.

## Work ordering and continuation

Start with feasibility/PoC (native BGContinuedProcessingTask + actual background CPU), then engine parity, then durable job queue and UI. After implementing and validating this P0 objective or reaching a documented limitation, resume the unchanged roadmap: PR #94 full-title EN->RO quality metrics; read-only evidence; scene/edition detection; preview; carefully gated piecewise correction; speed; memory; minor functionality. Every run updates the top of PROJECT_STATE.md with actual PR/SHA/CI/next step.

## Outstanding implementation blockers at RFC creation

- No verified signed iOS app or physical iPhone background task run.
- No verified parity between the current PWA's English PocketSphinx/dictionary/JS correlation stack and any native arm64 iOS runner.
- GitHub connector in this chat supports repository PR/code operations, not physical iPhone installation or Apple code signing without additional environment.

