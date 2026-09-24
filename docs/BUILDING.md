# Building Knoop

## Requirements

- Node.js and npm compatible with the lockfile
- Rust toolchain with the `aarch64-linux-android` target
- `cargo-ndk` (the Alpha build was verified with 4.1.2)
- JDK 17
- Android SDK with platform 36, Build Tools 35.0.0 or newer, and NDK 27.3.13750724
- PowerShell 7 for the provided Android build script

Install the Rust target and cargo-ndk if needed:

```powershell
rustup target add aarch64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
```

Set `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to your installations. The Android build script also accepts `-JavaHome`, `-AndroidSdk`, and `-AndroidNdk` arguments. It uses standard environment variables, then optionally detects a local `.tools` installation. You do not need that directory.

## Frontend

From the repository root:

```powershell
npm ci
npm run build
npm run check:repo
```

`npm run build` runs the TypeScript check and creates `dist/`.

## Android ARM64 Release

```powershell
pwsh ./scripts/build-android-release.ps1
```

The script builds the frontend and Rust library, runs Gradle `assembleArm64Release` without rebuilding Rust, aligns the APK, and checks the native library and strip result. The default output is an **unsigned aligned APK** under `artifacts/`. Android will require you to sign it before installation.

To sign with your own keystore, set a password environment variable and pass the keystore and alias:

```powershell
$env:KNOOP_KEYSTORE_PASSWORD = '<your password>'
pwsh ./scripts/build-android-release.ps1 -Keystore '<path-to-keystore>' -KeyAlias 'your-alias'
Remove-Item Env:KNOOP_KEYSTORE_PASSWORD
```

The script verifies signed APKs with `apksigner`. It reports the APK path and size, frontend size, native library size, DEX size, strip check, and signing status. Build output remains under ignored directories.
