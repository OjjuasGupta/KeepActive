<#
.SYNOPSIS
    Installs the optional KeepActive native messaging helper on Windows.

.DESCRIPTION
    Copies host.py into a stable per-user directory, creates a small launcher,
    writes the Chrome native-messaging host manifest, and registers it under
    HKCU for Chrome and/or Edge.

    The helper is only used by the full build (the build that declares the
    nativeMessaging permission). The Chrome Web Store build does not need it.

.PARAMETER SourcePath
    Folder containing host.py. Defaults to this script's folder.

.PARAMETER Browser
    Chrome, Edge, or Both. Default: Both.

.PARAMETER ExtensionId
    The 32-character Chrome extension ID. Find it at chrome://extensions.
    If omitted, the script tries ..\tools\extension-id.txt, then prompts.

.PARAMETER InstallDir
    Stable install directory. Default: %LOCALAPPDATA%\KeepActive\native.

.PARAMETER DryRun
    Validate and print actions without copying files or writing the registry.

.PARAMETER Uninstall
    Remove the registry entries and the install directory.

.EXAMPLE
    .\install.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmn

.EXAMPLE
    .\install.ps1 -Browser Chrome -ExtensionId abcdefghijklmnopabcdefghijklmn -DryRun

.EXAMPLE
    .\install.ps1 -Uninstall
#>

param(
    [string]$SourcePath = $PSScriptRoot,
    [ValidateSet('Chrome', 'Edge', 'Both')]
    [string]$Browser = 'Both',
    [string]$ExtensionId = '',
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'KeepActive\native'),
    [switch]$DryRun,
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $colors = @{ INFO = 'Cyan'; WARN = 'Yellow'; ERROR = 'Red'; SUCCESS = 'Green' }
    Write-Host "[$Level] $Message" -ForegroundColor $colors[$Level]
}

function Get-BrowserKeys {
    param([string]$BrowserName)
    $keys = @()
    if ($BrowserName -eq 'Chrome' -or $BrowserName -eq 'Both') {
        $keys += 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\keepactive_helper'
    }
    if ($BrowserName -eq 'Edge' -or $BrowserName -eq 'Both') {
        $keys += 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\keepactive_helper'
    }
    return $keys
}

function Get-ExtensionId {
    param([string]$ProvidedId, [string]$Source)

    if ($ProvidedId) {
        if ($ProvidedId -match '^[a-p]{32}$') { return $ProvidedId }
        throw "Extension ID '$ProvidedId' is invalid. It must be 32 characters in the range a-p."
    }

    $idFile = Join-Path (Split-Path $Source -Parent) 'tools\extension-id.txt'
    if (Test-Path $idFile) {
        $line = Get-Content $idFile -Raw
        if ($line -match '([a-p]{32})') {
            Write-Log "Using extension ID from $idFile"
            return $Matches[1]
        }
    }

    Write-Log 'Find the ID on chrome://extensions (Developer mode) and paste it below.' -Level WARN
    $entered = Read-Host 'Extension ID (32 lowercase letters a-p)'
    if ($entered -match '^[a-p]{32}$') { return $entered }
    throw 'Invalid extension ID format.'
}

function Find-Python {
    $py = Get-Command 'py.exe' -ErrorAction SilentlyContinue
    if ($py) {
        try {
            $exe = & $py.Source -3 -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) {
                return [pscustomobject]@{
                    Exe = $py.Source
                    Prefix = @('-3')
                    RealPython = ($exe | Select-Object -Last 1).ToString().Trim()
                }
            }
        } catch { }
    }

    foreach ($name in @('python.exe', 'python3.exe')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        try {
            $exe = & $command.Source -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) {
                return [pscustomobject]@{
                    Exe = $command.Source
                    Prefix = @()
                    RealPython = ($exe | Select-Object -Last 1).ToString().Trim()
                }
            }
        } catch { }
    }

    throw 'Python 3 was not found. Install it from https://www.python.org/downloads/ and enable the py launcher.'
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

$browserKeys = Get-BrowserKeys $Browser

if ($Uninstall) {
    Write-Log '=== KeepActive Native Helper Uninstall (Windows) ==='
    foreach ($key in $browserKeys) {
        if (Test-Path $key) {
            if ($DryRun) {
                Write-Log "Would remove registry key: $key"
            } else {
                Remove-Item -Path $key -Recurse -Force
                Write-Log "Removed registry key: $key" -Level SUCCESS
            }
        }
    }
    if (Test-Path $InstallDir) {
        if ($DryRun) {
            Write-Log "Would remove install directory: $InstallDir"
        } else {
            Remove-Item -Path $InstallDir -Recurse -Force
            Write-Log "Removed install directory: $InstallDir" -Level SUCCESS
        }
    }
    Write-Log 'Uninstall complete.'
    exit 0
}

Write-Log '=== KeepActive Native Helper Installer (Windows) ==='

if (-not (Test-Path $SourcePath)) { throw "Source path not found: $SourcePath" }
$sourceHost = Join-Path $SourcePath 'host.py'
if (-not (Test-Path $sourceHost)) { throw "host.py not found: $sourceHost" }

$extension = Get-ExtensionId -ProvidedId $ExtensionId -Source $SourcePath
Write-Log "Extension ID: $extension"

$python = Find-Python
Write-Log "Python launcher: $($python.Exe) $($python.Prefix -join ' ')"
Write-Log "Python executable: $($python.RealPython)"

$hostTarget = Join-Path $InstallDir 'host.py'
$launcherTarget = Join-Path $InstallDir 'keepactive_helper.exe'
$launcherBuild = Join-Path $InstallDir 'keepactive_helper.build.exe'
$manifestTarget = Join-Path $InstallDir 'keepactive_helper.json'

if ($DryRun) {
    Write-Log "Would copy $sourceHost -> $hostTarget"
    Write-Log "Would compile launcher: $launcherTarget"
    Write-Log "Would create manifest: $manifestTarget"
    foreach ($key in $browserKeys) { Write-Log "Would register: $key" }
    Write-Log 'Dry run complete. No changes made.' -Level SUCCESS
    exit 0
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path $sourceHost -Destination $hostTarget -Force

# Chrome launches the native host directly with CreateProcess. A .cmd script is
# not a valid executable target, so compile a tiny .NET wrapper that starts the
# real Python interpreter and inherits Chrome's stdin/stdout pipes for the
# lifetime of the host process.
$csharpString = {
    param([string]$Value)
    '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}
$pythonLiteral = & $csharpString $python.RealPython
$hostLiteral = & $csharpString ('"' + $hostTarget + '"')
$installLiteral = & $csharpString $InstallDir

$launcherSource = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class KeepActiveLauncher
{
    private static int Main()
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = $pythonLiteral,
            Arguments = $hostLiteral,
            WorkingDirectory = $installLiteral,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        using (var process = new Process { StartInfo = startInfo })
        {
            process.Start();

            var stdin = Console.OpenStandardInput();
            var stdout = Console.OpenStandardOutput();
            var stderr = Console.OpenStandardError();

            // Chrome speaks native-messaging framing over the launcher's
            // stdin/stdout. Pump those byte streams straight through to the
            // Python helper and close the child when Chrome closes the port.
            var inputPump = Task.Run(() =>
            {
                try
                {
                    var buffer = new byte[8192];
                    var childStdin = process.StandardInput.BaseStream;
                    int read;
                    while ((read = stdin.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        childStdin.Write(buffer, 0, read);
                        childStdin.Flush();
                    }
                }
                catch { }
                finally { try { process.StandardInput.Close(); } catch { } }
            });
            var outputPump = Task.Run(() =>
            {
                try
                {
                    var buffer = new byte[8192];
                    int read;
                    while ((read = process.StandardOutput.BaseStream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        stdout.Write(buffer, 0, read);
                        stdout.Flush();
                    }
                }
                catch { }
            });
            var errorPump = Task.Run(() =>
            {
                try
                {
                    var buffer = new byte[8192];
                    int read;
                    while ((read = process.StandardError.BaseStream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        stderr.Write(buffer, 0, read);
                        stderr.Flush();
                    }
                }
                catch { }
            });

            process.WaitForExit();
            Task.WaitAll(new[] { outputPump, errorPump }, 2000);
            return process.ExitCode;
        }
    }
}
"@

if (Test-Path $launcherBuild) { Remove-Item $launcherBuild -Force }
Write-Utf8NoBom -Path (Join-Path $InstallDir 'launcher.generated.cs') -Text $launcherSource
try {
    Add-Type -TypeDefinition $launcherSource -OutputAssembly $launcherBuild -OutputType ConsoleApplication -ReferencedAssemblies 'System.dll', 'System.Core.dll'
} catch {
    throw "Could not compile the native launcher. .NET Framework 4.x is required. $_"
}
if (-not (Test-Path $launcherBuild)) {
    throw "Native launcher was not created: $launcherBuild"
}

# Verify the copied helper can see the OS input backend before registering it.
# The helper reports its self-test on stderr; PowerShell 5.1 would otherwise
# promote that informational line to a terminating error.
$argsList = @()
$argsList += $python.Prefix
$argsList += $hostTarget
$argsList += '--selftest'
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $python.Exe @argsList 2>&1 | ForEach-Object { Write-Log $_.ToString() 'INFO' }
$selftestStatus = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
if ($selftestStatus -ne 0) {
    Write-Log 'The helper self-test failed. Registration will continue, but check the error above.' -Level WARN
}

# Verify the compiled launcher itself speaks native messaging framing.
$framingTest = @'
import json, struct, subprocess, sys

launcher = sys.argv[1]
process = subprocess.Popen([launcher], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def receive():
    header = process.stdout.read(4)
    if len(header) != 4:
        raise RuntimeError("no response from the compiled launcher")
    length = struct.unpack("=I", header)[0]
    return json.loads(process.stdout.read(length).decode("utf-8"))

ready = receive()
payload = json.dumps({"type": "STOP"}).encode("utf-8")
process.stdin.write(struct.pack("=I", len(payload)) + payload)
process.stdin.flush()
stopped = receive()
process.wait(timeout=5)
print(f"launcher handshake: {ready.get('type')} -> {stopped.get('type')} exit={process.returncode}")
if ready.get("type") != "READY" or stopped.get("type") != "STOPPED" or process.returncode != 0:
    raise SystemExit(1)
'@
$framingTestPath = Join-Path $env:TEMP ('keepactive-framing-' + [guid]::NewGuid().ToString('N') + '.py')
Write-Utf8NoBom -Path $framingTestPath -Text $framingTest
$framingArgs = @()
$framingArgs += $python.Prefix
$framingArgs += $framingTestPath
$framingArgs += $launcherBuild
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $python.Exe @framingArgs
$framingStatus = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
Remove-Item $framingTestPath -Force -ErrorAction SilentlyContinue
if ($framingStatus -ne 0) {
    Remove-Item $launcherBuild -Force -ErrorAction SilentlyContinue
    throw 'The compiled native launcher did not complete the native messaging handshake.'
}

if (Test-Path $launcherTarget) { Remove-Item $launcherTarget -Force }
Move-Item -Path $launcherBuild -Destination $launcherTarget -Force
Write-Log "Compiled launcher: $launcherTarget" -Level SUCCESS
Write-Log 'Launcher handshake verified (READY -> STOPPED).' -Level SUCCESS

$manifest = [ordered]@{
    name = 'keepactive_helper'
    description = 'KeepActive native helper (optional local OS input for the full build)'
    path = $launcherTarget
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extension/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
Write-Utf8NoBom -Path $manifestTarget -Text $manifestJson
Write-Log "Manifest written: $manifestTarget" -Level SUCCESS

foreach ($key in $browserKeys) {
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    Set-Item -Path $key -Value $manifestTarget
    Write-Log "Registered: $key" -Level SUCCESS
}

Write-Log ''
Write-Log '=== Installation Complete ===' -Level SUCCESS
Write-Log 'Next steps:'
Write-Log '  1. Reload KeepActive on chrome://extensions (full build only).'
Write-Log '  2. Open the popup or Control Deck and enable the Native Desktop Helper.'
Write-Log "  3. Keep the extension ID stable: $extension"
Write-Log ''
Write-Log 'Uninstall with: .\install.ps1 -Uninstall'
