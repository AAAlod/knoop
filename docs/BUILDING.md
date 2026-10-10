# Building Knoop

## Requirements

- Node.js 24 and npm compatible with the lockfile (SQLite integration tests use `node:sqlite`)
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

Signing uses `--ks-pass env:KNOOP_KEYSTORE_PASSWORD` (or the explicitly named password environment variable), without writing a temporary password file. Keep the variable confined to the build process and clear it afterward; never put passwords in Git or logs. Existing keystore and alias remain under the owner's control. `npm run test:signing` runs normal/failure/interruption probes with a synthetic password and mock signer on PowerShell 7.

## Checks

GitHub Actions installs dependencies with `npm ci`, installs the locked Playwright Chromium and Linux system libraries, and runs `npm run check:ci`, without Android signing secrets or APK publishing. The same entry runs locally. `npm run test:ci-guards` temporarily injects a TypeScript error and test assertion failure, verifies nonzero exits, and restores the affected files; run it alone, then run `check:ci` to verify the restored state. Hosted CI runs require a pushed commit and are separate from local verification.

Browser suites A/B/C accept `-- --ui`; D/E always run the browser. Supply an installed Playwright module via `PLAYWRIGHT_MODULE_PATH` and Chrome via `CHROME_PATH`, or use a normal Playwright installation. Rust tests are run locally with `cargo test --offline`; the basic Ubuntu workflow intentionally avoids platform GUI dependencies and does not claim Rust/Android coverage.

UI checks are included in `check:ci`. On a clean local checkout run `npm run setup:ui` after `npm ci`; see [UI testing](ui-testing.md) for browser setup, individual suites and evidence paths.
