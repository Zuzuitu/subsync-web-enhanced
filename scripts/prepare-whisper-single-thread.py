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

(destination / ".subsync2-single-thread").write_text(
    "whisper.cpp prepared for SubSync2 single-thread WebAssembly; n_threads must remain 1.\n",
    encoding="utf-8",
)
print(destination)
