# KeepActive 1.1.0 — Chrome Web Store Readiness

Last verified: 10 November 2026  
Test browsers: Chrome 157.0.8103.50 on Windows (original pass); Chrome for Testing 157.0.8103.38 headless on Linux (PRD-completion pass)  
Status: **Code, UI, packaging, store assets and policy pages are ready.** Remaining: enable GitHub Pages for `docs/` (see section 7), complete the listing in the Chrome Web Store developer console, and submit. Nothing has been submitted. See section 11 for the final checklist.

### PRD completion pass (10 November 2026)

Gaps closed against `PRD_StayActive_Extension.md`:

| PRD item | Change |
|---|---|
| FR2 neutral click | Occasional `pointerdown/mousedown/pointerup/mouseup/click` targeted at `<body>` itself (never a control); skipped while a text field is focused. On by default, toggle in Control Deck. |
| FR2 focus / visibility | Occasional `focus` + `visibilitychange` pings while the tab is visible. |
| FR2 mousemove on an element | Pointer events now target the element under the random point. |
| FR2 debug log | Every activity cycle is written to the Diagnostic Console (timestamp, event list, host). |
| FR5 real input | Real (`isTrusted`) keydown, mouse button, wheel, and touch input in Teams tabs triggers Smart Pause immediately. |
| FR7 allowed sites | Per-origin toggles for `teams.microsoft.com` and `teams.cloud.microsoft`. |
| README | 60-minute acceptance test plan and honest limits added; merge conflict resolved. |
| Logging race | Content script now forwards log entries to the service worker (single writer), fixing lost diagnostic entries. |
| Brand | New Crimson & Cream "Presence" mark (disc + status badge; badge shows active / paused / off) across icons, brand sheet, lockups, and store images. |

Intentional deviations from the PRD: `scripting` is not requested (unused), and `nativeMessaging` is absent from the store build instead of optional.

---

## 1. Final artifacts

| Artifact | Path | Size | SHA256 |
|---|---|---|---|
| **Store package (submit this one)** | `dist/keepactive-store-1.1.0.zip` | 92.1 KB | `AC0C4208FF630BE4687184FEA2A8E5B87547C94150C331935E542680A2960DF2` |
| **Full package (do not submit)** | `dist/keepactive-full-1.1.0.zip` | 109.1 KB | `FD5747CB44480B122681297157DFDE5971170C7C6D9BE157028BC968941AE7A3` |

Unpacked staging folders:

- `dist/keepactive-store-1.1.0/` — 47 files (includes 15 `_locales`)
- `dist/keepactive-full-1.1.0/` — 53 files

Upload the ZIP file itself. Do not use GitHub's **Code → Download ZIP**: that archive nests everything under a top-level folder (no root `manifest.json`) and includes source, tools and the native helper.

The store ZIP contains no `native/`, `tools/`, `README.md`, `manifest.full.json`, icon generators, or non-PNG icon assets. The full ZIP declares `nativeMessaging` and includes the optional desktop helper; it is for local/developer installation only.

---

## 2. Verification evidence

### Automated tests

| Check | Result |
|---|---|
| `node tools/test-storage.js` | **27/27 pass**: schedule math, overnight shifts, normalization, effective-state logic, Teams Web options, rating-prompt rules |
| `py -3 tools/test-native.py` | **8/8 pass** — native framing, `READY`, `PING`, `CONFIG`, unknown command, `STOP`, clean exit |
| `powershell -File tools/build.ps1` | Pass — MV3 manifests, version match, icon references, content-script paths, no remote URLs, ZIP layout, `node --check` on 8 JS files |
| Store CDP smoke test | **25/25 pass**, repeated 3 times for stability |
| Teams Web CDP test (stubbed `teams.microsoft.com` origin) | **15/15 pass** — event types, body-only clicks, hidden button never clicked, diagnostic log entries, allowed-site toggle, click toggle, Smart Pause on real keystroke, stop on master OFF |
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

The store takes the item title and summary from `manifest.json`. The title adds a short, descriptive phrase people search for ("keep screen awake", "stay active") without keyword stuffing. Microsoft's trademark stays out of the title and appears only where the description needs it to explain what the extension works with.

### Name (43 characters; limit 75)

```text
KeepActive: Keep Screen Awake & Stay Active
```

### Summary (120 characters; limit 132)

```text
Keep your screen awake and send gentle activity to Microsoft Teams on the web. Work schedules, Smart Pause, no tracking.
```

### Category

```text
Productivity → Tools (choose "Workflow & Planning" if "Tools" is not offered)
```

### Language

```text
English (United States)
```

### Detailed description

```text
Stop your screen from sleeping in the middle of a presentation, a dashboard or a long download. KeepActive keeps your display awake while Chrome is running and sends gentle, human-paced activity to Microsoft Teams on the web, only on the schedule you choose. The moment you touch your keyboard or mouse, it steps aside.

WHY PEOPLE USE IT

• Presentations, dashboards and monitoring screens that must stay on.
• Long downloads, renders, uploads and reading sessions.
• Keeping a Teams web tab from going idle during long passive work sessions.

WHAT IT DOES

• Keep screen awake: asks Chrome to keep the display on while KeepActive is active and Chrome is running.
• Teams on the web activity: small, randomized pointer moves, Shift taps and focus pings every 60–150 seconds by default, plus an optional click on the empty page background. It never clicks buttons, links or inputs, never types text, never reads messages and never changes Teams content. Background clicks and each Teams site can be turned off.
• Work schedules: runs only on the days and hours you choose, including overnight shifts.
• Smart Pause: uses your computer's idle signal to pause while you are working, then resumes after your chosen idle delay.
• One-click toolbar control, an Alt+Shift+S shortcut, a session safety limit and local diagnostics.

HOW TO USE

1. Pin KeepActive to the toolbar and switch it on.
2. Keep a Microsoft Teams web tab open (a normal tab works best).
3. Optional: set a work schedule and Smart Pause delay in the Control Deck.

PRIVACY FIRST

• No accounts, analytics, ads, tracking or third-party requests.
• Settings and diagnostics stay in your browser profile (chrome.storage.local).
• No native app or installer in this package.

GOOD TO KNOW

• KeepActive does not guarantee a Microsoft Teams presence status. Microsoft controls presence.
• It does not bypass screen lock, Intune, Group Policy, MDM, EDR or other company controls.
• Requires Chrome 116 or newer. Chrome must be running for keep-awake.

Microsoft and Microsoft Teams are trademarks of Microsoft Corporation. KeepActive is not affiliated with or endorsed by Microsoft.
```

### Localized listings

The store name and summary are localized through `_locales/<locale>/messages.json` (`extName`, `extDescription`, `cmdToggle`), with `en` as `default_locale`. Locales: en, de, es, fr, it, pt_BR, nl, pl, ja, ko, zh_CN, ru, hi, id, tr. The developer console then lists each language under **Store listing → language**; paste the matching `store-listing/<locale>.txt` into that language's **Detailed description**. Screenshots can stay English (they fall back to the default language). The extension's own UI (popup, Control Deck, welcome guide) is still English only.

### Single-purpose statement

```text
KeepActive keeps the display awake and generates small, periodic activity events in Microsoft Teams Web tabs according to a user-configured schedule and pause rules.
```

### Video and promo images

- **YouTube video:** upload `store-assets/keepactive-promo-1080p.mp4` to YouTube (Public or Unlisted), then paste its URL in the listing's **Global promo video** field.
- **Small promo tile (440×280):** `store-assets/keepactive-promo-440x280.png`.
- **Marquee promo tile (1400×560):** `store-assets/keepactive-marquee-1400x560.png`. It's used only if Chrome editors feature the item, but it's required to be considered.

### Rating prompt

Starting with this release, the popup asks once for a rating. It appears only for store installs, at least 7 days after the popup was first opened and after 2 hours of active use. **Rate it** opens the listing's review page. **Later** snoozes for 30 days, a second **Later** stops it, and **No thanks** stops it immediately. It offers no rewards, which store policy forbids, and sends nothing anywhere. The logic is in `lib/rating.js`, and the tests are in `tools/test-storage.js`.

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
| User activity? | No — OS idle state is read locally, and the Teams content script only notes *that* a real key/mouse press happened (to trigger Smart Pause); which key, where, or what was typed is never read, stored, or transmitted |
| Website content? | No |
| Is data sold or shared with third parties? | No |
| Is data used for creditworthiness or lending? | No |
| Does the extension use remote code? | No |
| Is there a privacy policy URL? | Yes — `https://ojjuasgupta.github.io/KeepActive/privacy.html` once published (section 7) |

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

The screenshots and promo tile were recaptured on 10 November 2026 from a fresh unpacked install of `dist/keepactive-store-1.1.0.zip` with `tools/capture-store-assets.mjs` (headless Chrome, en-GB locale so the 24h time fields render as 08:00/20:00, Roboto). They show the current Presence logo and the current setup-guide wording (optional click on the empty page background; never buttons, links or inputs). All are 24-bit PNG without alpha, square corners, full bleed.

The 128×128 icons use 96×96 artwork with 16 px transparent padding, per Chrome Web Store image guidance; only the soft shadow extends 1 px into the top padding.

The screenshots contain no native-helper UI, so they match the browser-only store package.

---

## 7. Privacy policy hosting

The Chrome Web Store requires a public HTTPS privacy-policy URL. `tools/build.ps1` copies `privacy.html` to `docs/privacy.html` on every build, so the hosted policy always matches the packaged one. `docs/index.html` is the landing/support page (static HTML/CSS plus a self-hosted Three.js bundle built from `site/` with `npm run build`; no external requests); `docs/.nojekyll` disables Jekyll processing.

Planned URLs (GitHub Pages lowercases the account name):

- Privacy policy: `https://ojjuasgupta.github.io/KeepActive/privacy.html`
- Homepage / support: `https://ojjuasgupta.github.io/KeepActive/`
- Contact: `filmfrenzy777@gmail.com` (named in the policy's Contact section)

To publish:

1. Merge this branch into `main` (Pages serves from a branch on GitHub).
2. The repository `OjjuasGupta/KeepActive` is public, so GitHub Free can serve Pages from it. Pages was not yet enabled as of 10 November 2026 (the privacy URL returned 404).
3. Open **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/docs`, and save.
4. After the deploy finishes, open the privacy URL in a private window without signing in.
5. Paste it into the listing's **Privacy policy URL** field, and the homepage into **Homepage URL** / **Support URL**.

Do not use a `chrome-extension://` URL; reviewers cannot open it. `homepage_url` is intentionally not set in `manifest.json`, so the package doesn't ship a link before the site exists; the listing fields above cover it.

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

## 11. Final pre-publication checklist

Sources: [Tiny Struggles release checklist](https://www.tinystruggles.com/posts/extension_release_checklist/), [chrome-extension-publish-checklist](https://github.com/stylejinmu/chrome-extension-publish-checklist), and Chrome Web Store image guidance.

### Done (verified 10 November 2026)

- [x] Manifest V3, version 1.1.0, minimal permissions (`power`, `idle`, `alarms`, `storage`), host access limited to the two Teams origins; no `nativeMessaging` in the store build.
- [x] Permission justifications and single-purpose statement written (sections 3–4).
- [x] No shipped `console.*`, `debugger`, `eval`/remote code, remote assets or hardcoded secrets; page CSP `script-src 'self'`.
- [x] Production build (`tools/build.ps1`) passes all manifest/ZIP/syntax assertions.
- [x] Automated tests: storage/schedule/rating 27/27, native helper protocol, store smoke 25/25, Teams Web stub e2e (all pass), run against a fresh unzip of the store ZIP.
- [x] Fresh unpacked install of the store ZIP loads with no page errors.
- [x] 128 px icons padded to Chrome guidance; screenshots 1280×800 and promo 440×280 recaptured from the packaged build.
- [x] Privacy policy names the contact email; `docs/` prepared for GitHub Pages.
- [x] `CHANGELOG.md` added.
- [x] Storybook checks: not applicable (no Storybook in this project).

### Pending you (outside this repository)

- [ ] Merge the localization PR into `main`.
- [ ] Enable **Settings → Pages → Deploy from a branch → main /docs** (repo is public; see section 7).
- [ ] Confirm `https://ojjuasgupta.github.io/KeepActive/privacy.html` loads signed out.
- [ ] Recommended: run the manual Teams presence protocol in section 8 with two accounts. Automated tests use a stubbed Teams page and can't confirm Microsoft's real presence behavior.
- [ ] Recommended: one manual pass on Windows/macOS Chrome (popup, toolbar icon states, Alt+Shift+S).

### Pending developer console

- [ ] Developer account registered (one-time fee paid), 2-Step Verification on, contact email `filmfrenzy777@gmail.com` verified.
- [ ] Create the listing with section 3 copy, category, language, the three screenshots and promo tile.
- [ ] Privacy URL, homepage and support URL from section 7.
- [ ] Permission justifications (section 4) and privacy practices questionnaire (section 5); certify data-use disclosures.
- [ ] Upload **`dist/keepactive-store-1.1.0.zip`** only (SHA256 in section 1) and submit for review.
- [ ] After approval, install from the live listing and repeat the store smoke checks.

No Chrome Web Store submission has been made.
