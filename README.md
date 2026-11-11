# KeepActive

A local-only Manifest V3 Chrome extension that keeps your display awake and
sends small periodic activity events to Microsoft Teams on the web.

KeepActive ships in two variants:

| Variant | Purpose | Native helper |
|---------|---------|---------------|
| **Store build** (`dist/keepactive-store-1.1.1.zip`) | Chrome Web Store / normal browser use | Not included, not declared |
| **Full build** (`dist/keepactive-full-1.1.1.zip`) | Local/developer install with Teams Desktop support | Optional Python helper included |

> **Responsible use**
> - KeepActive is intended for legitimate passive work: presentations,
>   monitoring dashboards, data rendering, downloads, and long-running jobs.
> - It does not bypass Intune, Group Policy, MDM, EDR, or any other corporate
>   control. Device policy can still lock the screen.
> - It does not guarantee a Teams presence state. Microsoft controls presence.
> - Check your organization's acceptable-use policy and Microsoft's terms.

## What works

- **Display keep-awake** via `chrome.power.requestKeepAwake("display")` while
  Chrome is running and KeepActive is effectively ON.
- **Teams Web activity** in top-level Teams tabs every 60–150 s (randomized):
  pointer movement on the element under a random point, occasional harmless
  Shift key pulses, `focus`/`visibilitychange` pings, and an occasional click
  on the empty page background (`<body>` itself, so no button, link, input or
  send/delete control can receive it; skipped while a text field is focused).
  The background click can be turned off in the Control Deck. Each cycle is
  written to the Diagnostic Console with a timestamp so you can check whether
  Teams reacts to these `isTrusted=false` events.
- **Allowed sites**: enable or disable activity per Teams origin
  (`teams.microsoft.com`, `teams.cloud.microsoft`).
- **Work schedule** with normal, overnight, and multi-day gaps. The next
  transition is stored in `chrome.alarms`, so it survives service-worker
  restarts.
- **Smart Pause**: uses the OS idle signal plus real (`isTrusted`) key, mouse
  button, wheel and touch input inside Teams tabs. Pauses while you are active,
  resumes only after your configured away period, and treats a locked screen
  as away.
- **Accurate session clock**: only effective ON time accumulates. Paused and
  off-schedule time is excluded.
- **Manual pause/resume** and an `Alt+Shift+S` master hotkey.
- **Session safety limit** and a local diagnostic ring buffer.
- **No telemetry, no analytics, no remote fonts, no third-party requests.**

## Install (store build)

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/keepactive-keep-screen-aw/akcdhlnelghhjpcmnabolcdggbebnlka). To load it unpacked instead:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the store package folder, or install the
   reviewed listing from the Chrome Web Store.
4. The welcome guide opens on first install.

## Install (full build)

1. Build or unpack `dist/keepactive-full-1.1.1.zip` into a permanent folder.
2. Load that folder unpacked at `chrome://extensions`.
3. Copy the extension ID shown on the card.
4. Install the native helper:

   **Windows**
   ```powershell
   cd native
   .\install.ps1 -ExtensionId <32-character-extension-id>
   ```

   **macOS / Linux**
   ```bash
   cd native
   ./install.sh --extension-id <32-character-extension-id>
   ```

5. Reload KeepActive on `chrome://extensions`.
6. Open the popup or Control Deck and enable **Native Desktop Helper**.

The helper requires Python 3.8+. On macOS it also needs Accessibility
permission. If the extension ID changes, rerun the installer so
`allowed_origins` matches.

## Control Deck

- **Teams Web intervals**: minimum and maximum seconds between activity events,
  the neutral background click toggle, and allowed Teams sites.
- **Automated shifts**: start/end time and active weekdays. Overnight shifts
  such as 22:00-06:00 are supported.
- **Smart Pause**: idle detection threshold and resume delay.
- **Native helper intervals** (full build only): helper action range.
- **Safety**: maximum continuous enabled runtime.
- **Diagnostics**: local event log, export, clear, and factory reset.

## Architecture

```text
stayactive/
├── manifest.json              # Store build manifest (no nativeMessaging)
├── manifest.full.json         # Full build manifest (adds nativeMessaging)
├── background.js              # MV3 state machine: power, schedule, pause, native helper
├── content/teams.js           # Top-frame Teams Web activity scheduler
├── popup/                     # Master control popup
├── options/                   # Control Deck and diagnostics
├── lib/
│   ├── storage.js             # Schema, normalization, schedule math
│   ├── random.js              # Randomized delays
│   └── logger.js              # Local ring-buffer logger
├── icons/                     # PNG toolbar/extension icons
├── branding/                  # K monogram source, lockups, brand sheet, renderer
├── welcome.html               # First-install guide
├── privacy.html               # Bundled privacy policy
├── native/                    # Optional desktop helper (full build only)
└── tools/
    ├── build.ps1              # Produces and validates store/full ZIPs
    ├── test-storage.js        # Schedule/state regression tests
    └── test-native.py         # Native protocol self-test
```

There is deliberately only one Teams Web scheduler: the content script owns
the randomized Teams activity timer. Background alarms own schedule
transitions, Smart Pause resume checks, session limits, and native helper
triggers. This avoids duplicate event streams.

## Build packages

On Windows:

```powershell
cd tools
.\build.ps1
```

Outputs:

- `dist/keepactive-store-1.1.1.zip`
- `dist/keepactive-full-1.1.1.zip`
- `dist/keepactive-store-1.1.1/` and `dist/keepactive-full-1.1.1/` unpacked folders

The store package excludes `native/`, `tools/`, `manifest.full.json`, source
documentation, icon generators, GIF/SVG assets, and audit files. The build
script fails if the store manifest declares `nativeMessaging`, if a remote URL
is found in packaged JS/CSS/HTML, or if a referenced icon is missing.

## Tests

```powershell
node tools/test-storage.js
py -3 tools/test-native.py
.\tools\build.ps1
```

`test-native.py` exercises the framing and commands without moving the mouse
(it uses `PING`/`CONFIG`/`STOP`). The helper also supports:

```powershell
py -3 native\host.py --selftest
```

### 60-minute acceptance test

Run each test with the laptop untouched for 60 minutes. Enable
**Diagnostics → Display diagnostic activity badge** first if you want to watch
events in the Teams tab.

1. **Display stays awake** — Store or full build, master switch ON, only
   *Display Keep-Awake* enabled. Set the OS screen-off/sleep timer to 5 min.
   Pass: the display stays on and the laptop does not sleep. IT-enforced lock
   policy can still lock the screen; that is expected.
2. **Teams Web status** — Sign in at `https://teams.microsoft.com` in a normal
   (not minimized) Chrome window. Enable *Teams Web Activity*. Watch your status
   from a second account or phone. Pass: status stays **Available** for 60 min,
   **or** the Diagnostic Console shows `Teams Web events dispatched` entries
   every 60–150 s. Record which one you observed; Teams may ignore synthetic
   (`isTrusted=false`) events.
3. **Teams Desktop with helper** — Full build only, helper installed and
   *Native Desktop Helper* enabled, Teams Desktop running. Pass: status stays
   **Available** for 60 min and the log shows `Native micro-activity executed`.
4. **Controls** — `Alt+Shift+S` toggles ON/OFF; the popup pause button holds
   activity; typing in Teams pauses activity (Smart Pause) and it resumes after
   the configured idle minutes; an enabled schedule turns activity off outside
   working hours. No errors appear on `chrome://extensions`.

## Honest limits

- IT Group Policy, Intune/MDM and OS lock settings can still sleep or lock the
  device. An extension cannot override them.
- KeepActive affects idle detection only. It does not defeat server-side or
  endpoint monitoring (Teams analytics, EDR, productivity tools).
- Teams presence is controlled by Microsoft and may ignore synthetic events.
- Activity simulation may violate your employer's policy. Use is your own
  responsibility.

## Permissions

| Permission | Why |
|------------|-----|
| `power` | Request display keep-awake while Chrome runs |
| `idle` | Smart Pause: detect active/idle/locked workstation state |
| `alarms` | Schedule transitions, resume checks, session limits, helper ticks |
| `storage` | Persist local configuration and diagnostics |
| `nativeMessaging` | Full build only; optional local desktop helper |

Host access is limited to `https://teams.microsoft.com/*` and
`https://teams.cloud.microsoft/*`. The content script runs only in the top
frame.

## Privacy

The extension makes no network requests. Preferences and diagnostics stay in
`chrome.storage.local`. The optional helper is a separate local process, makes
no network connections, and can be removed with the uninstall command in
`native/install.ps1` or `native/install.sh`.

The bundled policy is `privacy.html`. A public URL is still required for the
Chrome Web Store listing; host that file on a public HTTPS page before
submitting.

## License

MIT License. Local developer utility.
