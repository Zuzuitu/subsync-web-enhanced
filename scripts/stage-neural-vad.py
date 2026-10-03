"""Stage immutable, checksum-verified local voice runtime and license notices."""
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path


def checked(data, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Neural VAD asset SHA-256 mismatch")
    return data


def download(asset):
    with urllib.request.urlopen(asset["url"], timeout=240) as response:
        return checked(response.read(), asset["sha256"])


def stage(dist):
    config = json.loads((Path(__file__).resolve().parents[1] / "config/neural-vad.json").read_text())
    target = Path(dist) / "scripts/vad" / config["directory"]
    target.mkdir(parents=True, exist_ok=True)
    records = []

    def write(name, data, digest):
        # Never extract archive paths. Only exact allowlisted regular files.
        if Path(name).name != name:
            raise ValueError("Invalid neural VAD asset name")
        (target / name).write_bytes(checked(data, digest))
        records.append({"filename": str((target / name).relative_to(dist)),
                        "sha256": digest, "bytes": len(data)})

    with tarfile.open(fileobj=io.BytesIO(download(config["runtimeArchive"])), mode="r:gz") as archive:
        for name, digest in config["runtimeFiles"].items():
            member = archive.getmember("package/dist/" + name)
            if not member.isfile():
                raise ValueError("Neural VAD archive member is not a regular file")
            write(name, archive.extractfile(member).read(), digest)
    for asset in config["files"]:
        write(asset["name"], download(asset), asset["sha256"])
    return {"directory": config["directory"], "modelCommit": config["modelCommit"],
            "runtimeCommit": config["runtimeCommit"], "files": records}


if __name__ == "__main__":
    import sys
    print(json.dumps(stage(Path(sys.argv[1])), indent=2))
