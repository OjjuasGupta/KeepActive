# KeepActive optional native helper

This folder is included only in the **full build**. The Chrome Web Store build
does not contain it and does not declare `nativeMessaging`.

The helper gives Microsoft Teams Desktop a real local input event while the
operating system reports the user idle. It never clicks, never types text, and
refuses to act while the keyboard or mouse is active.

## Requirements

- Python 3.8 or newer.
- Windows, macOS, or Linux with an X11 display and `xdotool` (Wayland support
  depends on the compositor).
- macOS: Accessibility permission for the Python interpreter or terminal.

## Windows

```powershell
cd native
.\install.ps1 -ExtensionId <32-character-extension-id>
```

The installer writes a stable copy to
`%LOCALAPPDATA%\KeepActive\native`, compiles a small `keepactive_helper.exe`
launcher, writes the host manifest, and registers these registry keys:

- `HKCU\Software\Google\Chrome\NativeMessagingHosts\keepactive_helper`
- `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\keepactive_helper`

Use `-Browser Chrome` or `-Browser Edge` to register only one browser.
Use `-DryRun` to preview the changes and `-Uninstall` to remove them.

## macOS / Linux

```bash
cd native
chmod +x install.sh
./install.sh --extension-id <32-character-extension-id>
```

The installer copies `host.py` and a launcher into a per-user folder and writes
`keepactive_helper.json` into the browser's `NativeMessagingHosts` folder.
Use `--both` for Chrome and Edge, `--dry-run` to preview, and `--uninstall` to
remove everything.

## Stable extension ID

`allowed_origins` must contain the exact extension ID. Loading an unpacked
extension from a different folder changes the ID. If you move the folder or
reinstall, rerun the installer with the new ID. Find the ID at
`chrome://extensions`.

## Test

```powershell
py -3 native\host.py --selftest
py -3 tools\test-native.py
```

`--selftest` only reads the pointer position; it does not move the mouse.
`test-native.py` exercises the message protocol with `PING`, `CONFIG`, and
`STOP`.

## Protocol

Messages use Chrome native messaging framing: 4-byte little-endian length
followed by a UTF-8 JSON object.

| Direction | Message | Meaning |
|-----------|---------|---------|
| Extension -> host | `{"type":"PING"}` | Health check |
| Extension -> host | `{"type":"CONFIG","minSec":45,"maxSec":120,"pressShift":true,"minIdleSec":15}` | Update limits |
| Extension -> host | `{"type":"TRIGGER"}` | Perform one micro-activity if idle |
| Extension -> host | `{"type":"STOP"}` | Exit |
| Host -> extension | `READY`, `PONG`, `CONFIG_OK`, `RESULT`, `ERROR`, `STOPPED` | Responses |

The extension owns the randomized schedule. The helper does not self-schedule,
so there is no duplicate action stream.
