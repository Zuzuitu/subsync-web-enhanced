#!/usr/bin/env python3
import argparse
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--destination", required=True)
args = parser.parse_args()

source = Path(args.source).resolve()
destination = Path(args.destination).resolve()

required = [
    "whisper.cpp",
    "whisper.h",
    "ggml.c",
    "ggml.h",
    "ggml-impl.h",
    "ggml-alloc.c",
    "ggml-alloc.h",
    "ggml-backend.c",
    "ggml-backend.h",
    "ggml-backend-impl.h",
    "ggml-quants.c",
    "ggml-quants.h",
]
missing = [name for name in required if not (source / name).is_file()]
if missing:
    raise SystemExit("Pinned whisper.cpp source is incomplete: " + ", ".join(missing))

if destination.exists():
    shutil.rmtree(destination)
destination.mkdir(parents=True)

for name in required:
    shutil.copy2(source / name, destination / name)

ggml_path = destination / "ggml.c"
text = ggml_path.read_text(encoding="utf-8")

include_old = """#else
#include <pthread.h>
#include <stdatomic.h>

typedef void * thread_ret_t;
"""
include_new = """#else
#if !(defined(__EMSCRIPTEN__) && defined(SUBSYNC2_WHISPER_SINGLE_THREAD))
#include <pthread.h>
#endif
#if defined(__EMSCRIPTEN__)
#include <sched.h>
#endif
#include <stdatomic.h>

typedef void * thread_ret_t;
"""
if include_old not in text:
    raise SystemExit("whisper.cpp ggml.c pthread include guard changed unexpectedly")
text = text.replace(include_old, include_new, 1)

thread_old = """typedef pthread_t ggml_thread_t;

#define ggml_thread_create pthread_create
#define ggml_thread_join   pthread_join
"""
thread_new = """#if defined(__EMSCRIPTEN__) && defined(SUBSYNC2_WHISPER_SINGLE_THREAD)
typedef int ggml_thread_t;
#define ggml_thread_create(out, attr, fn, arg) (-1)
#define ggml_thread_join(thread, result) (-1)
#else
typedef pthread_t ggml_thread_t;
#define ggml_thread_create pthread_create
#define ggml_thread_join   pthread_join
#endif
"""
count = text.count(thread_old)
if count != 2:
    raise SystemExit(f"Expected two whisper.cpp ggml thread adapter blocks, found {count}")
text = text.replace(thread_old, thread_new)

linux_affinity_old = "#if defined(__linux__) && !defined(__BIONIC__)"
linux_affinity_new = "#if defined(__linux__) && !defined(__BIONIC__) && !(defined(__EMSCRIPTEN__) && defined(SUBSYNC2_WHISPER_SINGLE_THREAD))"
if linux_affinity_old not in text:
    raise SystemExit("whisper.cpp Linux affinity guard changed unexpectedly")
text = text.replace(linux_affinity_old, linux_affinity_new, 1)

ggml_path.write_text(text, encoding="utf-8")


whisper_path = destination / "whisper.cpp"
whisper = whisper_path.read_text(encoding="utf-8")

replacements = [
    (
"""    {
        std::vector<std::thread> workers(n_threads - 1);
        for (int iw = 0; iw < n_threads - 1; ++iw) {
            workers[iw] = std::thread(
                    log_mel_spectrogram_worker_thread, iw + 1, std::cref(hann), samples_padded,
                    n_samples + stage_2_pad, frame_size, frame_step, n_threads,
                    std::cref(filters), std::ref(mel));
        }

        // main thread
        log_mel_spectrogram_worker_thread(0, hann, samples_padded, n_samples + stage_2_pad, frame_size, frame_step, n_threads, filters, mel);

        for (int iw = 0; iw < n_threads - 1; ++iw) {
            workers[iw].join();
        }
    }
""",
"""    {
        // SubSync2's browser adapter deliberately runs Whisper without pthreads.
        // The production caller always passes n_threads=1.
        log_mel_spectrogram_worker_thread(
                0, hann, samples_padded, n_samples + stage_2_pad,
                frame_size, frame_step, 1, filters, mel);
    }
"""
    ),
    (
"""        /*.n_threads         =*/ std::min(4, (int32_t) std::thread::hardware_concurrency()),
""",
"""        /*.n_threads         =*/ 1,
"""
    ),
    (
"""                    const int n_threads = std::min(params.n_threads, n_decoders_cur);

                    if (n_threads == 1) {
                        process();
                    } else {
                        std::vector<std::thread> threads(n_threads - 1);

                        for (int t = 0; t < n_threads - 1; ++t) {
                            threads[t] = std::thread(process);
                        }

                        process();

                        for (int t = 0; t < n_threads - 1; ++t) {
                            threads[t].join();
                        }
                    }
""",
"""                    // SubSync2 single-thread browser build.
                    process();
"""
    ),
    (
"""                        const int n_threads = std::min(params.n_threads, n_decoders_cur);

                        if (n_threads == 1) {
                            process();
                        } else {
                            std::vector<std::thread> threads(n_threads - 1);

                            for (int t = 0; t < n_threads - 1; ++t) {
                                threads[t] = std::thread(process);
                            }

                            process();

                            for (int t = 0; t < n_threads - 1; ++t) {
                                threads[t].join();
                            }
                        }
""",
"""                        // SubSync2 single-thread browser build.
                        process();
"""
    ),
    (
"""    for (int32_t k = 1; k <= n_threads; k++) {
""",
"""#if defined(SUBSYNC2_WHISPER_SINGLE_THREAD)
    n_threads = 1;
#endif
    for (int32_t k = 1; k <= n_threads; k++) {
"""
    ),
    (
"""        std::vector<std::thread> threads(k - 1);
        for (int32_t th = 0; th < k - 1; ++th) {
            threads[th] = std::thread(helper, th);
        }

        helper(k - 1);

        for (int32_t th = 0; th < k - 1; ++th) {
            threads[th].join();
        }
""",
"""        helper(0);
"""
    ),
]

for old, new in replacements:
    count = whisper.count(old)
    if count != 1:
        raise SystemExit(
            "whisper.cpp single-thread patch drift: "
            + old.splitlines()[0]
            + f" (expected 1, found {count})"
        )
    whisper = whisper.replace(old, new, 1)

parallel_start = whisper.find("int whisper_full_parallel(")
parallel_end = whisper.find(
    "\nint whisper_full_n_segments_from_state",
    parallel_start,
)
if parallel_start < 0 or parallel_end < 0:
    raise SystemExit("Could not isolate whisper_full_parallel in pinned whisper.cpp")

parallel_stub = """int whisper_full_parallel(
        struct whisper_context * ctx,
        struct whisper_full_params params,
        const float * samples,
        int n_samples,
        int n_processors) {
    if (n_processors != 1) {
        return -1;
    }
    return whisper_full(ctx, params, samples, n_samples);
}
"""
whisper = whisper[:parallel_start] + parallel_stub + whisper[parallel_end:]

if "std::thread" in whisper:
    raise SystemExit("whisper.cpp still contains std::thread after single-thread preparation")

whisper_path.write_text(whisper, encoding="utf-8")

(destination / ".subsync2-single-thread").write_text(
    "whisper.cpp prepared for SubSync2 single-thread WebAssembly; n_threads must remain 1.\n",
    encoding="utf-8",
)
print(destination)
