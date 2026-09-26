# Knoop project instructions

For changes to app code or release metadata, treat the signed Android ARM64 Release APK as the final build check. Run `.local-workflow/build-my-release.ps1` after code checks and verify its version, signing result, and output APK. A frontend build or `cargo check` alone does not complete release verification.

The local script and signing tools are private and Git-ignored. If they are unavailable, report that the Release build could not be verified.
