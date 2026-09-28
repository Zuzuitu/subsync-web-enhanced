import base64
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

manifest = (ROOT / "android/app/src/main/AndroidManifest.xml").read_text()
activity = (ROOT / "android/app/src/main/java/media/alexlab/subsync2/MainActivity.java").read_text()
gradle = (ROOT / "android/app/build.gradle").read_text()
readme = (ROOT / "android/README.md").read_text()
key_b64 = (ROOT / "android/signing/subsync2-dev.keystore.b64").read_text().strip()

assert "android.permission.INTERNET" in manifest
assert "android.permission.READ_EXTERNAL_STORAGE" not in manifest
assert "android.permission.WRITE_EXTERNAL_STORAGE" not in manifest
assert "android.intent.category.LEANBACK_LAUNCHER" in manifest
assert "android.hardware.touchscreen" in manifest
assert 'android:required="false"' in manifest
assert 'android:usesCleartextTraffic="false"' in manifest

assert "Intent.ACTION_OPEN_DOCUMENT" in activity
assert 'intent.setType("*/*")' in activity
assert "FLAG_GRANT_PERSISTABLE_URI_PERMISSION" in activity
assert "setAllowFileAccess(false)" in activity
assert "setAllowContentAccess(true)" in activity
assert "MIXED_CONTENT_NEVER_ALLOW" in activity
assert "BuildConfig.SUBSYNC2_URL" in activity
assert "https://zuzuitu.github.io/subsync-web-enhanced/" in gradle
assert "media.alexlab.subsync2.dev" in gradle
assert "test/sideload package only" in readme

decoded = base64.b64decode(key_b64, validate=True)
assert hashlib.sha256(decoded).hexdigest() == "243221de8f1d0b1777855843e442ddde74b4b9ad3bab70f8777b6051916c7c5f"

print("Android shell invariants: PASS")
