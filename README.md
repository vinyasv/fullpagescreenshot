# Fullpage Screenshot

A local Chrome extension for full-page screenshots. One click scrolls through the page and assembles full-resolution viewport captures. The editor offers free crop, pen, arrows, rectangles, text, solid redaction, PNG, and multi-page PDF (A4 or Letter).

The editor has a floating tool bar, a Layers panel, and selection-specific Properties. Select an annotation on the canvas or in Layers to move, resize, rename, reorder by dragging, recolor, or delete it. New pen, arrow, circle, and rectangle annotations start at 2 px line width. The color picker offers hue, opacity, RGB/hex entry, and swatches saved for the current editor tab. Rectangles support corner radius; text supports bundled Inter plus Arial, Georgia, and Courier New, with Regular/Bold weight and size controls. The panels can be collapsed, and Fit/zoom controls change only the editing view. Arrows have draggable endpoints; text opens its single inline editor when added and can be edited again by double-clicking it on the canvas or in Layers, or by pressing Enter while selected. Crop opens a shaded preview with draggable handles and a **Done cropping** control; afterward the editor displays only the cropped region, and selecting Crop again restores the full image for adjustment. Undo and redo cover annotation and layer changes.

## Run locally

```sh
npm install
npm run build
```

In `chrome://extensions`, remove any installation that points to the project root. Enable Developer mode and **Load unpacked**, selecting **`/Users/vinyas/Desktop/gofullpage/dist`**. The project root is source code and is not an installable extension. Navigate to an ordinary webpage and click the Fullpage Screenshot toolbar icon. A small popup shows scroll progress and a Cancel button; if you close it, capture continues and the badge shows progress. The editor's **Recapture** action captures the source page again. `npm run package` creates `fullpage-screenshot-extension.zip` for Chrome Web Store upload; the ZIP contains the contents of `dist`, not the source directory.

## Permissions and privacy

`activeTab` and `scripting` let Fullpage Screenshot scroll the tab you choose; `storage` and `unlimitedStorage` hold local screenshot data while the editor is open. No screenshots or page data are sent to a server. The extension does not request `debugger` or persistent website access. See [PRIVACY.md](PRIVACY.md).

## Known limitations

- Full-page bounds can omit content inside a nested scrolling region. The extension handles the largest visible vertical scroller when the outer document is viewport-sized. Other nested or horizontal scrollers may require a later version.
- Scrolling gives lazy-loaded content time to render, but especially slow media may still be missing. Use **Recapture** after the page finishes loading.
- Moving or animated page content can cause seams between viewport captures. Sticky headers are hidden after the first tile and restored afterward.
- Pages above 30,000 pixels in either direction or 120 million pixels total return a clear error instead of a partial result. Some browsers may fail on smaller images due to memory limits.
- Chrome restricts script injection on browser internal pages and the Chrome Web Store.
- Screenshots remain in extension-local storage until **Discard** is clicked. They are deleted on uninstall. A future release should add automatic expiration and a capture history policy.

## Development checks

`npm test` runs tile-overlap tests; `npm run build` type-checks and packages the extension. For manual validation, use `fixtures/capture-cases.html` through a local HTTP server and check the screenshot's bottom marker, sticky header, export dimensions, crop/redaction, PDF page count, and restored source scroll position.
