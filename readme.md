## Implementation

This is a Chrome browser extension for responsive testing.

### Features Implemented:
- Three device groups: `Mobile and small` (360, 390, 428), `Medium screen` (768, 820, 1024), and `Desktop` (1440, 1728, 2560)
- Add/remove devices in each group (custom lists persist across sessions)
- Real device heights for the mobile and small preset group
- Default zoom is `70%` for the mobile and small preset group
- Adjustable zoom with `-`, `+`, and `Fit`
- Full-height responsive previews with horizontal scrolling
- Independent scrolling by default, with an optional sync scroll toggle
- Screenshot: Captures the full multi-device preview strip and downloads a PNG locally
- Syncs with current browser tab's URL
- Screen record: Records the tester tab and saves a WebM locally
- Click sync: Broadcasts clicks from one preview to the others

### How to Use:
1. Load the extension in Chrome:
   - Go to chrome://extensions
   - Enable Developer mode
   - Click "Load unpacked"
   - Select this folder
2. Navigate to any website
3. Click the extension icon in the toolbar
4. The tester will open in a new tab with the current page's URL loaded in multiple screen sizes
5. Use horizontal scroll to view different screens
