# Responsiveness Test Extension

A Chrome extension for side-by-side responsive website testing across mobile, tablet, and desktop viewport presets.

## Overview

Responsiveness Test Extension opens the current page in multiple synchronized previews so you can quickly evaluate layouts across common screen sizes. It is designed for fast manual QA, visual comparison, screenshots, and lightweight interaction testing.

## Features

- **Preset device groups**
  - **Mobile and small:** 360, 390, 428
  - **Medium screen:** 768, 820, 1024
  - **Desktop:** 1440, 1728, 2560
- Add or remove custom devices in each group
- Persist custom device lists across sessions
- Use real device heights for the mobile and small preset group
- Default zoom set to **70%** for the mobile and small preset group
- Adjust zoom with **-**, **+**, and **Fit**
- View full-height responsive previews in a horizontally scrollable layout
- Use independent scrolling by default or enable **sync scroll**
- Capture a full preview strip screenshot and download it as a **PNG**
- Sync the tested URL with the current browser tab
- Record the tester tab and save the output as a **WebM**
- Enable **click sync** to broadcast clicks across previews

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder

## How to Use

1. Open any website you want to test
2. Click the extension icon in Chrome
3. A new tester tab opens with the current page loaded in multiple viewport sizes
4. Scroll horizontally to compare layouts across devices
5. Use zoom controls, sync scroll, click sync, screenshot, or recording as needed

## Typical Use Cases

- Check responsive layouts during development
- Compare breakpoints side by side
- Validate mobile, tablet, and desktop behavior quickly
- Capture screenshots for QA or design review
- Record responsive walkthroughs for demos or bug reports

## Tech Stack

- JavaScript
- CSS
- HTML

## Repository Description

Chrome extension for side-by-side responsive testing with multi-device previews, sync scroll, screenshots, click sync, and recording.

## Creating a Release on GitHub

### Option 1: Create a release from the GitHub UI

1. Open the repository on GitHub
2. In the right sidebar or top navigation, go to **Releases**
3. Click **Draft a new release**
4. Create a new tag, for example `v1.0.0`
5. Add a release title, for example `v1.0.0 - Initial release`
6. Add release notes describing what is included
7. Click **Publish release**

Suggested first release notes:

- Initial version of the Responsiveness Test Extension
- Multi-device responsive preview testing
- Custom device groups with persistence
- Sync scroll and click sync
- Screenshot export to PNG
- Screen recording export to WebM

### Option 2: Create a release using Git tags

```bash name=terminal
 git tag v1.0.0
 git push origin v1.0.0
```

Then create the release from the **Releases** page on GitHub using that tag.

## Suggested Next Improvements

- Add screenshots or GIF demos to the README
- Add a license file
- Add versioned release notes for each update
- Add badges for version and browser support
