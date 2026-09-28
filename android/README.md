# SubSync2 Android / NVIDIA Shield client

This directory contains the first-party Android shell for SubSync2.

## Architecture

The Android app does not fork the synchronization algorithm or Audio Extractor.
It loads the same deployed SubSync2 PWA runtime used by the browser:

https://zuzuitu.github.io/subsync-web-enhanced/

Normal SubSync2 web/runtime changes therefore reach the Android client with the
same canonical Pages deployment. An APK rebuild is required only when the native
Android shell itself changes.

Media stays on the Android device. The native shell only provides Android
navigation and an unrestricted Storage Access Framework picker. It does not add
an upload backend.

## NVIDIA Shield

The manifest exposes both the normal launcher and LEANBACK_LAUNCHER, and does
not require a touchscreen. The app keeps the screen awake while SubSync2 is open
so long synchronization jobs are not interrupted by TV sleep.

The native picker uses ACTION_OPEN_DOCUMENT + */* deliberately. Container
support remains validated by SubSync2/Mediabunny after selection; the Android
picker must not grey out MKV because of an extension/MIME filter.

## Runtime pinning for tests

The default runtime can be overridden at build time:

gradle :app:assembleDebug -PSUBSYNC2_URL=https://zuzuitu.github.io/subsync-web-enhanced/build-<sha>.html

This is for exact-runtime physical tests. It is not a synchronization hint.

## Development signing

media.alexlab.subsync2.dev is a test/sideload package only. The repository
contains a public development signing key solely so successive CI APKs can update
the same test installation on Shield/Android.

That key must never sign a Play Store or production package. A future production
package must use a different application ID/signing configuration with a private
key stored outside the repository.

## Physical test boundary

A successful Gradle build is not physical Android evidence. Before claiming a
Shield/Android pass, test the generated APK on the actual device and record:

1. app launches from the Shield launcher;
2. exact SubSync2 runtime/build marker;
3. MKV opens through the native picker;
4. selected MKV reaches SubSync2 as a File/Blob;
5. synchronization and/or Audio Extractor stage reached;
6. Save/export behavior;
7. any WebView/codec/storage failure with its exact stage.

An Android PASS does not substitute for the separate physical iPhone/WebKit gate.
