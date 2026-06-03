# Release Verification

## Local macOS Package

Run:

```bash
npm run package:mac
```

Expected output:

- `release/mac*/Interlinear.app`
- Product name: `Interlinear`
- Bundle identifier: `com.richardkelley.interlinear`
- Version: `0.1.0`
- Icon: `build/icon.icns`

## Packaged Smoke

After packaging, run the generated app binary with:

```bash
INTERLINEAR_PACKAGED_SMOKE=1 release/mac*/Interlinear.app/Contents/MacOS/Interlinear
```

Expected result:

- The packaged app loads `dist/index.html`, not the Vite dev server.
- The smoke command prints JSON with `rendererLoaded: true`.
- Document save/open and lexicon save/open use isolated temp files and report matching roundtrip titles.
- The app exits by itself after the smoke run.

Latest result:

```json
{
  "packagedSmoke": true,
  "documentRoundtrip": true,
  "lexiconRoundtrip": true,
  "documentTitle": "Packaged Smoke Document",
  "lexiconName": "Packaged Smoke Lexicon",
  "rendererLoaded": true,
  "rendererUrl": "file:///Users/richard/Documents/Interlinear/release/mac-arm64/Interlinear.app/Contents/Resources/app.asar/dist/index.html"
}
```

The packaged bundle metadata was also checked with `PlistBuddy`:

- `CFBundleIdentifier`: `com.richardkelley.interlinear`
- `CFBundleName`: `Interlinear`
- `CFBundleShortVersionString`: `0.1.0`

## Manual File Lifecycle

For a hands-on release check:

- Launch `release/mac*/Interlinear.app`.
- Create or edit a word box so the document shows Modified.
- Save the document as a `.iltdoc`, quit, relaunch, and open the saved file.
- Open the Lexicon tab, add a temporary entry, save as `.iltlex`, quit, relaunch, and open that lexicon.
- Confirm recent documents show the saved `.iltdoc` path by filename.

## Signing And Notarization

Unsigned local builds are the default. `package:mac` sets `identity: null`, so no Apple Developer credentials are required.

For distribution builds, configure signing and notarization separately:

- Apple Developer Program membership.
- Developer ID Application certificate available in the login keychain, or `CSC_LINK` and `CSC_KEY_PASSWORD`.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization.
- Hardened runtime and notarization settings enabled in the electron-builder mac configuration.

Unsigned builds may trigger Gatekeeper warnings on other Macs. Use right-click Open for local testing, or remove quarantine metadata only for trusted local artifacts with:

```bash
xattr -dr com.apple.quarantine release/mac*/Interlinear.app
```
