# KeepActive 1.1.0 — Chrome Web Store Readiness

Last verified: 10 November 2026  
Test browser: Chrome 157.0.8103.50 on Windows  
Status: **Code, UI, packaging, and store assets are ready.** Three external actions remain: host the privacy policy at a public HTTPS URL, complete the listing in the Chrome Web Store developer console, and submit from your developer account. Nothing has been submitted.

---

## 1. Final artifacts

| Artifact | Path | Size | SHA256 |
|---|---|---|---|
| **Store package (submit this one)** | `dist/keepactive-store-1.1.0.zip` | 143.0 KB | `BB907F71F8F8C61571D10D76A0771FEED61DA9BA667644052E2BA1B1164CE503` |
| **Full package (do not submit)** | `dist/keepactive-full-1.1.0.zip` | 159.0 KB | `DA564389EB8D92FEC12FD735652197A2728D75DE232C18CBCF0DA0BE92F307A9` |

Unpacked staging folders:

- `dist/keepactive-store-1.1.0/` — 31 files
- `dist/keepactive-full-1.1.0/` — 37 files

The store ZIP contains no `native/`, `tools/`, `README.md`, `manifest.full.json`, icon generators, or non-PNG icon assets. The full ZIP declares `nativeMessaging` and includes the optional desktop helper; it is for local/developer installation only.

---

## 2. Verification evidence

### Automated tests

| Check | Result |
|---|---|
| `node tools/test-storage.js` | **15/15 pass** — schedule math, overnight shifts, normalization, effective-state logic |
| `py -3 tools/test-native.py` | **8/8 pass** — native framing, `READY`, `PING`, `CONFIG`, unknown command, `STOP`, clean exit |
| `powershell -File tools/build.ps1` | Pass — MV3 manifests, version match, icon references, content-script paths, no remote URLs, ZIP layout, `node --check` on 8 JS files |
| Store CDP smoke test | **25/25 pass**, repeated 3 times for stability |
| Full CDP smoke test | **5/5 pass** |
| Native helper live test | **7/7 pass** — enable, connect, `NATIVE_TEST`, connected state, disable, disconnect, no page errors |

### Store-build UI checks

- `manifest.json` has no `nativeMessaging`.
- Popup hides the Native Desktop Helper card.
- Control Deck hides the helper card and helper settings.
- Welcome guide hides the native-helper step and the full-build variant; runtime detection uses the active manifest.
- No user-facing “upload to the Chrome Web Store” wording remains in the store package.
- No remote fonts, analytics, or third-party URLs are referenced.
- Page CSP is `script-src 'self'; object-src 'self'`.

### Defects found and fixed during final verification

- **Popup stale-state race:** an in-flight initial `GET_STATE` response could overwrite a newer toggle response, leaving the pause button disabled and the uptime clock at zero. Fixed with a state epoch in `popup/popup.js`.
- **Non-deterministic smoke test:** the test inherited the 09:30–18:30 default schedule and live Smart Pause state. It now resets state and disables Smart Pause only for the session-clock test, so it no longer depends on wall-clock time or workstation activity.

---

## 3. Chrome Web Store listing copy

### Name

```text
KeepActive
```

### Summary (113 characters; limit 132)

```text
Keeps your display awake and sends small activity events to Microsoft Teams on the web. Local-only, no telemetry.
```

### Category

```text
Productivity
```

### Language

```text
English (United States)
```

### Detailed description

```text
KeepActive is a local-only Chrome extension for long passive sessions: presentations, dashboards, monitoring screens, downloads, and data rendering.

WHAT IT DOES

• Display keep-awake — asks Chrome to keep the display on while KeepActive is active and Chrome is running.
• Teams Web activity — sends small, randomized pointer-move and Shift-key events to top-level Microsoft Teams Web tabs. It never clicks, types text, reads messages, or changes Teams content.
• Automated shifts — engages only during the workdays and hours you choose, including overnight schedules.
• Smart Pause — uses the operating system idle signal to pause while you are actively using the computer, then resume after your chosen idle delay.
• Manual pause/resume, an Alt+Shift+S hotkey, a session safety limit, and local diagnostics.

WHAT IT DOES NOT DO

• No telemetry, analytics, advertising, accounts, tracking cookies, remote fonts, or third-party requests.
• No native app, installer, or desktop control in this package.
• Does not guarantee a Microsoft Teams presence state. Microsoft controls presence.
• Does not bypass screen lock, Intune, Group Policy, MDM, EDR, or any other corporate control.

REQUIREMENTS

• Chrome 116 or newer.
• Chrome must be running for display keep-awake.
• Keep a Microsoft Teams Web tab open for Teams Web activity. Chrome may throttle timers in background tabs, so a normal open tab is recommended.

PRIVACY

Preferences and diagnostics stay in chrome.storage.local inside your browser profile. See the privacy policy for details.
```

### Single-purpose statement

```text
KeepActive keeps the display awake and generates small, periodic activity events in Microsoft Teams Web tabs according to a user-configured schedule and pause rules.
```

---

## 4. Permission justifications

Use these in the “Permission justification” fields in the developer console.

| Permission | Justification |
|---|---|
| `power` | Requests display keep-awake while KeepActive is active and Chrome is running. It does not prevent OS lock policy. |
| `idle` | Reads the OS idle state so Smart Pause can stop activity while the user is at the keyboard and resume after the configured away period. |
| `alarms` | Schedules shift transitions, Smart Pause resume checks, session-limit enforcement, and helper ticks without a background busy-loop. |
| `storage` | Persists user settings, session totals, and a local diagnostic ring buffer. |
| `host_permissions` | Restricts the Teams content script to `https://teams.microsoft.com/*` and `https://teams.cloud.microsoft/*` so it can dispatch activity events only on Teams Web pages. |

Notes for the reviewer:

- `nativeMessaging` is **not** requested by the store package.
- The content script runs only in the top frame and does not read page content, messages, or credentials.
- The extension makes no remote requests and loads no remote code.
- The manifest does not request `tabs`, `scripting`, `webRequest`, or broad host permissions.

---

## 5. Privacy practices questionnaire

Recommended answers:

| Question | Answer |
|---|---|
| Does the extension collect personally identifiable information? | No |
| Health information? | No |
| Financial or payment information? | No |
| Authentication information? | No |
| Personal communications? | No — the extension does not read Teams messages |
| Location? | No |
| Web history? | No — no page URLs or browsing history are stored or transmitted |
| User activity? | No — OS idle state is read locally; no keystrokes, clicks, or browsing activity are collected |
| Website content? | No |
| Is data sold or shared with third parties? | No |
| Is data used for creditworthiness or lending? | No |
| Does the extension use remote code? | No |
| Is there a privacy policy URL? | Yes — the public URL you host in section 7 |

The extension does not transmit any data off the device.

---

## 6. Store assets

All screenshots are exact **1280×800 PNG** files captured from the packaged store build. The popup image is composited around an actual popup capture; the other two are unmodified UI captures. Suggested order:

| Order | File | Shows |
|---|---|---|
| 1 | `store-assets/keepactive-1-popup-1280x800.png` | Popup hero: active status, display keep-awake, Teams Web activity, pause control |
| 2 | `store-assets/keepactive-2-control-deck-1280x800.png` | Control Deck: Teams Web intervals, work shifts, Smart Pause |
| 3 | `store-assets/keepactive-3-setup-guide-1280x800.png` | Setup guide: quick start and enterprise notice |

Optional small promo tile (440×280, exact):

- `store-assets/keepactive-promo-440x280.png`

The screenshots contain no native-helper UI, so they match the browser-only store package.

---

## 7. Privacy policy hosting

The Chrome Web Store requires a public HTTPS privacy-policy URL. The bundled `privacy.html` is self-contained (no images, scripts, or external assets), so it can be hosted as a single file.

Example with GitHub Pages:

1. Copy `privacy.html` into a public repository, for example `keepactive/privacy.html`.
2. Enable **Settings → Pages** for the repository.
3. Confirm the page loads in a private window without signing in, for example:
   `https://<your-account>.github.io/keepactive/privacy.html`
4. Paste that HTTPS URL into the listing’s **Privacy policy URL** field.

Do not use a `chrome-extension://` URL; reviewers cannot open it.

---

## 8. Manual Teams verification (recommended before or right after submission)

Real Teams presence cannot be verified from this machine without a signed-in Teams account and a second observer account. Use this protocol when accounts are available:

1. Sign in to `https://teams.microsoft.com` in the test Chrome profile. Keep the Teams tab open in a normal window.
2. Install the store build, enable the master switch, enable **Teams Web Activity**, and set the interval range to 60–150 seconds.
3. Sign in to Teams with a second observer account on another device. Set the observer to see the test account’s presence.
4. Leave the test machine untouched for at least 15 minutes and watch the observer’s view.
5. Confirm the test account does not send messages, edit files, or change Teams content.
6. Turn the extension off and confirm activity stops.
7. Repeat with a schedule boundary: set a shift that ends two minutes in the future and confirm the extension reports **Off-Schedule** after it passes.
8. Move the mouse during a run and confirm Smart Pause reports **Paused (You are active)**.

Record the observed result. A single pass does not guarantee future presence behavior; Microsoft controls the presence signal and may change it.

---

## 9. Full build and native helper (not for submission)

The full build was installed and tested locally on Windows:

- Extension ID used for the test: `ionfdbjpookamghooihgnbgmipncncoc`
- Native host installed at `%LOCALAPPDATA%\KeepActive\native`
- Registered for Chrome and Edge under `HKCU\Software\...\NativeMessagingHosts\keepactive_helper`
- Live extension-to-helper connection and `NATIVE_TEST` passed
- Installer verifies the compiled launcher handshake: `READY -> STOPPED exit=0`

Install commands:

```powershell
# Windows
native\install.ps1 -ExtensionId <extension-id>
```

```bash
# macOS / Linux
native/install.sh --extension-id <extension-id>
```

The helper requires Python 3.8+. On macOS it also requires Accessibility permission. If the extension ID changes, rerun the installer.

**Do not upload `keepactive-full-1.1.0.zip` to the Chrome Web Store.** It requests `nativeMessaging`, and the helper is not distributed through the store.

---

## 10. Known limitations and review risks

- Display keep-awake works only while Chrome is running; it is not a system-wide wake lock.
- Teams Web activity requires an open Teams Web tab. Chrome can throttle timers in background or heavily occluded tabs.
- KeepActive does not guarantee a Teams presence state, availability, or “active” status.
- Enterprise policy, MDM, EDR, and OS lock settings can still lock the device. The extension does not bypass them.
- Automated activity may be restricted by your organization’s acceptable-use policy or Microsoft’s terms. The listing and in-product notice disclose this.
- Store review may ask about the automation wording. The accurate position is: the extension dispatches small synthetic input events in Teams Web tabs; it does not read content, click controls, type text, or falsify a presence guarantee.
- Version 1.1.0 is the first public package. Keep the version unchanged until after the first review unless you make further code changes.

---

## 11. Remaining external actions

- [ ] Host `privacy.html` at a public HTTPS URL and paste it into the listing.
- [ ] Optional: add a support URL (repository, contact page, or support email) and homepage.
- [ ] Optional: run the manual Teams presence protocol in section 8 with two accounts.
- [ ] Sign in to the Chrome Web Store developer console with the publishing account.
- [ ] Create the listing: name, summary, detailed description, category, language, screenshots, promo tile, privacy URL.
- [ ] Complete the privacy practices questionnaire using section 5.
- [ ] Upload **`dist/keepactive-store-1.1.0.zip`** only.
- [ ] Submit for review.
- [ ] After approval, install from the live listing and repeat the store smoke checks.

No Chrome Web Store submission has been made.
