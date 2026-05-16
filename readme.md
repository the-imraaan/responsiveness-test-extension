# Responsiveness Test Extension

A Browser extension for side-by-side responsive website testing across mobile, tablet, and desktop viewport presets.

## Overview

Responsiveness Test Extension opens the current page in multiple synchronized previews so you can quickly evaluate layouts across common screen sizes. It is designed for fast manual QA, visual comparison, screenshots, and lightweight interaction testing.

<img width="1506" height="864" alt="responsive_screen1" src="https://github.com/user-attachments/assets/2e10a3d4-0e60-4dcb-a432-47037cbb1549" />

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

1. Open any browser
2. Go to the Extention page
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder

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

Browser extension for side-by-side responsive testing with multi-device previews, sync scroll, screenshots, click sync, and recording.

