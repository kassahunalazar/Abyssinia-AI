# Building the downloads

The Build downloadable apps workflow produces the Windows x64 installer and the signed Android APK. The Android emulator test installs the signed APK and sends a message through the UI to a deterministic local provider.

## Windows

Use a Windows x64 checkout with Git and official Node.js 24.15.0 x64. Commit the source revision to package, then run:

    powershell -File scripts/build-windows.ps1
    powershell -File scripts/build-installer.ps1

The outputs are in .runtime. The EXE embeds the entire runtime ZIP and extracts into a new folder under the current user's LocalAppData. For a noninteractive extraction check run the EXE with --extract and a destination directory. The executable has no Authenticode publisher signature.

## Android

Use Linux with a JDK, Python 3, Android SDK Platform 35 and Build Tools 35.0.0. Set ANDROID_HOME, ANDROID_KEYSTORE and ANDROID_STORE_PASS. The keystore alias is abyssinia. Run:

    python scripts/build-android.py

The resulting .runtime/Abyssinia-AI.apk supports Android 8.0 and newer. To run the emulator check, install the APK on a booted test emulator with adb, then run python android/smoke.py. The test uses adb reverse to connect to a deterministic model fixture.

Release signing material is kept outside Git. Maintainers must preserve the Android release key to publish installable updates. Forks should create their own key and use their own application ID.
