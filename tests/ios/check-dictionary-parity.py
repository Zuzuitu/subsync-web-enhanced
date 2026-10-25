#!/usr/bin/env python3
"""Compare actual native loader code with actual production JS on the pinned data."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / "ios/Native/SubSyncMedia.cpp").read_text()
begin = source.index('        c->dictionary = std::make_shared<Dictionary>();')
end = source.index('        c->translator = ', begin)
loader = source[begin:end] # Actual implementation, not a second parser under test.
dictionary = ROOT / "tests/generated/en-ro-e2e/dictionary/dict/eng-rum.dict"
with tempfile.TemporaryDirectory(prefix="subsync-dictionary-") as temporary:
    temporary = Path(temporary)
    cpp = temporary / "loader.cpp"
    cpp.write_text('''#include "text/dictionary.h"
#include "text/utf8.h"
#include <fstream>
#include <iostream>
#include <memory>
#include <stdexcept>
struct Context { std::shared_ptr<Dictionary> dictionary; void check() {} };
std::string hex(const std::string &s) { const char *h="0123456789abcdef"; std::string out;
 for (unsigned char c:s) { out+=h[c>>4]; out+=h[c&15]; } return out; }
int main(int argc,char **argv) { if(argc!=2)return 1; const char *dictionary=argv[1]; Context storage; Context *c=&storage;
''' + loader + '''
for(const auto &entry:*c->dictionary) for(const auto &value:entry.second)
 std::cout<<hex(entry.first)<<"\\t"<<hex(value)<<"\\n";
}
''')
    binary = temporary / "loader"
    subprocess.run(["c++", "-std=c++14", "-O2", "-include", "cstdint", "-I" + str(ROOT / "gizmo"),
        str(cpp), str(ROOT / "gizmo/text/dictionary.cpp"), str(ROOT / "gizmo/text/utf8.cpp"), "-o", str(binary)], check=True)
    native = sorted(subprocess.check_output([str(binary), str(dictionary)]).splitlines())
    reference = temporary / "reference.tsv"
    subprocess.run(["node", "tests/ios/dictionary-reference.js", str(dictionary), str(reference)], cwd=ROOT, check=True)
    browser = reference.read_bytes().splitlines()
    result = {"scope": "entire pinned EN/RO dictionary; production PWA vs native loader",
              "nativePairs": len(native), "browserPairs": len(browser), "equal": native == browser,
              "missingNativePairs": len(set(browser) - set(native)), "extraNativePairs": len(set(native) - set(browser)),
              "mappingSHA256": hashlib.sha256(b'\n'.join(native)).hexdigest()}
    (ROOT / "tests/generated/native-dictionary-parity.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    assert result["equal"], result
