# Knoop project instructions

For changes to app code or release metadata, treat the signed Android ARM64 Release APK as the final build check. Run `.local-workflow/build-my-release.ps1` after code checks and verify its version, signing result, and output APK. A frontend build or `cargo check` alone does not complete release verification.

The local script and signing tools are private and Git-ignored. If they are unavailable, report that the Release build could not be verified.

## Documentation audience

README.md is public-facing: describe the product, features, supported platforms, roadmap, and general build instructions for all readers. Keep session progress, remediation reports, acceptance evidence, and device-operation procedures in development documentation under `docs/`, not in README.md.

## E-ink focus and visual device checks

Knoop currently prioritizes Android e-ink devices, with the HANVON Clear6 Plus (PA6 / PA6GB32) as the primary development and acceptance device. General Android phone/tablet adaptation is deferred to 2027; follow the roadmap in README.md.

For UI changes, read `docs/pa6-visual-workflow.md` and prefer direct PA6 screenshots and interaction when the authorized ADB device is connected. Inspect the screenshot, make the change, run the required checks and signed Release build, update the device with `adb install -r`, and inspect fresh screenshots of the changed flow. Record tested scenarios and remaining gaps. Use the observed current UI for input coordinates; stored coordinates are examples, not durable selectors. Preserve device learning data during testing.

ADB screenshots verify layout and displayed content. Physical e-ink ghosting, flashing, and refresh speed require observation of the actual display; do not claim these were verified from screenshots. When the device is disconnected or unauthorized, state the limitation and distinguish other checks from real-device acceptance.

## E-ink task acceptance gate

Follow `docs/eink-task-tracker.md` for the user-requested task sequence. Implement, check, build a signed Release, install it over the existing PA6 app, and provide a manual checklist for one task at a time. Stop and wait for the user's explicit pass before beginning the next task. Fix failures within the current task; automated checks and screenshots do not substitute for the user's acceptance.
