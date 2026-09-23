# SubSync2 — Project State

LAST_UPDATED: 2026-09-23

## Canonical status

This file is the human-readable technical checkpoint for SubSync2.
Repository truth overrides chat memory. Before material changes, read in this order:
1. `docs/PROJECT_STATE.md`
2. `config/project-invariants.json`
3. `AGENTS.md`
4. relevant current implementation

Do not rely on a checkpoint-pinned `main` SHA without reading the repository at session start.

## 2026-09-23 — Physical Smallfoot timing evidence and retained-fit fix candidate

The supplied diagnostic is from exact runtime `2cca78a6e57d831935a310fe71aa855902fe0bcb`.
All 1517 exported cues match the preferred original text and order. Output
minus preferred-original start time: mean -519.2 ms, MAE 519.5 ms, p95
absolute 942 ms, maximum absolute 999 ms. Beginning/middle/end title-third
medians are -848/-510/-206.5 ms. The difference is almost exactly affine:
`output - original = -1.00416 + 0.000189069 * originalTime` seconds, maximum
fit residual about 0.51 ms after SRT rounding. The diagnostic's canonical
formula is `1.000211954x-11.138036`; cue-balanced export formula is
`1.000189066x-11.005540`. The recorded input samples agree with the original
shifted by +10 seconds. Thus the intended correction for this physical title
is `t-10`, while the recognized-match estimator picked a different intercept
and slope. The SRT pair alone cannot distinguish subtitle word-placement bias,
Whisper timestamp bias, false lexical matches or fitted-point selection.

Confirmed code issue: `getPrecisionStats()` previously called
`getUsedPoints()`, which selected all matches inside the final line's broad
distance band. A point discarded by canonical outlier pruning can still lie
inside that band and re-enter the downstream cue-balanced refinement and
jackknife. This branch feeds the exact retained canonical hits into precision
instead. Canonical acceptance, thresholds and `getUsedPoints()`'s public API
are unchanged. A native regression uses 21 cue matches, including an outlier
that gets pruned and would previously re-enter; precision must use only the 20
retained hits. The real title's exact matched words/points and audio are not
present in the user diagnostic, so this fix cannot yet be attributed to its
~1-second error or claimed to improve its physical output. No original-derived
offset or slope is shipped in the product.

## 2026-09-20 — PR #60 Romanian Whisper special-token leak fix

PR #60 root-cause work started from the deployed PR #58 runtime after the exact
physical Smallfoot retest proved that cue-balanced refinement was beneficial but
incomplete. On that real iPhone/Chrome run:
- runtime hash matched `2fe4b96be83cec621eceb67ac3ba356850f76a3c`;
- refinement was available and applied;
- all 1517 cue timings remained structurally valid;
- refined output MAE was ~606 ms versus ~646 ms reconstructed canonical;
- p95 improved from ~1177 ms canonical to ~1100 ms refined;
- the result still retained a material affine residual, so no constant-offset
  correction was justified.

A separate deterministic Romanian fixture then reproduced a systematic residual.
Repository and retained RPC-trace inspection identified a concrete Whisper input
bug rather than a reason to weaken the synchronizer:
- pinned whisper.cpp v1.5.4 represents timestamp/task tokens with IDs at or above
  EOT and can render them as strings such as `[_TT_N]` and `[_BEG_]`;
- SubSync2 previously filtered only the newer-style textual `<|...|>` marker;
- retained deterministic PR #44 evidence showed 34/161 usable Romanian Whisper
  words (~21%) contaminated by leaked special/timestamp fragments;
- contamination could alter lexical text, word end time/duration/probability and
  cause otherwise useful matches to miss the unchanged similarity threshold.

PR #60 fixes the source boundary in `gizmo/wasm/whisper-simd.cpp`:
- token metadata is read first;
- any token with `id >= whisper_token_eot()` is excluded before it can mutate a
  lexical word;
- canonical correlation thresholds, Save verification, sampling budgets,
  midpoint semantics, cue-balanced refinement and browser-local processing are
  unchanged;
- no title/device-specific offset or paid service is introduced.

Regression/diagnostic coverage now also:
- fails Romanian E2E if any Whisper special/timestamp marker reaches an
  `addRefWord` lexical event;
- records fixture-only active-speech bounds at 0.5/1/2% peak thresholds;
- compares Whisper lexical timestamps against full-cue and active-speech
  pseudo-word timing without feeding calibration data back into product logic;
- keeps public diagnostic schema checks aligned with already-deployed
  `canonicalFormula` and `probeHistory` fields;
- resolves the newest unexpired `legacy-wasm` artifact in the fast MKV
  diagnostic instead of a stale hard-coded run ID.

Final candidate head `9d44f8a2c3245686f3e7eb31fa3b68f68abe153c` passed all five PR
workflows before this checkpoint update:
- CI: PASS;
- MKV WASM Fast Diagnostic: PASS;
- Public Pages Language Smoke: PASS;
- Romanian Identical Input Study: PASS;
- Legacy WebAssembly Build: PASS.

Fresh authoritative Romanian E2E on the candidate produced identical Chromium
and iPhone-like WebKit results:
- `whisperSpecialTokenLeakCount=0`;
- 151 reference words / 133 Romanian context anchors;
- 27 precision cue buckets, balanced 9/9/9, 87 raw matches;
- formula `0.9998x-8.173`, saved shift ~-8.177 s on the known +8 s fixture;
- start MAE ~213 ms, median absolute ~213.5 ms, p95 ~246.1 ms, max 250 ms;
- residual slope ~-161.5 ppm / drift ~-73.1 ms across the synthetic title;
- active-speech calibration median at the 1% threshold was ~-5.6 ms, which
  argues against synthesized leading/trailing silence as the dominant remaining
  timestamp bias;
- zero console, page or HTTP errors.

This is strong controlled evidence for the special-token bug fix, but physical
Smallfoot benefit must still be confirmed on the exact deployed PR #60 runtime
after merge/deploy. Do not claim physical improvement from synthetic E2E alone.

## 2026-09-19 — PR #58 merged / cue-balanced refinement deployed

Current product-code main before this documentation-only checkpoint:
`2fe4b96be83cec621eceb67ac3ba356850f76a3c`.

PR #58 `Refine verified Romanian timing with equal cue-bucket weighting`
was merged after all required gates passed on final PR head
`66b26fba9c8d8edb041e0931bca818578cb6bff0`:
- CI / governance: PASS;
- Mobile WebKit Compatibility: PASS;
- Large-file Browser Stress: PASS;
- fresh Legacy WebAssembly Build #188 / run `35469597808`: PASS;
- native synchronizer regressions: PASS;
- fresh correlator + extractor WASM build: PASS;
- Romanian Whisper SIMD build/runtime verification: PASS;
- canonical MKV matrix through browser WASM: PASS;
- English audio -> Romanian subtitles E2E: PASS;
- real PWA primary workflow: PASS;
- Romanian audio PWA workflow in Chromium: PASS;
- Romanian audio PWA workflow in iPhone-like WebKit: PASS.

Merged behavior:
- canonical sc0ty correlation, thresholds and Save verification remain unchanged;
- after verified Romanian 3/3 convergence only, precision may derive one
  centroid per retained subtitle cue bucket so each independent cue gets one
  vote in the refinement fit;
- the refinement requires duplicate raw matches, balanced title-third evidence,
  a valid cue-balanced fit that still satisfies the canonical
  correlation/max-distance gates, and <=0.75 s mapped divergence from the
  canonical formula;
- any failed guard falls back to the canonical formula;
- diagnostics now preserve the canonical formula separately when a refinement
  is applied, so physical runs can distinguish acceptance from export timing;
- no Smallfoot/+10 s constant, device offset, threshold reduction, extra audio
  sampling, piecewise correction or backend media path was added.

CI artifact reliability was also hardened:
- fast PWA, Mobile WebKit and large-file stress no longer depend on an expiring
  hard-coded workflow run ID;
- they resolve the newest unexpired repository `legacy-wasm` artifact through
  the GitHub API and then use first-party `actions/download-artifact`;
- authoritative `legacy-wasm` retention is 30 days;
- the fresh Legacy WebAssembly workflow remains the behavior merge gate.

Deliberate Pages deployment:
- `deploy/pages-preview` was fast-forwarded to
  `2fe4b96be83cec621eceb67ac3ba356850f76a3c`;
- Deploy PWA Preview #20 / run `35470220955`: PASS;
- build / wasm-build: PASS;
- deploy: PASS;
- deployed runtime:
  `2fe4b96be83cec621eceb67ac3ba356850f76a3c`.

Required next physical iPhone/Chrome Smallfoot test:
1. open the build-specific runtime
   `https://zuzuitu.github.io/subsync-web-enhanced/build-2fe4b96be83cec621eceb67ac3ba356850f76a3c.html`;
2. keep the browser foregrounded until terminal state;
3. export the synchronized SRT and `subsync2-diagnostics.json`;
4. before analyzing accuracy, require
   `runtime.hash === 2fe4b96be83cec621eceb67ac3ba356850f76a3c`;
5. inspect `canonicalFormula`, `formula`,
   `precision.refinementAvailable`, `precision.refinementApplied` and
   `precision.refinementMappedDelta`;
6. compare the saved SRT directly against the known original Smallfoot SRT;
7. compute mean signed start error, MAE, median absolute, p95 absolute,
   max absolute, title-third signed medians and full-title drift;
8. compare directly against the PR #56 physical baseline
   (MAE 646.8 ms, median absolute 635.0 ms, p95 1178.0 ms,
   max 1251.0 ms, thirds -1033/-569/-197 ms).

Do not claim a physical accuracy improvement from PR #58 until that exact-runtime
real-device test is completed. If Smallfoot improves, validate the refinement on
multiple unrelated real titles before any further estimator expansion.

## 2026-09-19 — PR #56 physical Smallfoot retest / cue-balanced refinement follow-up

Physical iPhone/Chrome retest was completed on the exact deployed PR #56 runtime
`1ac8a82d114238d98b398f65623c63be24d3da41`.

Runtime validation:
- diagnostic `runtime.hash` exactly matched the deployed PR #56 SHA;
- `outcome=completed`;
- `saveEligible=true`;
- 1517 output cues matched the uploaded original cue-for-cue and text-for-text;
- elapsed time ~1016.1 s;
- zero recorded processing errors.

Canonical convergence remained healthy:
- canonical lock first appeared at probe 20 with 20 buckets / stable 1/3;
- probe 21 added one canonical bucket and reached stable 2/3;
- late probe 22 targeted the final third but had only 3 recognized words and
  added no bucket, so stable remained 2/3;
- late probe 23 had 19 words, added one bucket, and reached verified 3/3;
- completed 23/24 probes: 16 primary + 5 rescue + 2 late confirmation;
- canonical/candidate span ~75.8387%;
- final factor ~0.9999994366;
- final maxDistance ~1.7676 s;
- final formula `a=1.0002379417419434`,
  `b=-11.258645057678223`;
- final precision distribution improved from the previous 8/9/5 to 8/8/6;
- 27 retained raw matches still represented only 22 independent cue buckets.

Direct cue-by-cue comparison against the uploaded original Smallfoot SRT:
- mean signed start error: -646.5 ms;
- median signed start error: -635.0 ms;
- MAE: 646.8 ms;
- median absolute error: 635.0 ms;
- p95 absolute error: 1178.0 ms;
- max absolute error: 1251.0 ms;
- title-third signed medians: -1033 / -569 / -197 ms;
- first cue: -1251 ms;
- final cue: +116 ms;
- residual affine slope ~+237.94 ppm across the title.

Compared with physical runtime
`ae75206e3991912affaee2bbdf4116033d128f57`:
- MAE regressed by ~40.8 ms (606.0 -> 646.8 ms);
- median absolute error regressed by ~50.9 ms;
- mean signed error became ~48.8 ms more negative;
- p95 improved by ~27.7 ms;
- max absolute error improved by ~38.3 ms;
- affine slope improved from ~272.27 ppm to ~237.94 ppm;
- beginning/middle medians improved modestly, while the final-third median
  regressed by ~50.3 ms.

Conclusion: PR #56 did what it was designed to do as an evidence scheduler, but
better 8/8/6 third balance did not improve aggregate physical accuracy. This
rules out "just collect one more late window" as the next fix. The direct
original/output residual remains almost purely affine, so there is no evidence
from this controlled title that piecewise/cut handling is the immediate answer.

Repository inspection identified a fitting inconsistency that is now the next
target. Canonical acceptance counts independent subtitle cue buckets, and
precision/jackknife diagnostics also treat a cue as one independent unit, but
the accepted sc0ty line is fitted over every retained raw word/context-anchor
match. In this physical run 27 raw matches represented only 22 cue buckets, so
some cues can receive multiple times the leverage of others in `a/b`.

Branch `fix/romanian-cue-balanced-refinement` therefore adds a guarded
post-lock refinement candidate:
- canonical sc0ty acceptance, thresholds, raw-match fitter and Save verification
  remain unchanged;
- after canonical verification, retained matches are grouped by the same
  subtitle cue buckets already used by canonical point counting;
- one centroid per cue is fitted so each independent cue receives one vote;
- the refined formula is eligible only for Romanian adaptive output after
  verified 3/3 convergence;
- duplicate raw matches must actually exist;
- title-third evidence must already satisfy the existing 25% minimum share;
- the refinement itself must still satisfy the canonical factor/max-distance
  limits on cue centroids;
- mapped divergence from the canonical formula is capped by the existing
  0.75-second formula-stability guard;
- any failed guard falls back to the unchanged canonical formula.

This is a general duplicate-evidence weighting fix, not a Smallfoot, +10 s,
device, or constant-offset correction. Native regression coverage constructs a
synthetic duplicate-heavy cue set and requires equal-cue weighting to reduce
the known affine bias. A separate JS regression enforces verified-only,
balanced-only, bounded application. Physical benefit is not claimed until a
new exact-runtime iPhone test is performed.

CI reliability follow-up from the same PR:
- the fast PWA, Mobile WebKit and large-file stress workflows previously
  hard-pinned a specific legacy-wasm run ID;
- that artifact expired and produced a false infrastructure failure before
  product tests could execute;
- these consumers now resolve the newest unexpired repository artifact named
  `legacy-wasm` via the GitHub API, then use the first-party
  `actions/download-artifact` action with that resolved run ID;
- no external service or third-party download action was introduced;
- authoritative `legacy-wasm` retention is extended from 7 to 30 days;
- the fresh Legacy WebAssembly workflow for the current PR remains the merge
  gate for C++/WASM behavior, while the fast jobs intentionally consume the
  latest previously validated engine.

## 2026-09-19 — Session closeout / deployed precision-balance runtime

Current repository main before this documentation-only closeout:
`1ac8a82d114238d98b398f65623c63be24d3da41`.

PR #56 `Use late Romanian probes to balance precision evidence` was merged after
all required gates passed:
- CI;
- PWA Shell Fast Build;
- Mobile WebKit Compatibility;
- Large-file Browser Stress;
- fresh Legacy WebAssembly Build, including Romanian Chromium and iPhone-like
  WebKit coverage.

Deliberate Pages deployment:
- Deploy PWA Preview #19 / run `35445199768`: PASS;
- deployed product runtime:
  `1ac8a82d114238d98b398f65623c63be24d3da41`;
- build job: PASS;
- Pages deploy job: PASS.

This deployed runtime is the next required physical iPhone/Chrome Smallfoot
retest target.

The previous physical runtime
`ae75206e3991912affaee2bbdf4116033d128f57` already achieved valid canonical
acceptance and export:
- `saveEligible=true`;
- 22 canonical buckets / 27 raw matches;
- stable confirmations 3/3;
- 75.8387% canonical span;
- factor ~0.9999994502;
- maxDistance ~1.7699 s;
- 252 reference words / 185 Romanian reference context anchors;
- 22/24 probes completed;
- precision distribution 8/9/5 beginning/middle/end;
- zero processing errors.

Its synchronized 1517-cue SRT was materially improved but still showed an
affine residual versus the controlled original timing: MAE ~606 ms, p95
~1.206 s, max ~1.289 s, with third medians approximately
-1.071 / -0.584 / -0.147 s. This must not be "fixed" with a constant offset or a
Smallfoot-specific correction.

PR #56 does not replace or weaken the canonical sc0ty fitter. Instead it uses
only already-reserved late-confirmation capacity to improve evidence balance:
- late probes target the least-represented title thirds first;
- after canonical 3/3 verification, processing may continue only while a title
  third holds <25% of canonical buckets and late reserve remains;
- example physical regression rule: 8/9/5 continues; 8/9/6 may stop;
- the existing 450 s absolute Romanian sampled-audio ceiling remains unchanged;
- normal runs that verify before entering the late-confirmation path keep normal
  early-stop behavior;
- canonical thresholds, Save fail-closed semantics, Whisper model, one-worker
  iPhone memory policy, browser-local processing and language compatibility are
  unchanged.

A regression caught and fixed a planner-order bug before merge: after selecting
precision-targeted third locations, a generic score sort could move a middle
probe ahead of the weak final-third probe. Precision-target ordering is now
preserved.

A second pre-merge review fixed a neutral-probe edge case: precision polish now
retains the last canonical precision evidence from `selectCanonicalStatus` if
a later extra probe is temporarily noncanonical, preventing premature polish
termination.

For the next physical test:
1. use deployed runtime
   `1ac8a82d114238d98b398f65623c63be24d3da41`;
2. keep the browser foregrounded until terminal state;
3. save the synchronized SRT and `subsync2-diagnostics.json`;
4. verify the diagnostic runtime hash before analyzing timing;
5. compare output directly against the known-correct original Smallfoot SRT
   cue-by-cue when available;
6. inspect whether precision thirds become more balanced and whether slope /
   intercept residual materially improve;
7. do not tune against Smallfoot alone if the improvement is not generalizable.

The original Smallfoot SRT should be re-uploaded in the next chat if direct
cue-by-cue comparison is required and it is not available in that conversation.

## 2026-09-18 — Smallfoot verified lock / precision-balance follow-up

Physical iPhone/Chrome Smallfoot run on runtime
`ae75206e3991912affaee2bbdf4116033d128f57` is the first fully verified
Smallfoot result after the post-lock confirmation redesign:
- saveEligible=true;
- 22 canonical buckets / 27 raw matches;
- 3/3 stable confirmations;
- 75.8387% canonical span;
- factor ~0.9999994502;
- maxDistance ~1.7699 s;
- 252 reference words / 185 Romanian reference context anchors;
- completed 22/24 probes (16 primary + 5 rescue + 1 late confirmation);
- precision thirds 8/9/5;
- zero recorded processing errors.

The synchronized SRT from that exact run was retained and matches the diagnostic
timing endpoints (1517 cues, first output start 23.532 s, final output end
5776.910 s). The controlled test input is the known original Smallfoot Romanian
SRT shifted by exactly +10.000 s. Inverting the accepted affine formula against
that controlled shift reconstructs the original cue timing within <1 ms at the
known first and last endpoints, so no title text or guessed offset is required
for the comparison.

Exact full-title start residuals versus the reconstructed original:
- mean -597.7 ms;
- median -584.1 ms;
- MAE 606.0 ms;
- median absolute error 584.1 ms;
- p95 absolute error 1205.7 ms;
- max absolute error 1289.3 ms;
- third medians -1070.7 / -583.7 / -146.7 ms;
- first cue -1289.3 ms; final cue +275.1 ms.

This is an affine precision bias, not a constant offset and not a canonical
acceptance failure. Do not hard-code Smallfoot, -10 s, an iPhone offset or a
global millisecond compensation.

The diagnostic also reveals an evidence-distribution weakness at acceptance:
8/9/5 canonical buckets across beginning/middle/end. Two 30-second
late-confirmation windows were already scheduled but left unused because the
run stopped immediately at 3/3. Branch `fix/romanian-precision-balance`
therefore preserves the canonical fitter and all sc0ty thresholds, but changes
the late-lock evidence scheduler:
- late confirmation locations are ordered toward the least-represented title
  thirds using current precision bucket counts;
- once 3/3 is reached, the run may continue only inside the already reserved
  late-confirmation budget while any title third holds <25% of canonical
  buckets;
- processing still stops as soon as distribution reaches the precision balance
  floor or the existing 450 s absolute cap is exhausted;
- verified canonical acceptance remains valid; the precision rule only decides
  whether already-reserved evidence should still be collected;
- normal runs that verify before the late-confirmation path retain the existing
  early-stop behavior.

Regression shape from the physical run: 8/9/5 must continue precision probing;
8/9/6 (weakest share 6/23 >25%) may stop. Late windows for an 8/7/5 state must
target the final third first. No estimator, canonical threshold, Save policy,
Whisper model, worker count or paid service changes in this follow-up.

## 2026-09-18 — Smallfoot post-lock confirmation redesign

Two consecutive physical iPhone/Chrome Smallfoot runs now isolate two separate
failure modes on current code rather than one generic "inconclusive" result.

Runtime `9053f8c7faa6c7efbbd4440e5f1033667d1f7c9c` (PR #53) confirmed the native
stale-residual fix: the final 21/21 probe reached a canonical 20-bucket line with
factor ~0.99999947, maxDistance ~1.724 s (< 2 s), 75.8387% canonical span and
precision diagnostics available. Save correctly remained blocked because the
canonical line appeared only on the final available boundary, leaving
stableCorrelatedWindows=1/3.

PR #54 attempted to preserve the same 360 s sampled-audio ceiling by replacing
the proven 3×30 s + 2×15 s rescue structure with eight independent 15 s rescue
windows. The deployed runtime
`b4c146bba7e930ea4108328833300d6df5d6066b` physically failed on the same
Smallfoot reproduction after 24/24 probes: 214 reference words, 155 Romanian
reference context anchors, 20 points, factor ~0.99999791, maxDistance ~3.078 s,
candidate span 62.6132%, no canonical span, stableCorrelatedWindows=0 and zero
recorded processing errors. Precision remained unavailable because canonical
correlation was not reached.

This demonstrates that the #54 all-15-second rescue increased verifier
boundaries at the cost of the longer Whisper discovery context that had produced
the valid line on PR #53. #54 is therefore superseded; do not tune the canonical
sc0ty thresholds to compensate for this scheduling regression.

Branch `fix/romanian-post-lock-confirmation` restores the PR #53 rescue planner:
three 30 s discovery probes plus two 15 s confirmation boundaries inside the
normal 120 s rescue reserve. The normal Romanian budget remains 240 s primary +
120 s rescue = 360 s.

A separate post-lock confirmation reserve is now permitted only when:
- a canonical correlation already exists;
- the unchanged 3/3 verifier is still pending; and
- the remaining scheduled boundaries are mathematically insufficient to reach
  3/3.

In that narrow case, up to three fresh non-overlapping 30 s confirmation probes
may be appended from unused title gaps. Processing still stops immediately when
3/3 verifies. The conditional extension is capped at 90 s, making 450 s the
absolute maximum only for a late canonical lock. This budget change is justified
by the two physical results above: 360 s with 30 s discovery can produce the
correct canonical line too late to verify, while forcing more boundaries into
the same 360 s can destroy that line.

The branch also records a privacy-safe numeric per-probe history in diagnostics:
window start/end, word count, points, canonical/candidate gains and spans,
correlation state, stable-check count, formula delta, factor and maxDistance.
No filenames, subtitle text, recognized words or media are added to diagnostics.

Canonical thresholds, Save fail-closed behavior, Romanian Whisper model,
single-worker memory policy, browser-local processing, language compatibility
and GPL/sc0ty attribution remain unchanged.

## 2026-09-17 — Smallfoot exact-minimum correlation residual fix

Physical iPhone/Chrome Smallfoot rerun on runtime `f6892a6ebd703ce747da6ba8b5ee4b7ec66783f6`
completed all 21/21 probes with zero recorded processing errors and reached
75.8387% candidate span, so the PR #51 coverage rescue is active on the real
client. Save remained correctly blocked because canonical correlation reported
20 buckets with factor ~0.99999947 but maxDistance ~2.547 s.

Repository inspection isolated an inherited upstream edge case in
`Synchronizer::correlate()`: after removing the furthest raw point, the line is
refit but `distSqr` previously retained the distance of the point that had just
been removed. At the exact `minPointsNo=20` boundary, pruning then stops and the
stale residual can incorrectly reject the retained 20-bucket fit. The fix
recomputes the furthest residual on the retained set immediately after every
refit. The canonical thresholds remain unchanged: minPointsNo=20,
minCorrelation=0.9999 and maxPointDist=2 s. A deterministic native regression
covers 21 buckets with one removable outlier and requires the retained exact-20
fit to be evaluated using its own residual.

## Real-title Smallfoot coverage rescue + PWA runtime freshness — PR #51 / PR #52

PR #51 `Make Romanian rescue target missing canonical coverage` merged at
`a430611d2b4b706a38655bdfcee213ce4c8926c0`. It keeps the canonical
75% coverage gate, three stable confirmations, Save fail-closed behavior and
the 360-second Romanian sampled-audio cap unchanged. When primary probing has a
canonical or candidate span below the unchanged coverage gate, rescue planning
now spends its existing 120-second reserve outside the known evidence span
instead of relying only on generic quarter/content scoring.

PR #51 gates were green on head `363b90b21831b7fa829e32dcde8868c6a7b6fe63`:
CI, Mobile WebKit Compatibility, Large-file Browser Stress and Legacy
WebAssembly Build. Deliberate Pages deployment run `35014347782` was green on
exact merge SHA `a430611d2b4b706a38655bdfcee213ce4c8926c0`.

The authoritative deployment diagnostic artifact from that run was downloaded
and inspected. Both Chromium and iPhone-like WebKit reports contain runtime
`a430611d2b4b706a38655bdfcee213ce4c8926c0`, verified convergence after
10/21 probes, 27 points, about 93.94% canonical span and `saveEligible=true`.

A subsequent physical iPhone/Chrome Smallfoot retest nevertheless downloaded a
diagnostic containing the old PR #46 runtime
`27a84444e5b0f956d66bc380d41a0658cfd22a36` and exactly the previous
23-point / 62.90% pending-convergence result. This is evidence that the retest
did not execute PR #51. Repository inspection identified a PWA delivery defect:
the service worker used cache-first handling for navigations and the main
`scripts/subsync.js` URL was unversioned, so an installed client could remain
on an old shell after a successful deploy.

PR #52 addresses runtime freshness, not synchronization semantics:
- stamp the full build SHA into shell asset URLs;
- register/update the service worker with the current build SHA and
  `updateViaCache: none`;
- fetch navigations network-first with versioned offline fallback;
- fetch `build-manifest.json` with no-store semantics so installed clients can
  detect a newer deployment;
- keep versioned shell resources cache-first within a build;
- add browser regression coverage that first installs a legacy cache-first
  worker, publishes the current build, escapes through a build-busted
  navigation, activates the current worker and confirms a subsequent normal
  navigation remains current.

No correlation formula, canonical threshold, Whisper model, Save rule,
Romanian sampling budget or language compatibility rule is changed by PR #52.

## Live PR #46 release validation hardening — PR #49

Current repository main after the test-only hardening is
`3aca731cbeae5afff8a1f3a6131c10e753ba5ac1`. The deliberately deployed
product runtime remains PR #46
`27a84444e5b0f956d66bc380d41a0658cfd22a36`; PR #49 did not redeploy or
change product code.

PR #49 adds public-Pages test coverage only. The live Romanian smoke now:
- opens the beginning/middle/end timing review;
- downloads the product diagnostic JSON through the real UI;
- verifies the report runtime hash against the live versioned JS/WASM assets;
- verifies verified convergence and Save eligibility agree with the UI;
- checks precision/ref-word evidence parity;
- rejects filename/path/text/transcript/media/raw-error fields and sampled
  fixture content in the report;
- checks the three timing-review mapped endpoints against the actually saved
  SRT within 1.1 ms rounding tolerance;
- retains the downloaded product JSON in the workflow artifact.

PR #49 gates all passed without retry: CI `34952986296`, Public Pages Language
Smoke `34952986308`, Romanian Identical Input Study `34952986345`, and
Legacy WebAssembly Build `34952986287` including the Romanian Chromium and
iPhone-like WebKit paths. Main CI `34954289889` also passed.

The strict combined post-merge public run `34954333020` passed on test harness
SHA `3aca731cbeae5afff8a1f3a6131c10e753ba5ac1` while exercising the exact
deployed PR #46 runtime. Artifact `10390687916` was downloaded and inspected.
It contains the saved Romanian SRT, complete strict result JSON, fixture
manifest, and the product diagnostic JSON. Observed evidence:
- 169 reference words and 155 Romanian context anchors;
- verified adaptive convergence after 10/21 probes, with rescue unused;
- 28 canonical points / 28 cue buckets, thirds 9/9/10, 86 raw matches;
- displayed formula `0.9998x-8.332`, saved first-cue shift -8.337 s;
- leave-one-cue sensitivity max 150 ms / median 35 ms;
- maximum slope sensitivity 315 ppm;
- full-title p95 absolute start error 0.43405 s;
- affine slope error -227.16 ppm and total affine drift -0.102883 s;
- beginning/middle/final-third start-error medians
  -0.3520 / -0.3865 / -0.4215 s;
- diagnostic report runtime hash exactly
  `27a84444e5b0f956d66bc380d41a0658cfd22a36`;
- `saveEligible=true`, verified convergence, `errorCount=0`;
- no console, page or HTTP failures;
- privacy allowlist and timing-review/SRT parity checks passed.

This closes PR #46 release validation. No product formula, canonical thresholds,
Whisper model, ASR architecture, Save policy, Romanian 360-second sampling cap,
or deployment behavior was changed by PR #49. No physical-iPhone retest is
required for this test-only closeout.

Next authoritative engineering step is the 3-5 real-title validation set,
starting with one non-Frozen-II title using a known-correct Romanian SRT and a
deliberately constant-shifted copy. Do not tune the formula from a single title.
Point provenance remains conditional on repeated real-title precision failures.

## Product timing review and diagnostic export — PR #46

Current deliberately deployed product runtime:
`27a84444e5b0f956d66bc380d41a0658cfd22a36`.
Deploy PWA Preview `34951221626`: PASS, including fresh Romanian Chromium and
iPhone-like WebKit E2E. Deployment artifact `10389288761` was inspected: both
browsers report the exact deployed hash, three preview samples, zero recorded
processing errors, p95 0.43100 s and drift 0.045304 s. Main CI `34951180855`
passed. Production auto-deploy remains OFF; the preview branch was advanced
deliberately only after PR #46 was green and merged.

Strict post-deploy Public Pages smoke `34952104123`: PASS. Retrieved artifact
`10390320339` contains complete JSON (`status=pass`, no failure reasons), exact
PR #46 runtime query hashes, and both new control labels in the live app text.
It reports 160 words, 143 anchors, 10/21 probes, 26 points/buckets, thirds 10/8/8,
81 raw matches, formula `1.0002x-8.451`; leave-one-cue max 154 ms / median 49 ms,
slope sensitivity max 450 ppm. Full-title p95 is 0.44110 s, drift 0.112027 s;
strict checks are enabled and console/page/HTTP error lists are empty.
The native extractor/correlator/Whisper WASM byte hashes remain unchanged from
the PR #41 runtime observed during PR #44; the UI bundle has changed.

Branch `feat/timing-review` adds a read-only beginning/middle/end timing preview
after a run and a local JSON diagnostic download, including runtime/browser,
elapsed time, formula, counts, convergence, precision and preview endpoints.
The report excludes filenames, cue text, ASR text, media and raw error messages;
it retains error count only. No upload occurs. Reports are available even for
inconclusive/stopped runs; provisional previews never enable subtitle Save.
Input backward-start jumps and invalid cue timing are reported as observations,
not claimed cut/edition detection. Existing output mapping and Save policy are
unchanged. Unit regressions cover privacy, preview/export parity, malformed and
short inputs, and pending/verified adaptive state. Browser regressions exercise
preview and report download in the actual Romanian Chromium/WebKit workflow.
PR #46 merged at `27a84444e5b0f956d66bc380d41a0658cfd22a36` with all triggered
head workflows green: CI `34949200961` / `34949197503`, Mobile WebKit
`34949200974`, large-file stress `34949200962`, controlled public-input study
`34949200975`, and Legacy WebAssembly Build `34949200967` attempt 2. The study
still exercised the prior PR #41 public runtime; the fresh legacy build tested
the actual PR #46 candidate including both new controls in Chromium and WebKit.

Artifact `10388443976` was retrieved and both downloaded product JSON reports
were inspected. Chromium and WebKit produced identical formula/evidence/timing:
161 reference words, 145 anchors, 10/21 probes, 29 points, 29 cue buckets,
thirds 11/8/10, 77 raw matches, formula `1.000400424x-8.391125679`;
leave-one-cue max 137.35 ms / median 58.68 ms, max slope sensitivity 342.13 ppm.
Strict full-title p95 was 0.37510 s and drift 0.181354 s. Reports contained three
preview samples and zero recorded processing errors. The always-uploaded browser
artifact now explicitly retains both product reports, including on failure.

### Red-run evidence remains open

Legacy run `34949200967` attempt 1 failed strict drift at 0.577559 s (p95
0.51730 s), not preview/report assertions. Artifact `10388502225` preserved the
new product report and output SRT: 143 words, 129 anchors, 9 probes, 27 points,
28 buckets, thirds 8/10/10, 80 raw matches, slope `a=1.001275301`, intercept
`b=-8.569321632`; leave-one-cue max 187.18 ms / median 46.46 ms, slope
sensitivity 612.85 ppm. No processing errors were recorded.
Its PCM SHA256 was `31c893476ff2fdd5acac13e94de6fb3b296d996fce605db857ebb6d7459dc4ef`.
Earlier same-product-code Chromium run `34947841174` passed with p95 0.51605 s
and drift -0.040491 s on PCM
`0600d4334df364e6f47b16541fbe1a7c54b4f16ccfaa96ad34470ce970258279`;
79/80 source cue starts differed. That old workflow was cancelled by the artifact
retention follow-up while WebKit ran, not counted as a full green gate.

One failed-job rerun was performed without a formula/threshold change; attempt 2
passed. This does NOT establish a variability fix or complete root cause.
Synthetic input variability and fitting precision remain open; physical Frozen
II PR #38 remains the independent physical reference. No default-noise fixture
was replaced, no timing threshold was widened, and no hardcoded offset added.

The remembered piecewise fork is `Sefzz15/subsync`. Current reviewed commit is
`a8b4e9ec6858d86030d726856a6a2232079c3097`; see `docs/PIECEWISE_REVIEW.md` for
actual source inspection and a reproducible method-level test. A direct import
is rejected: the isolated method can perturb perfect affine timing and cannot
infer cut offsets without supporting points. No optional piecewise export is
implemented or advertised as available. Further point-provenance/segment work
requires independent evidence and preserves default linear behavior, canonical
thresholds and the 360-second sampled-audio cap.

User validation: keep a correct SRT unchanged; shift a copy by a known constant
(e.g. +10 seconds), synchronize against Romanian audio in a different title,
keep Safari foregrounded until terminal verified status, then retain original,
shifted input and output SRT, diagnostic report (once deployed), elapsed time,
device/browser/title/duration and practical beginning/middle/end observations.
Start with one other title, then expand to 3-5. No media upload is required.

## Controlled-input repeatability — PR #44 evidence

PR #44 merged at `9fc1476817d169816a8757eec02db15873427dd9` after all five
PR workflows passed: CI `34943972911`, MKV diagnostic `34943972668`, public
smoke `34943972741`, controlled study `34943972776`, and Legacy WebAssembly
Build `34943972775` including Chromium and iPhone-like WebKit Romanian E2E.
No Pages deployment was triggered; product runtime remains PR #41.

Branch `test/romanian-identical-input` adds test-only controlled-input tooling:
- SHA256 of normalized PCM (with format/frame count), SRT and exact MKV bytes;
- generation manifests record synthesis parameters, per-phrase PCM hashes,
  pinned voice evidence, Piper/ONNX Runtime versions and FFmpeg version;
- opt-in zero-noise synthesis uses explicit Piper 1.8.0 HTTP request parameters
  (`length_scale=1`, `noise_scale=0`, `noise_w_scale=0`) without rewriting the
  pinned voice configuration or changing existing default fixture generation;
- two independent syntheses are compared, then exactly three fresh-browser
  runs consume the first fixture unchanged; no retry-until-green behavior;
- every run enforces the unchanged strict timing gates and retains its own
  result/log/SRT, exact input identity, runtime JS/WASM hashes and a bounded
  test-only Comlink observer trace of correlator word inputs and probe stats;
- study PASS requires all three strict runs and matching input/runtime identity;
  output equality and synthesis equality are reported separately, not assumed;
- a retained synthetic fixture can be replayed with `--fixture-dir`;
- the new workflow is test-only and does not publish or deploy anything.

`srt_timing.py` report schema v2 resolves the duplicate metric key:
`endMedianErrorSeconds` is the cue-end median; the last cue-count third uses
`finalThirdMedianErrorSeconds`. Empty partitions are explicit nulls. The p95,
affine calculation and all thresholds are unchanged.

Local validation: 14 Python tests, RPC-observer JavaScript regression and project
invariants pass.
No product synchronization, confidence selection, Save policy or sample budget
is changed. Actual C++ matched-point provenance is a later conditional layer if
the captured word/probe stream proves insufficient to isolate variation.

### Controlled public-runtime observations

Study run `34943972776` passed all three fixed replays. Artifact `10387225190`
was downloaded and inspected, including both generated inputs and each replay's
complete JSON, SRT and browser log. Artifact retention is seven days; hashes are
identifiers, not a substitute for retaining the files when replaying later.

- Two independent explicit zero-noise syntheses produced identical normalized
  PCM and SRT bytes in this environment. Their independently muxed MKV hashes
  differed; all browser replays deliberately used the exact first MKV.
- PCM SHA256: `354b68dca487562572dc1341a99c19bc40b805e90aa0d491af4e7327a303eb56`.
- SRT SHA256: `938dc5b69022e7a25328bd235dbd8f90922095b3d3a60f9be2e9ec2e0477e6a3`.
- Replayed MKV SHA256: `d0979184d147f84b489779057295f2945f0b331730b4febedb3ae5763d4820ec`.
- All three fresh Chromium contexts used browser `152.0.7977.82` and identical
  hashes for all five observed runtime JS/WASM assets, on deployed PR #41.
- All three produced identical output bytes, SHA256
  `61b8c63f42e5e92910704358157d88f2b379b09cd52b7cfc40c16a470d2fb47e`,
  and identical 1,276-event correlator RPC traces (zero dropped events).
- Every replay: 161 reference words, 144 anchors, 10 probes, 28 points,
  formula `1.0002x-8.535`, saved shift -8.533 s.
- Precision: 28 buckets, thirds 11/8/9, 88 raw matches; leave-one-cue max
  147 ms, median 50 ms, slope sensitivity max 409 ppm.
- Full-title synthetic timing: p95 0.52905 s, drift 0.0684548 s, slope
  151.123 ppm; mean start error -0.4988375 s. This fixture still has a sizable
  offset despite small drift; PASS is not a claim of physical-title accuracy.
- All three report no console, page or HTTP errors. Strict timing remains
  enabled with the unchanged +/-0.350 s drift gate.
- Independent default-noise public smoke `34943972741` also passed:
  p95 0.41415 s, drift 0.289409 s, on a different hashed input.

### Interpretation and next decision

Fixed-input reproducibility is demonstrated for this fixture, browser and runner,
not universally. Historical regenerated fixtures varied; this experiment does
not recreate the failed historical input or isolate the entire causal chain.
It does not demonstrate ASR stochasticity on identical input, unstable fitting
on identical evidence, or disproportionate context-anchor slope influence.
The existing leave-one-cue sensitivity still describes evidence sensitivity,
not observed replay randomness or an exact re-fit of the original C++ hit set.

Keep the default-noise smoke and explicit controlled-input study separate;
do not replace the former merely to obtain greener CI. No formula, thresholds,
Whisper, anchors, sampling or Save changes are justified by this result alone.
Next: collect 3-5 real-title validations with correct SRT comparisons and current
precision diagnostics; preserve Frozen II PR #38 as the physical baseline.
Only if those expose repeatable precision failures, investigate exact matched
point/bucket provenance and fitting sensitivity against multiple fixtures.
Physical iPhone testing must be performed by the user, not inferred from WebKit.

## Latest verified state — PR #42 observability closeout

This section supersedes older deployment/current-status sections below.

- PR #41 product runtime remains `d0af1c8e5d04510f18d56885be87b448b239d05d`.
- PR #42 merged at `15a9003c132301e0b6fb2706db78f98ce99b27fd`.
- PR #42 changes completed-run diagnostic persistence only; no product deploy,
  algorithm, fixture-generation, threshold, Save-policy or sampling change.
- PR gates all PASS: CI `34905814099`, Public Pages `34905814127`,
  Legacy WebAssembly Build `34905814169` (including Chromium and iPhone-like
  WebKit Romanian E2E). Main CI `34906730291`: PASS.
- Strict post-merge public smoke `34906737236`: PASS on exact PR41 runtime.
- Artifact `10373021441` was downloaded and inspected: complete JSON with
  `status=pass`, `failureReasons=[]`, strict timing/precision enabled, all
  timing/precision/probe evidence and zero console/page/HTTP errors.
- Strict result: 147 reference words, 132 anchors, 9/21 probes, 28 points,
  94% canonical span, stable 3/3, verified lock, formula `1.0003x-8.545`,
  saved shift -8.540 s; p95 0.53405 s and drift 0.131355 s.
- Precision: 28 buckets, thirds 9/9/10, 89 raw matches; leave-one-cue max
  239 ms, median 59 ms, slope max 691 ppm. These are sensitivity diagnostics,
  not calibrated confidence intervals or measured subtitle accuracy.
- Physical Frozen II PR38 remains PASS: mean absolute 94.4 ms, median 78 ms,
  p95 226.6 ms, maximum 283 ms. The CI fixture is a separate input.

Completed-run failures now preserve JSON before nonzero exit, including all
failure reasons. Five deterministic regressions cover PASS, both drift signs,
multiple reasons, browser failures and missing timing. Artifact upload keeps
`if: always()`. Limits remain first-cue ±0.60 s, p95 ≤0.60 s and drift ±0.35 s.
Manual smoke and dedicated test-branch push enforce strict checks; PR smoke
remains compatible with the live runtime. Pre-completion failures outside the
existing timeout handler remain outside this narrow completed-result fix.

### Evidence comparison and next decision

| Run | Runtime | p95 start error (s) | Affine drift (s) | Precision buckets / thirds | Leave-one-cue max / median |
| --- | --- | ---: | ---: | --- | --- |
| PR38 strict `34842464186` | PR38 | 0.54610 | 0.168665 | Not exposed | Not exposed |
| PR41 strict FAIL `34901669357` | PR41 | 0.55830 | 0.449828 | JSON lost before fix | JSON lost before fix |
| PR42 PR gate `34905814127` | PR41 | 0.32105 | 0.055522 | 27 / 10,8,9 | 167 / 53 ms |
| PR42 strict `34906737236` | PR41 | 0.53405 | 0.131355 | 28 / 9,9,10 | 239 / 59 ms |

The failed PR41 metrics were recovered from its saved SRT and the exact
`fixture.json` cue times, rounded to SRT milliseconds; no missing precision
values were invented. Its start-error thirds were -512.5/-363/-208.5 ms.

Confirmed input variability:
- PR38 versus failed PR41: identical phrase text, but 78/80 phrase durations
  changed; maximum duration delta 220.5625 ms and cue-start delta 448.75 ms.
- The new PR gate versus strict run, both on PR41 runtime: 77/80 durations
  changed; maximum cue-start delta 815.875 ms. Formula changes therefore cannot
  be interpreted as repeatability failures on identical audio.
- Earlier PR42 commit `cf957da` changed local Piper noise defaults. That change
  was removed from PR42's final diff to keep this observability fix isolated.
  Two artifacts (`10372417132`, `10372622509`) from its prior run have identical
  phrase timing metadata but 157 versus 161 reference words and different
  formulas. PCM hashes are absent, so neither bit-identical audio nor ASR
  stochasticity is established. The old commit is a candidate, not a proven
  complete stabilization fix.

Next sprint: **fixture reproducibility and an additional diagnostic layer**,
not a product formula adjustment yet:
1. Record synthesis configuration and SHA256 of normalized PCM and target SRT;
   retain/reuse identical synthetic input for repeated same-runtime tests.
2. Validate proposed deterministic Piper generation with repeated PCM hashes.
3. If identical input still varies, capture reference-word timestamps and actual
   fit points/buckets per probe, with single-word versus anchor provenance.
4. Distinguish the actual final `correlate()` hit set from `getUsedPoints()`,
   which reselects all points within the accepted line's distance band. Current
   jackknife diagnostics use the latter, so they may not represent removal from
   precisely the original fitted set. This is a diagnostic caveat, not a proven
   synchronization root cause.
5. Fix the diagnostic key collision in `srt_timing.py`: `endMedianErrorSeconds`
   represents both cue-end median and final-third start median; the latter
   overwrites the former. Existing p95/drift thresholds are unaffected.

A passing rerun does not close the variability investigation. Weak-bucket,
anchor-weighting, LineFinder sensitivity and ASR timing causes are not yet
isolated. Do not add a constant offset or alter fitting based on this dataset.
After controlled-input diagnosis, proceed with 3–5 physical real-title tests
and the previously agreed product roadmap. No new physical iPhone test was
required for this test-infrastructure-only change.

## Current status

Repository: `Zuzuitu/subsync-web-enhanced`

Upstream: `sc0ty/subsync`

Pinned upstream baseline: `c888da7257d57bf039523c9f7015feacb4b95dc3`

Public preview: `https://zuzuitu.github.io/subsync-web-enhanced/`

Current product/runtime state:
- PR #36 `Disambiguate Romanian correlation and reserve confirmation checks`:
  **MERGED**;
- PR #36 merge / deployed product-runtime commit:
  `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
- main-push CI `34816651422`: **PASS**;
- canonical sc0ty synchronization thresholds remain unchanged;
- Romanian primary fast path remains 16 × 15 s;
- Romanian same-language matching now augments single-word evidence with hashed
  adjacent-word lexical context anchors;
- rescue keeps the 360 s / 6-minute sampled-audio cap while reserving extra
  verifier boundaries: three 30 s discovery probes plus two 15 s confirmation
  probes from four content-aware locations;
- maximum adaptive probe boundaries are now 21;
- Romanian adaptive Save remains fail-closed until verified adaptive convergence.

PR #36 validation:
- CI `34787178683`: **PASS**;
- Mobile WebKit Compatibility `34787178727`: **PASS**;
- Large-file Browser Stress `34787178687`: **PASS**;
- Public Pages Language Smoke PR gate `34787178802`: **PASS**;
- Legacy WebAssembly Build `34787178704`: **PASS**.

Latest deliberate product preview deployment:
- Deploy PWA Preview `34816680938`: **PASS**;
- deployed product commit:
  `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
- fresh legacy extractor/correlator build: **PASS**;
- isolated Romanian Whisper SIMD build/runtime: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- GitHub Pages artifact/deployment: **PASS**.

Post-deploy public Pages validation:
- Public Pages Language Smoke `34817766344`: **PASS**;
- live `whisper.js` and `whisper.wasm` were served with exact version hash
  `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
- representative original-language delivery and catalog checks passed;
- live Romanian E2E: **156** usable reference words, **141** Romanian context
  anchors, adaptive lock after **10/21** probes, **27** synchronization points,
  displayed **100.00%** correlation, formula `1.0003x-8.824`, and saved
  timing correction **-8.818 s** for the known +8 s fixture;
- zero console errors, page errors or HTTP failures.

The public fixture converged during the primary phase, so it validates the exact
PR #36 runtime, anchor path and unchanged fast path, but does not substitute for
the real physical Frozen II reproduction that motivated PR #36.

## Immediate milestone

PR #36 has now passed the authoritative physical iPhone/Safari Frozen II test:
- same >2 GB dual-audio Frozen II MKV + Romanian SRT;
- Cached Romanian Whisper model;
- elapsed **12:42**;
- **21/21** probes, rescue **5/5**;
- **248** usable reference words;
- **185** Romanian lexical context anchors;
- **25** synchronization points;
- candidate gain **+1** on the final probe;
- candidate span **81%**;
- canonical span **81%**;
- stable checks **3/3**;
- adaptive lock **verified**;
- displayed correlation **100.00%**;
- formula `1.0002x-0.943`;
- max change `0:00:933`.

The user then supplied the preferred original SRT and the SubSync2 output from
this physical run for exact offline timing comparison. Across **1,133 text-matched
cues**:
- mean start residual (original - SubSync2): **+166.8 ms**;
- median start residual: **+168.0 ms**;
- time-third medians: **+293 ms** at the beginning, **+134 ms** in the middle,
  and approximately **+4 ms** in the final third;
- the residual is almost perfectly affine rather than random:
  `originalTime ≈ 0.9999242315 × subSync2Time + 0.363043 s`;
- the affine residual explains the matched-cue timing difference with
  **R² ≈ 0.999988** and leaves < **1 ms** maximum fitting error;
- residual drift is approximately **-75.8 ppm**, i.e. about **-273 ms/hour**;
- the correction crosses zero at roughly **79.9 min** into the title.

Therefore the user's visual “200–300 ms early” observation is real, but the
problem is not a constant offset: it is a small intercept + slope error in the
final linear timing formula. Two non-timing content differences exist between
the supplied SRTs (one title-text replacement and one missing credit cue), but
they do not affect the 1,133 matched-cue timing analysis.

Code inspection exposed a concrete timing-contract mismatch:
- original sc0ty/PocketSphinx emits reference `Word.time` at the midpoint of
  each recognized segment;
- Romanian Whisper currently emits `Word.time` at the leading edge while also
  exposing the segment duration.

Because the original correlator was tuned against PocketSphinx midpoint
semantics, the active fix moves Romanian Whisper correlation timestamps to the
recognized-word midpoint rather than applying an arbitrary hard-coded delay.
Context-anchor acoustic bounds are preserved explicitly so this timestamp
change does not inflate or shift lexical-pair spans.

Branch under validation:
`fix/romanian-whisper-midpoint-timing`.

The deterministic Romanian browser fixture is also tightened from a broad
historical accepted shift range to a **±0.60 s fine-timing error** around the
known -8.0 s correction. In addition, the browser regression now measures
**all cue timestamps across the full title**, reports affine residual slope /
drift and beginning-middle-end timing, requires p95 absolute start error ≤
0.60 s, and caps synthetic full-title affine drift at **±0.35 s**. This closes
the previous test gap where only the first saved cue was checked. No canonical
sc0ty thresholds are changed.

## PR #38 midpoint timing — deployed and physical Frozen II validation

PR #38 `Align Romanian Whisper timing with sc0ty word midpoints` merged at:
`ff81b54509d5ec766200f5d724c9ca8f505fbbe3`.

Release evidence:
- PR CI: PASS;
- Mobile WebKit Compatibility: PASS;
- Large-file Browser Stress: PASS;
- Legacy WebAssembly Build rerun attempt #2: PASS;
- main CI `34834920368`: PASS;
- deliberate Deploy PWA Preview `34834963153`, attempt #2: PASS;
- post-deploy Public Pages Language Smoke `34842464186`: PASS on exact runtime
  `ff81b54509d5ec766200f5d724c9ca8f505fbbe3`;
- strict public Romanian timing smoke: 156 reference words, 136 context anchors,
  10/21 probes, 26 points, formula `1.0004x-8.561`, saved shift -8.554 s,
  p95 absolute start error 0.5461 s, affine drift 0.1687 s, zero console/page errors.

Authoritative physical iPhone/Safari retest on the same Frozen II >2 GB dual-audio
title:
- cached Romanian Whisper model, 30.7 MiB;
- elapsed **12:17**;
- **20/21** probes;
- rescue **4/5**;
- **233** reference words;
- **173** Romanian context anchors;
- stable checks **3/3**;
- **26** synchronization points;
- candidate gain **+1**;
- candidate span **81%**;
- canonical span **81%**;
- adaptive lock **verified**;
- displayed correlation **100.00%**;
- displayed formula `1.0001x-105.169`;
- max change `1:45:159`.

The user supplied both the preferred original SRT and the SubSync2 result from this
exact physical run. Both files contain **1,135 cues**. After whitespace
normalization, cue text matches for all 1,135 cues; only one cue differs in raw
formatting because of a line-break/space variation.

Exact timing comparison (original - SubSync2) over all 1,135 cues:
- mean start residual: **-63.6 ms**;
- median start residual: **-62.0 ms**;
- mean absolute start error: **94.4 ms**;
- median absolute start error: **78.0 ms**;
- p95 absolute start error: **226.6 ms**;
- maximum absolute start error: **283.0 ms**;
- time-third medians: **+47.5 ms** beginning, **-62.0 ms** middle,
  **-171.0 ms** final third;
- residual remains almost perfectly affine:
  `originalTime ≈ 0.9999383794 × subSync2Time + 0.096033 s`;
- residual slope: approximately **-61.6 ppm**;
- residual drift across the title: approximately **-375.9 ms**;
- maximum error after fitting that residual affine relation: **<0.6 ms**.

Compared with the previous physical PR #36 result, the midpoint fix materially
improved practical timing:
- mean absolute start error: **174.5 ms -> 94.4 ms** (~46% lower);
- median absolute start error: **168 ms -> 78 ms** (~54% lower);
- p95 absolute start error: **343 ms -> 226.6 ms** (~34% lower);
- maximum absolute start error: **360 ms -> 283 ms** (~21% lower).

The residual is now small enough to be a fine-polish issue rather than a
synchronization failure. Do not introduce a title/device-specific hard-coded
offset. Any further improvement should come from better formula estimation or
matched-point confidence/polish logic and must preserve canonical sc0ty
thresholds.

## Product goal

Revive and modernize sc0ty/SubSync as a browser-first installable PWA while
preserving the original synchronization algorithm and original language catalog
where technically sound.

Primary workflows:
- English reference audio + Romanian subtitles using the original sc0ty
  PocketSphinx/dictionary path;
- Romanian reference audio + Romanian subtitles using isolated local Whisper
  speech recognition and the original SubSync correlation/timing logic.

Media remains browser-local. Do not introduce a backend media-upload workaround
or a paid API/service without explicit user approval.

## Governance and invariants

- repository truth > chat memory;
- material changes: branch -> PR -> CI green -> merge;
- do not make material commits directly on `main`;
- production auto-deploy remains disabled;
- preview deployment is deliberate/manual when product changes require it;
- do not weaken invariants or synchronization thresholds to make CI green;
- reproduce -> isolate -> regression -> smallest justified fix -> CI -> checkpoint;
- do not invent test results or root causes;
- preserve GPLv3 and visible credit to Michał Szymaniak / sc0ty;
- preserve the original sc0ty language catalog;
- keep media processing browser-first/local;
- do not replace PocketSphinx globally with Whisper;
- do not migrate the whole legacy extractor to modern LLVM merely to optimize Romanian ASR;
- do not claim iPhone-like WebKit CI is equivalent to physical iPhone Safari.

Canonical synchronization thresholds remain unchanged:
- `minPointsNo = 20`
- `minCorrelation = 0.9999`
- `maxPointDist = 2`
- `minWordProb = 0.3`
- `minWordLen = 5`
- `minWordsSim = 0.6`

The Romanian long-title regression now uses **80** subtitle cues over a 481 s
distributed fixture, with at least 64 cues and at least 8 cues/min required by
the sparse-regression checks. The former 16-cue fixture was mathematically
incapable of satisfying `minPointsNo=20`; the correct fix remains increasing
realistic evidence, never lowering the canonical threshold.

## Original sc0ty language catalog

Original speech models preserved:
- `chi`
- `dut`
- `eng`
- `fre`
- `ger`
- `gre`
- `ita`
- `rus`
- `spa`

Total original catalog:
- **9 speech models**;
- **217 dictionary packages**.

Original asset publication remains pinned/signature-verified. The deliberate
Pages deploy mirrors the complete catalog under same-origin `assets/data/`,
while browser IDBFS stores packages actually downloaded by the user.

Live Public Pages representative-language validation after the Romanian release
candidate:
- run `34718016222`: **PASS**;
- mirror manifest: 226 packages / 528,928,835 bytes;
- Italian dictionary + speech: HTTP 200;
- French dictionary + speech: HTTP 200;
- Spanish dictionary + speech: HTTP 200;
- zero console/page errors.

The tiny representative fixtures intentionally lack enough evidence to
synchronize. Their purpose is live catalog/delivery/model-loading validation,
not per-language recognition accuracy.

## Architecture

### English reference audio + Romanian subtitles

`MKV ENG -> WORKERFS -> FFmpeg Demux -> AudioDec -> Resampler -> PocketSphinx ENG -> words`

`RO SRT -> SubtitleDec -> original sc0ty ENG<->RO dictionary -> comparison words`

`reference words + subtitle words -> original SubSync correlator -> timing formula -> corrected SRT`

This workflow is confirmed end to end and remains the original-sc0ty path.

### Romanian reference audio + Romanian subtitles

`MKV RON/RUM -> WORKERFS -> legacy FFmpeg Demux -> AudioDec -> Resampler -> PcmSink -> isolated whisper.cpp WASM SIMD -> Romanian words`

`RO SRT -> SubtitleDec -> Romanian subtitle words`

`reference words + subtitle words -> original SubSync correlator -> timing formula -> corrected SRT`

Romanian aliases `ro`, `rum`, `ron` canonicalize to internal `rum`; Whisper
language is `ro`.

## Romanian ASR implementation

PR #22 `Add genuine local Romanian audio recognition` merged to `main` at
`146aaaf9ec7f45d46e625644be30f4aa12108b0d`.

Pinned engine:
- `ggml-org/whisper.cpp`
- tag `v1.5.4`
- commit `0b9af32a8b3fa7e2ae5f15a9a08f5b10394993f5`

Pinned model:
- `ggml-tiny-q5_1.bin`
- revision `5359861c739e955e79d9a303bcbc70fb988958b1`
- SHA-256 `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7`
- size `32,152,673` bytes (~30.7 MiB)
- browser asset `asr/rum`

Toolchains:
- legacy extractor: Emscripten `1.39.11-fastcomp`, preserving FFmpeg n4.2,
  SphinxBase and PocketSphinx compatibility;
- isolated Romanian Whisper module: pinned `emscripten/emsdk:3.1.50` image from
  `config/romanian-asr.json`;
- single-threaded WASM SIMD;
- no pthreads;
- no SharedArrayBuffer requirement;
- no shared WebAssembly memory.

Do not restart the rejected whole-extractor LLVM migration without new evidence.
Previous reproduction showed incompatibilities in SphinxBase, FFmpeg 4.2 and
old/new Emscripten/Whisper SIMD combinations.

Romanian model lifecycle:
`download -> SHA-256 verify -> store in IDBFS -> ready -> reuse locally`

The service worker intentionally avoids duplicating large `assets/data/`
packages in Cache Storage; language/model persistence is handled by application
IDBFS.

Third-party notices are recorded in `THIRD_PARTY_NOTICES.md` for whisper.cpp
and the Whisper model. Piper voices remain CI-only fixtures, not production
runtime dependencies.

## Romanian long-title performance and adaptive convergence

### Physical performance problem that triggered the work

The user tested a real >2 GB dual-audio MKV on physical iPhone Safari with a
Romanian SRT deliberately shifted by more than 10 s and Romanian audio selected.

Observed on the pre-optimization build:
- direct >2 GB MKV opened successfully;
- Romanian track selection worked;
- Romanian Whisper model download worked;
- synchronization produced enough evidence to enable saving after roughly five minutes;
- the user saved that intermediate SRT rather than waiting for the projected long completion;
- the intermediate subtitle was improved but remained approximately 4–5 s out of sync.

This was treated as a partial real-device pass and a performance/convergence
problem, not as evidence that the container or Romanian ASR path was broken.

### PR #27 — first sparse-window optimization

PR #27 `Speed up Romanian ASR with distributed sparse windows` merged at
`4e7c75b6c6f7fb86f78e85d4c8cf7ab776e136f5`.

It changed long Romanian-audio titles from whole-title transcription to
distributed sparse probing while keeping one Whisper context for memory safety.
The first version used 16 × 30 s windows. It preserved the original sc0ty
correlator and all thresholds.

The first optimized preview deploy exposed an important limitation: the
authoritative Romanian fixture could still run out of workflow time before all
fixed windows completed. Do not interpret that as a synchronization-algorithm
failure.

### PR #28 — rejected fixed-budget reduction

PR #28 `Bound Romanian sparse ASR to four minutes` attempted a fixed
20 × 12 s / 240 s maximum scan.

It was **not merged**. Its authoritative fresh-WASM Romanian E2E reached useful
recognition evidence but hit the timeout before completion. The lesson is
explicit: do not keep shrinking fixed windows arbitrarily and do not weaken
canonical synchronization thresholds to manufacture a pass.

### PR #29 — current adaptive design

PR #29 `Verify Romanian ASR adaptively before early completion` merged at
`9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`.

Current planner for titles longer than 240 s:
- 16 candidate windows;
- 15 s per window;
- one Whisper context / one Romanian reference worker;
- farthest-first temporal order: beginning/end coverage first, then repeatedly
  fill the largest timeline gaps;
- maximum fixed budget remains 240 s of candidate audio, but the job can stop
  earlier once convergence is independently verified;
- titles at or below 240 s keep full-scan behavior.

Adaptive early completion requires all of the following:
- normal sc0ty correlation must already be canonical; no threshold is relaxed;
- at least 4 usable words in a confirming probe;
- at least 1 new canonical synchronization point for each added confirmation;
- at least 3 stable correlated confirmations;
- actual used correlation evidence must span at least 75% of title duration;
- formula movement may be at most 0.75 s when evaluated across the title;
- an inconclusive/silent probe is neutral;
- a materially different canonical formula resets the stability sequence.

The correlator now exposes a fresh raw snapshot at Romanian probe boundaries,
including the reference-time span of points actually used by correlation. The
persistent final status still uses canonical-status selection, so weaker
intermediate snapshots do not overwrite a stronger valid solution.

Authoritative fresh-WASM result on the final PR #29 head
`ea980e318a5809d15343a1d0e5e321cd0b3132a4`:
- Legacy WebAssembly Build `34746893076`: **PASS**;
- MKV WASM Fast Diagnostic `34746893040`: **PASS**;
- Mobile WebKit Compatibility `34746893081`: **PASS**;
- Large-file Browser Stress `34746893052`: **PASS**;
- governance CI `34746893077`: **PASS**;
- Chromium Romanian E2E: 11/16 probes, 182 reference words, 25 points,
  100.00%, formula `1.0001x-8.843`, saved shift `-8.842 s`;
- iPhone-like WebKit Romanian E2E: the same 11/16 probes, 182 words, 25 points,
  100.00%, the same formula and saved shift;
- zero console, page and HTTP errors in both.

The 11 completed 15 s probes correspond to 165 s of planned Romanian audio
windows in this automated fixture, versus consuming the full 240 s candidate
budget. This is an automated-browser result, not a promise of a specific
physical-iPhone wall-clock time.


### Physical iPhone reproduction — 13 September 2026

The first full physical retest of the PR #29 adaptive build used the public
Pages PWA on real iPhone/Safari with a real >2 GB dual-audio
`Frozen.II.2019.1080p.10bit.BluRay.Dual.RoDubbed.x265.HEVC-PSA.mkv`,
Romanian audio selected, and the corresponding Romanian SRT.

Observed evidence:
- Romanian Whisper model was already **Cached · 30.7 MiB**, so model download
  time did not explain the runtime;
- at elapsed **5:23**, probe **9/16**:
  - 84 reference words;
  - 10 synchronization points;
  - displayed correlation 100.00%;
  - formula `1.0004x-1.851`;
  - max change `0:01:829`;
  - stable checks 0;
  - evidence span 0%;
  - adaptive lock pending;
  - **Save subtitles was incorrectly enabled while the adaptive lock was
    pending**;
- at elapsed **10:05**, probe **16/16**:
  - 151 reference words;
  - 15 synchronization points;
  - displayed correlation 100.00%;
  - formula `1.0007x-2.531`;
  - max change `0:02:495`;
  - stable checks 0;
  - evidence span 0%;
  - adaptive lock pending;
  - terminal state: `Synchronization inconclusive`;
  - diagnostic: 15 points found, canonical minimum remains 20.

The user reports that the output behavior recovered most of the deliberately
large (>10 s) offset but remained visibly out of sync. Treat that as practical
device evidence, while the noncanonical intermediate formula itself must not be
treated as an accepted final synchronization result.

Confirmed conclusions:
- the physical failure is **not** caused by lowering/raising thresholds; the
  canonical 20-point guard correctly rejected an under-evidenced result;
- Romanian ASR itself produced substantial evidence (151 reference words), but
  the 16 × 15 s primary sample budget produced only 15 canonical candidate
  points on this real title;
- the synthetic fixture was easier than this real movie and therefore cannot be
  the sole release criterion;
- exposing Save while `adaptive lock: pending` is a real UX/safety bug.

### PR #32 — rescue probes and fail-closed Save policy

PR #32 `Add Romanian rescue probes for real iPhone convergence` merged at
`b8c8a292957fce2f509c43d95c357091ae45adb3`.

The fix is driven directly by the 13 September physical iPhone reproduction and
preserves the successful primary path:
- primary stage remains **16 × 15 s** progressive/farthest-first probes;
- if adaptive convergence verifies during primary, processing stops early as
  before;
- if primary probing does not verify, up to **8 rescue probes** are appended
  from previously unscanned timeline gaps;
- rescue windows are capped at 15 s and may be shorter where only a smaller
  unused gap remains;
- primary and rescue windows do not intentionally overlap;
- maximum long-title sparse candidate count is **24**;
- maximum sampled Romanian audio is **360 s / 6 minutes**;
- one Romanian Whisper context/worker is retained for memory safety;
- canonical sc0ty thresholds remain unchanged.

Runtime diagnostics expose:
- `primaryWindows`;
- `rescueWindowsTotal`;
- `rescueWindowsCompleted`;
- phase `primary` / `rescue`.

The Save policy is fail-closed for long Romanian adaptive runs:
- `Save subtitles` remains disabled while adaptive lock is pending;
- `subReady` alone is insufficient for this path;
- the weaker legacy `Synchronization inconclusive` save fallback is forbidden
  for Romanian adaptive runs;
- export is enabled only after verified adaptive convergence;
- non-Romanian legacy behavior remains unchanged.

Regression coverage includes the unit-level `tests/js/save-policy.js` check
and browser monitoring that fails if Save becomes enabled while the UI still
reports `adaptive lock: pending`.

PR #32 gates, main CI, deliberate deploy and post-deploy live smoke are all
green. The remaining validation is physical-device rescue behavior on the same
real-title class; no automated WebKit result is labeled as a physical iPhone
test.

## Merged-main release-candidate validation

Release-candidate regression was run from exact merged-main commit
`46372bb9e4f3ae4cf6d12a8b640aed33d5ade172`.

All required gates passed:
- CI `34715999591`: **PASS**;
- Legacy WebAssembly Build `34716200123`: **PASS**;
- MKV WASM Fast Diagnostic `34716202061`: **PASS**;
- Mobile WebKit Compatibility `34716200576`: **PASS**;
- Large-file Browser Stress `34716202978`: **PASS**.

Fresh Legacy validation re-confirmed:
- legacy extractor/correlator build;
- isolated Whisper SIMD build;
- no-shared-memory assertions;
- runtime `WASM_SIMD = 1`;
- canonical MKV matrix and split-window seek regression;
- ENG-audio + RO-subtitle E2E;
- PWA shell;
- language download/cache UX;
- pinned upstream language loading;
- primary real-PWA flow;
- Romanian-audio Chromium E2E;
- Romanian-audio iPhone-like WebKit E2E.

Merged-main Romanian E2E in both Chromium and WebKit:
- 140 usable Romanian reference words;
- 23 synchronization points;
- displayed correlation 99.99%;
- formula `0.9990x-8.234`;
- saved timing correction `-8.243 s` for the known +8.0 s fixture;
- model lifecycle download -> verify -> store -> ready;
- Romanian diacritics preserved;
- zero console errors, page errors and HTTP failures.

## Deliberate preview deployment and live public verification

Production auto-deploy remains disabled. Moving `deploy/pages-preview` remains
a deliberate release action.

### PR #29 historical adaptive deployment

PR #29 product runtime
`9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7` was the first deployed adaptive
release. Deploy `34747503470` passed. Its post-deploy retry
`34749671716` passed and established the permanent live regression baseline.
PR #30 later strengthened that regression and recorded a live adaptive lock
after 10/16 probes in run `34749834500`.

### PR #32 historical deployed runtime

The current product runtime is PR #32 merge commit
`b8c8a292957fce2f509c43d95c357091ae45adb3`.

Deliberate deployment:
- Deploy PWA Preview `34759835092`: **PASS**;
- authoritative build job: **PASS**;
- fresh legacy WebAssembly extractor/correlator: **PASS**;
- isolated Romanian Whisper SIMD: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- Pages deploy job: **PASS**.

Post-deploy public verification:
- Public Pages Language Smoke `34760470647`: **PASS**;
- representative original-language delivery checks: **PASS**;
- full signed 226-package catalog checks: **PASS**;
- live Romanian reference words: **167**;
- adaptive lock: **verified after 10/24 probes**;
- synchronization points: **28**;
- displayed correlation: **100.00%**;
- formula: `0.9994x-8.584`;
- saved timing correction: **-8.597 s** for the known +8 s fixture;
- `whisper.js` and `whisper.wasm`: HTTP 200 with query/version hash
  `b8c8a292957fce2f509c43d95c357091ae45adb3`;
- pinned Romanian model: HTTP 200;
- model lifecycle download -> verify -> store -> ready: **PASS**;
- Romanian diacritics preserved;
- zero console, page and HTTP errors.

Because this deterministic public fixture converged at 10/24, it did not enter
rescue. This is expected and confirms the primary fast path was not regressed.
The physical Frozen II retest remains the authoritative test of the rescue
phase and of real-iPhone wall-clock/practical alignment.


### PR #34 current deployed runtime

Current product runtime:
`d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`.

PR #34 gates:
- CI `34780660040`: **PASS**;
- Mobile WebKit Compatibility `34780660115`: **PASS**;
- Large-file Browser Stress `34780660006`: **PASS**;
- Legacy WebAssembly Build `34780660103`, attempt 2: **PASS**.

Merged-main gate:
- CI `34783010599`: **PASS**.

Deliberate deployment:
- Deploy PWA Preview `34783030385`: **PASS**;
- fresh legacy WebAssembly extractor/correlator: **PASS**;
- isolated Romanian Whisper SIMD: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- Pages deployment: **PASS**.

Post-deploy public validation:
- Public Pages Language Smoke `34783620010`: **PASS**;
- exact live JS/WASM version hash:
  `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
- live Romanian reference words: **148**;
- adaptive lock: **verified after 9/20 probes**;
- synchronization points: **26**;
- displayed correlation: **100.00%**;
- formula: `1.0002x-8.884`;
- saved timing correction: **-8.880 s**;
- zero console, page and HTTP errors.

This deterministic fixture converged before rescue, which is correct for the
preserved primary fast path. It does not substitute for the real physical
Frozen II rescue reproduction.

## MKV reliability status

Historical observation: some real direct MKV + SRT files failed while extracted
audio + the same SRT worked. The exact historical root cause remains unconfirmed
without a representative original failing file.

Confirmed deterministic reliability fix:
- split-window seek could jump forward to a later keyframe and leave a gap;
- `Demux::seek()` now uses `AVSEEK_FLAG_BACKWARD`;
- requested 62.5 s seek previously observed first packet at 70.0 s;
- fixed fresh-WASM regression observed packet coverage from 60.0 s around the
  requested start;
- do not present this as the universal root cause of every historical MKV.

Current matrix includes successful deterministic coverage for:
- AAC;
- AC3;
- E-AC3;
- H.264 + stereo AAC;
- HEVC/H.265 + E-AC3 5.1;
- multiple/reversed audio tracks;
- embedded subtitles;
- Romanian subtitles;
- split-window seeking.

## Large-file browser stress

Canonical generated direct-MKV fixture:
- H.264 1280x720;
- English AAC reference audio;
- duration 90.064 s;
- 143,952,449 bytes = 137.28 MiB.

Merged-main stress run `34716202978`: **PASS** in Chromium and iPhone-like
WebKit.

Observed process-tree RSS on Linux CI for that RC:
- Chromium peak: 1071.08 MiB;
- WebKit peak: 1779.86 MiB.

These values are regression baselines only. They are not exact browser-tab
memory and are not physical-iPhone memory measurements. The synthetic stress
audio intentionally produces no useful speech words; the test measures direct
MKV/WORKERFS/browser survival rather than speech accuracy.

## PWA / cache / diagnostics status

Implemented and regression-tested:
- installable PWA shell;
- subpath-safe GitHub Pages hosting;
- service worker with SubSync2-scoped cache cleanup;
- language/model download progress;
- IDBFS reuse across runs;
- deliberate language-data cache cleanup;
- same-origin original-language asset delivery;
- stage-specific diagnostics for initialization, language assets, pipeline,
  demux, decode, resample, speech recognition, subtitles, dictionary,
  processing and correlation;
- evidence counts for decoded subtitles, subtitle words, reference words and
  synchronization points;
- corrected SRT download.

Failure diagnostics must distinguish observed evidence from an unproven root
cause. Native exception module/stage information is authoritative when present.

## Physical iPhone status

The primary ENG-audio + RO-subtitle workflow was previously confirmed on a real
iPhone/Safari device.

Romanian audio physical status:

1. **Pre-adaptive test — partial PASS**
   - real >2 GB direct MKV opened;
   - Romanian audio selected;
   - Romanian model and local processing worked;
   - an early save improved timing but remained materially inaccurate.

2. **PR #29 16-probe adaptive retest — FAIL / INCONCLUSIVE**
   - real iPhone/Safari;
   - Frozen II >2 GB dual-audio MKV;
   - model reused from cache;
   - run stayed foregrounded and reached terminal state;
   - 10:05 elapsed;
   - 16/16 probes completed;
   - 151 reference words;
   - 15 points versus canonical minimum 20;
   - adaptive lock never verified;
   - practical synchronization remained incorrect;
   - Save was observed enabled prematurely at 9/16 while lock was pending.

3. **PR #32 uniform rescue retest — FAIL / INCONCLUSIVE**
   - product runtime:
     `b8c8a292957fce2f509c43d95c357091ae45adb3`;
   - real iPhone/Safari, same Frozen II title;
   - Cached Romanian model;
   - 17:30 elapsed;
   - 24/24 probes, rescue 8/8;
   - 224 reference words;
   - 18 points versus canonical minimum 20;
   - displayed 100.00% correlation but adaptive lock pending;
   - provisional formula `1.0002x-1.029`;
   - uniform rescue improved 15 -> 18 points but remained insufficient.

4. **PR #34 content-aware contextual rescue — PHYSICAL FAIL / INCONCLUSIVE**
   - product runtime:
     `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
   - real iPhone/Safari, same Frozen II title;
   - 12:52 elapsed;
   - 20/20 probes, rescue 4/4;
   - 243 reference words;
   - 26 points;
   - candidate gain +4;
   - candidate and canonical span 81%;
   - stable checks 2/3;
   - adaptive lock pending;
   - displayed correlation 100.00%;
   - provisional formula `1.0002x-0.950`;
   - max change `0:00:941`;
   - canonical point/span guards were satisfied, but verification did not reach
     the required third stable confirmation.

5. **PR #36 context-anchor + confirmation-reserve — PHYSICAL PASS / FINE TIMING FOLLOW-UP**
   - product runtime:
     `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
   - real iPhone/Safari, same Frozen II title;
   - 12:42 elapsed;
   - 21/21 probes, rescue 5/5;
   - 248 reference words;
   - 185 Romanian context anchors;
   - 25 points;
   - candidate gain +1;
   - candidate and canonical span 81%;
   - stable checks 3/3;
   - adaptive lock verified;
   - displayed correlation 100.00%;
   - formula `1.0002x-0.943`;
   - max change `0:00:933`;
   - practical synchronization succeeded, with a reported residual timing bias
     of approximately 200–300 ms early versus the preferred original timing.

6. **PR #38 midpoint timing alignment — PHYSICAL PASS**
   - runtime:
     `ff81b54509d5ec766200f5d724c9ca8f505fbbe3`;
   - original PocketSphinx midpoint timing semantics are now used by Romanian
     Whisper reference words;
   - context-anchor acoustic bounds remain correct for centered reference words;
   - no hard-coded device/title timing offset was introduced;
   - exact post-deploy public smoke is green;
   - real iPhone/Safari Frozen II retest verified adaptive lock after 20/21
     probes and produced 26 points over 81% canonical span;
   - exact SRT-vs-original comparison shows 94.4 ms mean absolute start error,
     78 ms median absolute start error, p95 226.6 ms and max 283 ms;
   - the midpoint fix materially reduces the previous physical residual and is
     the current physically validated Romanian single-file baseline.

Model bytes persist through browser IDBFS. Active job persistence/resume across
Safari background suspension is still not implemented; physical release tests
must keep Safari foregrounded unless resume behavior is explicitly under test.

## Fork / modernization review

The September 2026 fork review produced a selective-harvest decision, not a
repository migration.

Reviewed directions included:
- `blaaaakuu/subsync`: GPU word-matching/build modernization ideas;
- `Sefzz15/subsync`: optional piecewise/nonlinear synchronization ideas;
- `neck0l/subsync`: multi-engine ASR architecture including Vosk/Whisper;
- `pedromsilvapt/subsync`: conservative browser/no-pthreads build lessons;
- `chid/subsync`: core robustness/thread-safety patterns;
- modernized derivatives such as `CoolFreeze23/subsync-ptbr`: useful bug
  patterns only.

Canonical decisions:
- do **not** replace SubSync2 wholesale with another fork;
- GPU word matching is not the current iPhone priority because Romanian runtime
  is dominated by local ASR, and CUDA/OpenCL is not a Safari solution;
- piecewise synchronization is interesting as a future optional advanced mode
  for cuts/edition differences, but must not mask incomplete ASR or replace the
  original sc0ty linear path by default;
- multi-ASR abstraction is strategically interesting, but Romanian Whisper
  remains the current engine until another Romanian model is independently
  vetted for quality, licensing and browser memory/runtime;
- do not lower `minPointsNo`, correlation or other canonical thresholds based
  on fork behavior;
- modernization should be imported as small reviewed ideas, with SubSync2 tests
  and invariants remaining authoritative.
- a simple Android/NVIDIA Shield Pro application is a future product option,
  but only after the browser single-file workflow is release-stable on the
  physical iPhone; it should reuse the validated synchronization/ASR concepts
  or core rather than diverge into a second algorithm prematurely.

## Next sequence

### Product decision after PR #38 physical validation

The PR #38 runtime
`ff81b54509d5ec766200f5d724c9ca8f505fbbe3`
is the physically validated Romanian single-file baseline.

Do **not** chase the remaining Frozen II residual with a constant millisecond
offset. The exact comparison already shows the sign changes across the title,
so a fixed compensation would overfit one reproduction and can regress other
titles.

The agreed engineering sequence is:

1. **Formula Confidence + Precision Diagnostics**
   - expose confidence/robustness of the accepted linear formula without
     changing canonical acceptance;
   - report point distribution across beginning/middle/end;
   - report sensitivity of `a` / `b` and mapped title timing to evidence
     removal / perturbation where technically safe;
   - distinguish canonical acceptance from precision confidence;
   - keep the current formula as the saved output during this sprint.

2. **Real-title validation set**
   - validate the stable runtime / diagnostics on approximately 3–5 real titles
     rather than optimizing against Frozen II alone;
   - include different error classes when possible: near-synchronized,
     constant-offset, small-drift, and edition/cut differences;
   - use those results to decide whether a common systematic bias actually
     exists.

3. **Precision Polish only if evidence justifies it**
   - if multiple real titles show a repeatable residual, introduce an optional
     post-lock robust refinement of slope/intercept;
   - this refinement may improve precision but must not decide whether a
     synchronization is canonical;
   - do not simply uncomment historical score multiplication inside the
     correlator and do not weaken sc0ty thresholds.

4. **Product expansion after precision confidence**
   - local sequential Batch / Queue to avoid iPhone memory spikes;
   - checkpoint/resume across Safari suspension or interrupted runs;
   - smarter audio/subtitle language-track selection;
   - final user-facing quality score such as Excellent / Good / Uncertain based
     on evidence, not only displayed correlation;
   - before/after timing preview at beginning / middle / end;
   - language/dictionary compatibility matrix and integrity/coverage audit;
   - optional piecewise mode later for true cut/edition differences, never as
     the default replacement for the canonical linear sc0ty path.

Guardrails for all of the above:
- canonical thresholds remain unchanged;
- normal Romanian sampled-audio budget remains 360 s; only a late canonical
  lock may use the separately justified confirmation-only reserve, capped at
  90 additional seconds / 450 s absolute maximum;
- browser-local processing remains mandatory;
- no paid API/service without explicit user approval;
- no title/device-specific timing constants;
- repository truth and branch -> PR -> CI green -> merge remain mandatory.

Immediate sprint: **Formula Confidence + Precision Diagnostics**.


## Session closeout — 13 September 2026

Confirmed state at closeout:
- repository truth and branch -> PR -> green CI -> merge remain mandatory;
- PR #32 physical uniform rescue failed at 18/20 points after 24/24 probes;
- no canonical sc0ty threshold was weakened;
- PR #34 content-aware point-gain-first rescue is merged at
  `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
- PR #34 CI/WebKit/stress/fresh-WASM gates are green;
- main CI `34783010599` is green;
- deliberate Deploy PWA Preview `34783030385` is green;
- post-deploy Public Pages Language Smoke `34783620010` is green;
- live `whisper.js` / `whisper.wasm` carry exact runtime hash
  `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
- live Romanian fixture converged after 9/20 primary probes with 148 reference
  words and 26 points, so rescue was correctly not consumed by that fixture;
- Romanian adaptive Save remains fail-closed until verified lock;
- candidate evidence diagnostics now remain useful before the 20-point
  canonical gate;
- iPhone-like WebKit CI remains automation, not physical-iPhone evidence;
- Safari background job resume is still not implemented;
- browser-first/local processing, GPLv3/sc0ty attribution, original catalog and
  no-paid-service-without-approval rules remain unchanged;
- Android/NVIDIA Shield and batch/multi-upload work remain deferred until the
  web single-file path is physically release-stable.

## Open blockers

- Romanian single-file synchronization now has a physical PASS on PR #38 and
  exact SRT comparison confirms sub-300 ms maximum start error on the Frozen II
  reproduction, but a small affine residual remains if further fine-polish is
  desired;
- browser job resume/persistence across Safari suspension/backgrounding is not
  implemented;
- the historical real-world direct-MKV failure class remains
  reproduction-dependent on a representative failing file;
- not every original sc0ty language/model pair has a dedicated full
  recognition/correlation E2E, although the complete signed catalog is deployed
  and representative live loading is validated;
- batch/multi-upload remains deliberately deferred pending the next product
  decision.
