param(
  [string]$JavaHome,
  [string]$AndroidSdk,
  [string]$AndroidNdk,
  [string]$Keystore,
  [string]$KeyAlias,
  [string]$KeystorePasswordEnv = 'KNOOP_KEYSTORE_PASSWORD',
  [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tools = Join-Path $repo '.tools'

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
  Write-Host "> $Program $($Arguments -join ' ')"
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
function Find-Tool([string]$Name, [string[]]$Candidates) {
  foreach ($candidate in $Candidates) { if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return (Resolve-Path -LiteralPath $candidate).Path } }
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "Required tool $Name was not found. See docs/BUILDING.md."
}
function Size-Mb([long]$Bytes) { return [math]::Round($Bytes / 1MB, 2) }

if (-not $JavaHome) { $JavaHome = $env:JAVA_HOME }
if (-not $JavaHome) {
  $localJava = Get-ChildItem (Join-Path $tools 'jdk17') -Recurse -Filter java.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($localJava) { $JavaHome = Split-Path (Split-Path $localJava.FullName -Parent) -Parent }
}
if (-not $JavaHome) {
  $javaPath = (Get-Command java -ErrorAction SilentlyContinue).Source
  if ($javaPath) { $JavaHome = Split-Path (Split-Path $javaPath -Parent) -Parent }
}
if (-not $JavaHome -or -not (Test-Path (Join-Path $JavaHome 'bin/java.exe'))) { throw 'JDK 17 not found. Set JAVA_HOME or pass -JavaHome.' }
$env:JAVA_HOME = (Resolve-Path $JavaHome).Path
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path

if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_HOME }
if (-not $AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
if (-not $AndroidSdk -and (Test-Path (Join-Path $tools 'android-sdk'))) { $AndroidSdk = Join-Path $tools 'android-sdk' }
if (-not $AndroidSdk -or -not (Test-Path $AndroidSdk)) { throw 'Android SDK not found. Set ANDROID_HOME or pass -AndroidSdk.' }
$env:ANDROID_HOME = (Resolve-Path $AndroidSdk).Path
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

if (-not $AndroidNdk) { $AndroidNdk = $env:ANDROID_NDK_HOME }
if (-not $AndroidNdk) { $AndroidNdk = $env:NDK_HOME }
if (-not $AndroidNdk) {
  $ndkRoot = Join-Path $env:ANDROID_HOME 'ndk'
  $ndkDir = Get-ChildItem $ndkRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if ($ndkDir) { $AndroidNdk = $ndkDir.FullName }
}
if (-not $AndroidNdk -or -not (Test-Path $AndroidNdk)) { throw 'Android NDK not found. Install it in the SDK or pass -AndroidNdk.' }
$env:ANDROID_NDK_HOME = (Resolve-Path $AndroidNdk).Path
$env:NDK_HOME = $env:ANDROID_NDK_HOME

$buildTools = Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if (-not $buildTools) { throw 'Android SDK Build Tools not found.' }
$zipalign = Find-Tool 'zipalign' @((Join-Path $buildTools.FullName 'zipalign.exe'))
$apksigner = Find-Tool 'apksigner' @((Join-Path $buildTools.FullName 'apksigner.bat'))
$readelfPath = Join-Path $env:ANDROID_NDK_HOME 'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe'
$npm = Find-Tool 'npm.cmd' @()
$cargo = Find-Tool 'cargo.exe' @()

if ($Clean) {
  foreach ($rel in @('dist','src-tauri/target','src-tauri/gen/android/.gradle','src-tauri/gen/android/build','src-tauri/gen/android/buildSrc/build','src-tauri/gen/android/app/build')) {
    $path = [IO.Path]::GetFullPath((Join-Path $repo $rel))
    if (-not $path.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe clean path: $path" }
    if (Test-Path -LiteralPath $path) {
      if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to clean a reparse point: $path" }
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}
Set-Location $repo
if (-not (Test-Path 'node_modules')) { Invoke-Checked $npm @('ci') }
Invoke-Checked $npm @('run','build')
$frontendBytes = (Get-ChildItem 'dist' -Recurse -File | Measure-Object Length -Sum).Sum

$jni = Join-Path $repo 'src-tauri/gen/android/app/src/main/jniLibs'
New-Item -ItemType Directory -Force $jni | Out-Null
Get-ChildItem $jni -Recurse -Filter '*.so' -File -ErrorAction SilentlyContinue | Remove-Item -Force
Push-Location (Join-Path $repo 'src-tauri')
try { Invoke-Checked $cargo @('ndk','-t','arm64-v8a','-o','gen/android/app/src/main/jniLibs','build','--release','--lib','--features','tauri/custom-protocol') }
finally { Pop-Location }
$native = Join-Path $jni 'arm64-v8a/libknoop_lib.so'
$allNative = @(Get-ChildItem $jni -Recurse -Filter '*.so' -File)
if (-not (Test-Path $native) -or $allNative.Count -ne 1) { throw "Unexpected JNI libraries: $($allNative.Name -join ', ')" }
$strip = 'unavailable'
if (Test-Path $readelfPath) {
  $sections = & $readelfPath -S $native
  if ($LASTEXITCODE -ne 0) { throw 'llvm-readelf failed' }
  if (($sections -join "`n") -match '\.symtab') { throw 'Rust release library still contains .symtab' }
  $strip = 'ok (.symtab absent)'
}

$android = Join-Path $repo 'src-tauri/gen/android'
Push-Location $android
try { Invoke-Checked '.\gradlew.bat' @(':app:assembleArm64Release','-x','rustBuildArm64Release','-x','rustBuildUniversalRelease','--no-daemon') }
finally { Pop-Location }
$apkRoot = Join-Path $android 'app/build/outputs/apk'
$unsigned = Get-ChildItem $apkRoot -Recurse -Filter '*unsigned*.apk' -File | Where-Object FullName -Match 'release' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $unsigned) { throw 'Unsigned Release APK not found.' }
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$artifacts = Join-Path $repo 'artifacts'
New-Item -ItemType Directory -Force $artifacts | Out-Null
$aligned = Join-Path $artifacts "knoop-v$version-arm64-release-unsigned-aligned.apk"
Invoke-Checked $zipalign @('-p','-f','4',$unsigned.FullName,$aligned)
Invoke-Checked $zipalign @('-c','4',$aligned)

$final = $aligned
$signed = 'no'
if ($Keystore) {
  if (-not (Test-Path $Keystore)) { throw 'Specified keystore not found.' }
  if (-not $KeyAlias) { throw 'Pass -KeyAlias with -Keystore.' }
  $password = [Environment]::GetEnvironmentVariable($KeystorePasswordEnv)
  if (-not $password) { throw "Set $KeystorePasswordEnv before signing." }
  $passwordFile = Join-Path $artifacts '.signing-password.tmp'
  try {
    [IO.File]::WriteAllText($passwordFile, $password, [Text.UTF8Encoding]::new($false))
    $final = Join-Path $artifacts "knoop-v$version-arm64-release.apk"
    Invoke-Checked $apksigner @('sign','--ks',$Keystore,'--ks-key-alias',$KeyAlias,'--ks-pass',"file:$passwordFile",'--out',$final,$aligned)
    Invoke-Checked $apksigner @('verify','--verbose',$final)
    $signed = 'yes (verified)'
  } finally { if (Test-Path $passwordFile) { Remove-Item -LiteralPath $passwordFile -Force } }
}

$apk = [IO.Compression.ZipFile]::OpenRead($final)
try {
  $libs = @($apk.Entries | Where-Object { $_.FullName -match '^lib/.*\.so$' })
  if ($libs.Count -ne 1 -or $libs[0].FullName -ne 'lib/arm64-v8a/libknoop_lib.so') { throw "Native library pollution in APK: $($libs.FullName -join ', ')" }
  $nativeBytes = ($libs | Measure-Object Length -Sum).Sum
  $dexBytes = ($apk.Entries | Where-Object { $_.FullName -match '^classes.*\.dex$' } | Measure-Object Length -Sum).Sum
} finally { $apk.Dispose() }
Write-Host "Version       : $version"
Write-Host "APK           : $final"
Write-Host "APK size      : $(Size-Mb (Get-Item $final).Length) MB"
Write-Host "Frontend dist : $(Size-Mb $frontendBytes) MB"
Write-Host "Native .so    : $(Size-Mb $nativeBytes) MB (APK uncompressed)"
Write-Host "DEX           : $(Size-Mb $dexBytes) MB (APK uncompressed)"
Write-Host "Strip check   : $strip"
Write-Host "Signing       : $signed"
