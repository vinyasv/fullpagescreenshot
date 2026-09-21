# Fullpage Screenshot

Capture an entire webpage, mark it up, and export it as PNG or PDF. Fullpage Screenshot is a Chrome extension that scrolls the current tab, stitches the captured viewports, and opens the result in a local editor. No account or remote service is required.

## Get started

Requirements: Chrome 116 or newer, Node.js, and npm.

```sh
git clone https://github.com/vinyasv/fullpagescreenshot.git
cd fullpagescreenshot
npm ci
npm run build
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the project's **`dist/` directory**. Load `dist/`, not the repository root. After changing the code, run `npm run build` and click **Reload** on the extension card.

## Capture and edit

1. Open a regular webpage and click the extension icon. The capture includes the page content loaded when you click; content added later by an infinite feed does not extend it. Keep that tab active while it scrolls. In the popup, **Stop & save** opens the portion captured so far in the editor, while **Cancel** discards the capture.
2. The editor opens in a new tab. Use the floating toolbar to select, crop, draw, add shapes or text, and cover sensitive areas with a solid redaction.
3. Select an annotation on the canvas or in **Layers** to change its appearance in **Properties**. Drag layer rows to reorder them. Double-click text to edit it in place.
4. Choose **Download PNG** or **Download PDF**. Captures that exceed one safe PNG are downloaded as numbered images. PDF export supports A4 and Letter pages. **Recapture** takes a fresh screenshot of the source tab; **Discard** closes the editor.

Crop shows a full-image preview while you adjust its frame. **Done cropping** displays only the chosen area; select Crop again to readjust it. Fit and zoom affect the editor view, not exported resolution. Undo and redo cover annotation and layer changes.

Text supports Inter (bundled), Arial, Georgia, and Courier New. Shapes have outline/fill and line-width controls; rectangles also have corner radius. The color picker supports hue, opacity, numeric color entry, and swatches saved for the current editor tab.

**Redaction note:** A redaction is opaque in the editor and exported files, but the unredacted source remains in the editor tab's memory until that tab closes or reloads. Review exports before sharing them.

## Development

| Command | Purpose |
| --- | --- |
| `npm test` | Run the automated tests. |
| `npm run build` | Type-check, build `dist/`, and verify that the extension package is loadable. |
| `npm run package` | Build and create the single versioned ZIP for Chrome Web Store upload. |

The source is TypeScript. `src/background.ts` coordinates the capture and storage; `src/page.ts` measures and scrolls the webpage; `src/editor.ts` renders annotations and exports. Vite and CRXJS generate the Manifest V3 extension in `dist/`. Generated output, the ZIP, and `node_modules/` are not tracked in Git.

For a manual capture check, serve `fixtures/capture-cases.html` locally, then verify that the sticky header appears once, the lazy-loaded content appears, and the bottom marker is included. Also check crop/export dimensions and source-page scroll restoration.

## Privacy and limitations

Captures and edits are processed on your device; the extension does not upload them. Screenshot tiles are stored temporarily while the editor opens and are deleted after assembly. The finished capture and edits remain only in the editor tab's memory. See [PRIVACY.md](PRIVACY.md) for the full data-handling explanation.

- Chrome cannot capture restricted pages such as `chrome://` pages or the Chrome Web Store.
- Animated content, moving elements, and slow-loading media can create seams or missing content. Wait for the page to settle, then use **Recapture** if needed.
- The extension handles the largest visible vertical scroller when the outer page does not scroll. Complex nested or horizontal scrolling may not capture completely.
- Long pages are divided into the minimum number of safe PNG images. Pages wider than 30,000 device pixels are rejected, and browser memory limits may still affect large captures.
