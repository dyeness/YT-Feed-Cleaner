# YouTube Feed Cleaner · 1.5.1

[Русская документация](README_ru.md)

A build-free Manifest V3 Chrome/Chromium extension with conservative, explainable YouTube filtering.

## Install / update

1. Download [the source](https://github.com/dyeness/YT-Feed-Cleaner) or run:
   ```sh
   git clone https://github.com/dyeness/YT-Feed-Cleaner.git
   ```
2. Open `chrome://extensions`, enable **Developer mode**, and **Load unpacked** the directory containing `manifest.json`.
3. Pin the new icon. To update, replace the files **in the same directory**, reload the extension, then reload existing YouTube tabs to replace their old content scripts. Updating an existing installation preserves settings; uninstalling may not.

No Node.js or build is required for normal use. `npm run package` optionally creates a runtime-only `dist/yt-feed-cleaner` directory. Keep the same installation path across updates to preserve the extension identity and settings.

## Filtering

- **Mixes:** all pages; requires a primary RD playlist link and a radio/mix/collection signal. A title saying “Mix”, an incidental description link, or a normal autoplay video with `list=RD` is not enough.
- **Shorts:** independent controls for Home, Search, and other pages; shelves and individual cards. The active player itself is untouched.
- **Watched:** configurable 1–100% threshold, using only the thumbnail resume-playback percentage. Pixel widths and unrelated progress elements do not match.
- **Age:** arbitrary days, 0 disables; only videos strictly older than the threshold match. Only isolated publication metadata is parsed—not titles, descriptions, view counts, or accessibility labels.
- **Duration:** minimum/maximum minutes, decimals supported; 0 disables each bound. Bounds are inclusive. Unknown duration, live and upcoming videos never match duration filters.
- **Live streams, upcoming premieres, regular playlists:** separate toggles. An ambiguous “Premiere” label is not enough to classify a future event.
- **Title phrases:** literal case-insensitive substring matching, one phrase per line; any matching phrase hides the video. No regular expressions.
- **Blocked channels:** exact names, @handles or channel URLs, one per line. Handles/URLs only match when that identity is present in the card. Names can be ambiguous; use an identity when available.
- **Never-hide channels:** override every filter, including Mixes and Shorts. With exceptions configured, Shorts shelves are filtered card by card rather than hidden as a whole. An unknown channel cannot match a rule.
- **Scope:** apply the video filters to Home, Search, watch-page recommendations and Subscriptions separately. Default remains Home only. Mixes and Shorts use their own controls.
- Global enable switch, reset filters, current-page hidden count, reasons and sample titles.
- **Show hidden temporarily:** pause this tab until resuming or reloading, without changing persisted settings.

Settings apply immediately to loaded content scripts. SPA navigation and changes to URLs, text, badges and progress recompute decisions, including restoration of recycled cards. Hiding uses an extension-owned CSS attribute, preserving YouTube's original inline display styles.

### Language, SVG, text size and disintegration

The **Appearance** tab provides:

- **Language:** automatic browser-language selection, explicit Russian or explicit English. Changes immediately translate labels, hints, hidden reasons, statuses and update errors, and also apply to new desktop notifications and the toolbar title/badge. Video titles, commit messages and channel names remain original; Chrome's extension-list name follows the browser language.
- **Text size:** standard 16 px, large 18 px (**default**) or extra large 20 px. Hints and buttons scale too. This affects only the extension popup.
- **SVG:** `icons/icon.svg` is used directly in the interface and is the single icon source. Chrome's toolbar/notification APIs do not support SVG, so `npm run icons` renders their required PNG fallbacks from that SVG.
- **Disintegration:** a separate opt-in toggle, **off by default**. A visible card dissolves left-to-right as thumbnail fragments drift away; colored particles are used when no thumbnail is available. Speeds: 0.45 / 0.8 / 1.2 seconds. Filtering decisions are unaffected.
- **Reduced motion:** respected by default; a separate toggle permits an explicit override of the OS preference.
- Offscreen/background-tab cards hide immediately. Effects are capped at four simultaneous cards with 48 particles each. Scrolling or resizing finishes pending effects and removes their particles.
- Disabling filtering/a matching filter or previewing hidden cards cancels effects and restores cards with no remaining hiding reason. Disabling only animation hides pending matches immediately. Recycled cards are reclassified before an effect completes, so a stale timer cannot hide a different video.
- **Reset filters** preserves language, text size, animation and update preferences. Every filter and the master switch remain on the **Filters** tab.

The effect takes no screenshots, reads no canvas, clones no players and plays no audio; fragments reuse the thumbnail URL already present on the page. Unsupported/failed visual effects fall back to immediate hiding.

### Accuracy limits

Unknown metadata stays visible for the affected filter. Publication ages support isolated English/Russian relative labels. Rounded months use a conservative **28-day** lower bound; years use **365 days**. This can leave some older videos visible rather than hiding borderline ones based on an overestimate. Unsupported languages/layouts stay visible. YouTube experiments may require adapting `content.js`; compatibility with every live layout cannot be guaranteed.

## GitHub updates

Checks on installation/update, browser startup, every **6 hours**, and manually. Sleeping/closed browsers cannot guarantee exact intervals.

- Uses the public API for `dyeness/YT-Feed-Cleaner` and discovers its default branch.
- **Version update:** the latest stable Release or repository manifest version newer than the installed version. Prerelease labels are not treated as stable releases; repositories without releases still work via the manifest.
- **Commit update:** the default branch tip changed since the last successful commit check. The first check establishes a baseline, without reporting an existing commit as new. A commit is not a released version or proof that your local files are outdated.
- Desktop notification, **NEW** toolbar badge, and separate links in the popup. Commit tracking and desktop notifications can be disabled independently; version updates remain visible in the popup.
- **Mark as seen** persists version/commit identities; rechecking the same update does not restore its alert.
- Network failures preserve known updates. Last successful check, errors and GitHub rate-limit backoff are visible; manual checks also respect backoff.
- **No automatic installation:** update source files manually. Desktop notification delivery depends on browser/OS settings.

## Privacy

Settings and update state are local. Diagnostic titles travel only between the current tab and extension popup, without persistence or network transmission. No telemetry, GitHub tokens, browsing history access, or `tabs` permission. Update checks only fetch public repository metadata from GitHub API/raw; the opt-in visual effect may reuse an already displayed thumbnail URL, without uploading anything to third-party services. Permissions: `storage` for settings, `alarms` for checks, `notifications` for alerts, GitHub host access for network checks. Content scripts target desktop `youtube.com` and `www.youtube.com`, not the mobile site.

## Development / verification

Node.js 20+ (tested with Node.js 24):

```sh
npm ci
npm test
npm run check
npm run icons
npm run locales # after editing translation JSON files
npm run package
# Optional real MV3 browser smoke test:
npx playwright install chromium
npm run test:browser
```

Architecture:

- `shared.js`: normalized defaults, pure parsing and classification.
- `content.js`: DOM adapter, restoration and tab diagnostics.
- `dissolve.js`: bounded particle effects, cancellation and cleanup.
- `i18n.js`, `translations.js`: shared popup/notification/error localization, generated from `_locales`.
- `updates.js`: pure update-state transitions.
- `background.js`: GitHub fetching, schedule, backoff, notifications and badge.
- `popup.*`, `_locales/`: accessible English/Russian controls.
- `icons/`, `scripts/generate-icons.js`: original SVG and reproducible 16/32/48/128 PNGs.
- `tests/`: false-positive regressions, migration, popup, API errors, notification deduplication and acknowledgements.

The browser smoke test loads the actual extension into an **isolated temporary Chromium profile**, uses controlled YouTube HTML fixtures rather than live layouts, and verifies injection, CSS, restoration, popup storage/messaging and service-worker updates. It does not modify the user's browser profile or prove compatibility with every live YouTube experiment. It also checks RU/EN selection, actual text sizes, SVG, thumbnail disintegration, recycled-card cancellation and reduced motion. Screenshots: `dist/popup-preview.png`, `dist/appearance-ru-preview.png`, `dist/appearance-en-preview.png`, `dist/dust-preview.png`.
