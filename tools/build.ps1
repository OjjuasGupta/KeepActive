#requires -Version 5.1
<#
.SYNOPSIS
    Builds and validates the KeepActive store and full packages.

.DESCRIPTION
    Produces two staging folders and two ZIPs under dist/:
      keepactive-store-<version>.zip  browser-only Chrome Web Store build
      keepactive-full-<version>.zip   browser build + optional native helper

    The store package deliberately excludes native/, tools/, source docs,
    manifest.full.json, icon generators, and non-PNG icon assets.

.EXAMPLE
    .\tools\build.ps1
#>

param(
    [string]$OutputRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
if (-not $OutputRoot) { $OutputRoot = Join-Path $Root 'dist' }

function Write-Step {
    param([string]$Message)
    Write-Host "[BUILD] $Message" -ForegroundColor Cyan
}

function Copy-Relative {
    param([string]$RelativePath, [string]$DestinationRoot)
    $source = Join-Path $Root $RelativePath
    if (-not (Test-Path $source)) { throw "Missing required file: $source" }
    $destination = Join-Path $DestinationRoot $RelativePath
    $parent = Split-Path $destination -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    Copy-Item -Path $source -Destination $destination -Force
}

function Copy-StoreFiles {
    param([string]$DestinationRoot)

    $files = @(
        'manifest.json',
        'background.js',
        'content\teams.js',
        'lib\random.js',
        'lib\logger.js',
        'lib\storage.js',
        'lib\rating.js',
        'popup\popup.html',
        'popup\popup.css',
        'popup\popup.js',
        'options\options.html',
        'options\options.css',
        'options\options.js',
        'welcome.html',
        'welcome.js',
        'privacy.html'
    )

    foreach ($file in $files) { Copy-Relative $file $DestinationRoot }

    $iconDestination = Join-Path $DestinationRoot 'icons'
    if (-not (Test-Path $iconDestination)) { New-Item -ItemType Directory -Path $iconDestination -Force | Out-Null }
    $icons = Get-ChildItem (Join-Path $Root 'icons') -Filter '*.png' -File
    if (-not $icons) { throw 'No PNG icons found.' }
    foreach ($icon in $icons) {
        Copy-Item -Path $icon.FullName -Destination (Join-Path $iconDestination $icon.Name) -Force
    }
}

function Assert-Manifest {
    param([string]$ManifestPath, [string]$Variant, [string]$ExpectedVersion)

    $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    if ($manifest.manifest_version -ne 3) { throw "$Variant manifest is not MV3." }
    if ($manifest.version -ne $ExpectedVersion) { throw "$Variant version $($manifest.version) does not match $ExpectedVersion." }

    $permissions = @($manifest.permissions)
    $hasNative = $permissions -contains 'nativeMessaging'
    if ($Variant -eq 'store' -and $hasNative) { throw 'Store manifest must not declare nativeMessaging.' }
    if ($Variant -eq 'full' -and -not $hasNative) { throw 'Full manifest must declare nativeMessaging.' }

    $base = Split-Path $ManifestPath -Parent
    $iconPaths = @()
    foreach ($property in $manifest.icons.PSObject.Properties) { $iconPaths += $property.Value }
    foreach ($property in $manifest.action.default_icon.PSObject.Properties) { $iconPaths += $property.Value }
    foreach ($iconPath in ($iconPaths | Select-Object -Unique)) {
        if (-not (Test-Path (Join-Path $base $iconPath))) { throw "Missing icon referenced by ${Variant} manifest: $iconPath" }
    }

    foreach ($script in $manifest.content_scripts) {
        foreach ($js in $script.js) {
            if (-not (Test-Path (Join-Path $base $js))) { throw "Missing content script: $js" }
        }
    }

    if (-not (Test-Path (Join-Path $base $manifest.background.service_worker))) {
        throw "Missing service worker: $($manifest.background.service_worker)"
    }
    foreach ($page in @('popup\popup.html', 'options\options.html', 'welcome.html', 'privacy.html')) {
        if (-not (Test-Path (Join-Path $base $page))) { throw "Missing page: $page" }
    }

    return $manifest
}

function Assert-NoRemoteAssets {
    param([string]$StageRoot, [string]$Variant)

    $textFiles = Get-ChildItem $StageRoot -Recurse -File | Where-Object {
        $_.Extension -in @('.js', '.html', '.css', '.json')
    }

    foreach ($file in $textFiles) {
        $text = Get-Content $file.FullName -Raw
        if ($text -match 'fonts\.googleapis|fonts\.gstatic|@import\s+url\(') {
            throw "Remote font/import found in $($file.FullName)"
        }

        foreach ($match in [regex]::Matches($text, 'https?://[^\s"''<>)]+')) {
            $url = $match.Value.TrimEnd('.', ',', ';', ')')
            $allowed = $url -like 'https://teams.microsoft.com/*' -or
                $url -like 'https://teams.cloud.microsoft/*' -or
                $url -like 'https://chromewebstore.google.com/detail/*' -or  # rating link opened in a tab, never fetched
                ($Variant -eq 'full' -and $url -like 'https://www.python.org/*')
            if (-not $allowed) {
                throw "Unexpected remote URL in $($file.FullName): $url"
            }
        }
    }
}

function Assert-PackageContents {
    param([string]$StageRoot, [string]$Variant, [string]$ZipPath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        if ($names -notcontains 'manifest.json') { throw "$Variant ZIP has no root manifest.json." }
        if ($names -contains 'manifest.full.json') { throw "$Variant ZIP includes manifest.full.json." }
        if ($names -contains 'tools/test-storage.js') { throw "$Variant ZIP includes tools/." }
        if ($Variant -eq 'store') {
            if ($names | Where-Object { $_ -like 'native/*' }) { throw 'Store ZIP includes native/.' }
            if ($names | Where-Object { $_ -like 'README*' }) { throw 'Store ZIP includes source documentation.' }
            if ($names | Where-Object { $_ -like '*.gif' -or $_ -like '*.svg' }) { throw 'Store ZIP includes non-PNG icon assets.' }
        } else {
            foreach ($required in @('native/host.py', 'native/install.ps1', 'native/install.sh')) {
                if ($names -notcontains $required) { throw "Full ZIP is missing $required." }
            }
        }
        Write-Step "$Variant ZIP contains $($names.Count) files."
    } finally {
        $archive.Dispose()
    }
}

function New-Package {
    param([string]$Variant, [string]$Version, [string]$StageRoot)

    $zipPath = Join-Path $OutputRoot "keepactive-$Variant-$Version.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # Compress-Archive on Windows PowerShell 5.1 writes backslash entry names.
    # Build the archive explicitly so every ZIP path uses the spec-required '/'.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $baseLength = $StageRoot.TrimEnd('\', '/').Length + 1
        foreach ($file in (Get-ChildItem $StageRoot -Recurse -File)) {
            $entryName = $file.FullName.Substring($baseLength).Replace('\', '/')
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
        }
    } finally {
        $archive.Dispose()
    }

    Assert-PackageContents -StageRoot $StageRoot -Variant $Variant -ZipPath $zipPath
    $hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
    $size = (Get-Item $zipPath).Length
    Write-Step "$Variant package: $zipPath ($([math]::Round($size / 1KB, 1)) KB)"
    Write-Step "$Variant SHA256: $hash"
}

$storeManifest = Get-Content (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json
$fullManifest = Get-Content (Join-Path $Root 'manifest.full.json') -Raw | ConvertFrom-Json
$version = $storeManifest.version
if ($fullManifest.version -ne $version) {
    throw "manifest.json version $version does not match manifest.full.json version $($fullManifest.version)."
}

$storeStage = Join-Path $OutputRoot "keepactive-store-$version"
$fullStage = Join-Path $OutputRoot "keepactive-full-$version"

Write-Step "Building KeepActive $version"
if (Test-Path $storeStage) { Remove-Item $storeStage -Recurse -Force }
if (Test-Path $fullStage) { Remove-Item $fullStage -Recurse -Force }
New-Item -ItemType Directory -Path $storeStage -Force | Out-Null

Copy-StoreFiles -DestinationRoot $storeStage
$null = Assert-Manifest -ManifestPath (Join-Path $storeStage 'manifest.json') -Variant store -ExpectedVersion $version
Assert-NoRemoteAssets -StageRoot $storeStage -Variant store

New-Item -ItemType Directory -Path $fullStage -Force | Out-Null
Copy-Item -Path (Join-Path $storeStage '*') -Destination $fullStage -Recurse -Force
Copy-Relative 'manifest.full.json' $fullStage
Move-Item -Path (Join-Path $fullStage 'manifest.full.json') -Destination (Join-Path $fullStage 'manifest.json') -Force
Copy-Relative 'README.md' $fullStage
Copy-Relative 'native\host.py' $fullStage
Copy-Relative 'native\host.json.template' $fullStage
Copy-Relative 'native\install.ps1' $fullStage
Copy-Relative 'native\install.sh' $fullStage
Copy-Relative 'native\README.md' $fullStage

$null = Assert-Manifest -ManifestPath (Join-Path $fullStage 'manifest.json') -Variant full -ExpectedVersion $version
Assert-NoRemoteAssets -StageRoot $fullStage -Variant full

New-Package -Variant 'store' -Version $version -StageRoot $storeStage
New-Package -Variant 'full' -Version $version -StageRoot $fullStage

# GitHub Pages serves docs/; keep the public policy identical to the packaged one.
$docsRoot = Join-Path $Root 'docs'
if (-not (Test-Path $docsRoot)) { New-Item -ItemType Directory -Path $docsRoot -Force | Out-Null }
Copy-Item (Join-Path $Root 'privacy.html') (Join-Path $docsRoot 'privacy.html') -Force
Write-Step 'Synced docs/privacy.html for GitHub Pages.'

Write-Step 'Validating JavaScript syntax with node --check...'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $jsFiles = Get-ChildItem $storeStage -Recurse -File -Filter '*.js'
    foreach ($file in $jsFiles) {
        & $node.Source --check $file.FullName
        if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($file.FullName)" }
    }
    Write-Step "Checked $($jsFiles.Count) JavaScript files."
} else {
    Write-Host '[BUILD] node not found; skipped JavaScript syntax validation.' -ForegroundColor Yellow
}

Write-Step 'Build complete.'
Write-Step "Store staging: $storeStage"
Write-Step "Full staging:  $fullStage"
