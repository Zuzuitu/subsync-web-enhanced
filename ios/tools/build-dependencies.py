#!/usr/bin/env python3
"""Build repository-pinned, static, file-only media dependencies for Apple targets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "ios"
PINS = json.loads((ROOT / "config/legacy-build-pins.json").read_text())
LIBS = ["libavformat.a", "libavcodec.a", "libswresample.a", "libavutil.a", "libpocketsphinx.a", "libsphinxbase.a"]

def output(args):
    return subprocess.check_output(args, text=True).strip()

def run(args, cwd=None, env=None):
    print("+", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)

def build(target, arch):
    if platform.system() != "Darwin":
        raise SystemExit("This cross-build uses Apple's SDKs and must run on macOS/Xcode")
    sdk_name = "macosx" if target == "macos" else target
    sdk = output(["xcrun", "--sdk", sdk_name, "--show-sdk-path"])
    clang = output(["xcrun", "--sdk", sdk_name, "--find", "clang"])
    triple = arch + {"macos": "-apple-macos14.0", "iphoneos": "-apple-ios26.0", "iphonesimulator": "-apple-ios26.0-simulator"}[target]
    prefix = IOS / "vendor" / f"{target}-{arch}"
    fingerprint = hashlib.sha256((Path(__file__).read_text() + json.dumps(PINS, sort_keys=True)
        + sdk + output([clang, "--version"]) + triple).encode()).hexdigest()
    stamp = prefix / "build-manifest.json"
    if stamp.exists() and json.loads(stamp.read_text()).get("fingerprint") == fingerprint \
            and all((prefix / "lib" / lib).is_file() for lib in LIBS):
        print("Verified dependency cache:", prefix)
        return
    prefix.mkdir(parents=True, exist_ok=True)
    sources = IOS / "vendor" / "sources"
    sources.mkdir(parents=True, exist_ok=True)
    revisions = {}
    flags = f"-target {triple} -isysroot {sdk} -O2 -fPIC"
    base_env = os.environ.copy()
    base_env.update(CC=f"{clang} -target {triple} -isysroot {sdk}", CFLAGS="-O2 -fPIC",
                    CPPFLAGS=f"-I{prefix}/include", LDFLAGS=f"-target {triple} -isysroot {sdk} -L{prefix}/lib",
                    PKG_CONFIG_PATH=str(prefix / "lib/pkgconfig"), NOCONFIGURE="1")
    for name in ("ffmpeg", "sphinxbase", "pocketsphinx"):
        pin = PINS[name]
        source = sources / name
        ref = pin.get("sha", pin.get("ref"))
        if not (source / ".git").exists():
            run(["git", "init", source])
            run(["git", "remote", "add", "origin", "https://github.com/" + pin["repository"] + ".git"], source)
        run(["git", "fetch", "--depth", "1", "origin", ref], source)
        run(["git", "checkout", "--detach", "FETCH_HEAD"], source)
        revision = output(["git", "-C", str(source), "rev-parse", "HEAD"])
        if "sha" in pin and revision != pin["sha"]:
            raise SystemExit("Pinned source mismatch: " + name)
        if "ref" in pin and output(["git", "-C", str(source), "describe", "--tags", "--exact-match"]) != pin["ref"]:
            raise SystemExit("Pinned source tag mismatch: " + name)
        revisions[name] = revision
        directory = IOS / "vendor" / "work" / f"{target}-{arch}" / name
        if directory.exists(): shutil.rmtree(directory)
        shutil.copytree(source, directory, ignore=shutil.ignore_patterns(".git"))
        if name == "ffmpeg":
            codecs = "aac,aac_fixed,aac_latm,ac3,eac3,dca,flac,mp3,mp3float,opus,vorbis,alac,truehd,mlp,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,subrip,ssa,ass,movtext"
            run(["./configure", f"--prefix={prefix}", "--target-os=darwin",
                 "--arch=" + ("aarch64" if arch == "arm64" else arch), "--enable-cross-compile",
                 "--cc=" + clang, "--extra-cflags=" + flags, "--extra-ldflags=" + flags,
                 "--disable-everything", "--disable-autodetect", "--disable-programs", "--disable-doc",
                 "--disable-shared", "--enable-static", "--disable-asm", "--disable-network",
                 "--disable-avdevice", "--disable-avfilter", "--disable-swscale", "--disable-postproc",
                 "--enable-avformat", "--enable-avcodec", "--enable-swresample", "--enable-avutil",
                 "--enable-protocol=file", "--enable-demuxer=matroska,mov,mp3,wav,flac,ogg,aac,ac3,eac3,srt,ass",
                 "--enable-decoder=" + codecs,
                 "--enable-parser=aac,aac_latm,ac3,dca,flac,mpegaudio,opus,vorbis,h264,hevc",
                 "--enable-zlib", "--enable-iconv"], directory)
        else:
            (directory / "src/Makefile.am").write_text("SUBDIRS = " + ("libsphinxbase" if name == "sphinxbase" else "libpocketsphinx") + "\n")
            env = base_env.copy()
            if name == "pocketsphinx":
                env["SPHINXBASE_CFLAGS"] = f"-I{prefix}/include/sphinxbase -I{prefix}/include"
                env["SPHINXBASE_LIBS"] = f"-L{prefix}/lib -lsphinxbase -lm"
            run(["sh", "autogen.sh"], directory, env)
            configure = ["./configure", f"--prefix={prefix}", "--without-python", "--disable-shared", "--enable-static"]
            if target != "macos": configure += ["--host=arm-apple-darwin"]
            if name == "pocketsphinx": configure += [f"--with-sphinxbase={prefix}"]
            run(configure, directory, env)
        run(["make", "-j", "3"], directory, None if name == "ffmpeg" else env)
        run(["make", "install"], directory, None if name == "ffmpeg" else env)
        notices = prefix / "licenses" / name
        notices.mkdir(parents=True, exist_ok=True)
        for notice in list(source.glob("COPYING*")) + list(source.glob("LICENSE*")):
            if notice.is_file(): shutil.copy2(notice, notices / notice.name)
    for lib in LIBS:
        assert (prefix / "lib" / lib).is_file(), lib
        actual = output(["xcrun", "lipo", "-archs", str(prefix / "lib" / lib)])
        assert actual == arch, (lib, actual, arch)
    stamp.write_text(json.dumps({"fingerprint": fingerprint, "platform": target, "arch": arch,
        "sdk": sdk, "triple": triple, "revisions": revisions, "network": False,
        "libraries": LIBS}, indent=2) + "\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=["macos", "iphoneos", "iphonesimulator"], required=True)
    parser.add_argument("--arch", choices=["arm64", "x86_64"], required=True)
    args = parser.parse_args()
    build(args.platform, args.arch)
