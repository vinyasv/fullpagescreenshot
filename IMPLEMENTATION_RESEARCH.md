# Implementation research and launch recommendation

Checked 2026-09-17. This is a source review, not yet a hands-on build or quality audit.

## What GoFullPage actually does

GoFullPage's current FAQ says it scrolls down and across the page and assembles each scroll window into one image. Its 2020 product explanation explicitly calls this automated scrolling and stitching. The public historical source confirms the mechanism: `page.js` scrolls to planned positions, `api.js` calls `chrome.tabs.captureVisibleTab`, and each result is drawn at its page coordinates with `canvas.drawImage`. The current store version comes from a private fork, so its exact modern code is unavailable; its current public explanation still describes the same strategy. It may not save separate image files: the viewport captures can be composited directly into canvas in memory.

Sources: https://gofullpage.com/faq ; https://blog.gofullpage.com/2020/10/18/what-is-gofullpage/ ; https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/page.js ; https://github.com/mrcoles/full-page-screen-capture-chrome-extension/blob/master/api.js

## One-shot CDP capture: why it can stop at the viewport

Chrome DevTools Protocol `Page.captureScreenshot` is capable of capture beyond the viewport, but `captureBeyondViewport` defaults to false. A robust call first obtains `Page.getLayoutMetrics().cssContentSize` (the top-level scrollable area in CSS pixels), then captures that rectangle with `captureBeyondViewport: true`. Puppeteer's `fullPage: true` is the higher-level equivalent; its default is false. Calling the raw screenshot command with defaults returns a viewport screenshot.

Even with correct parameters, the requested *page* may not be the content the user considers the full page:

- An app shell can keep the top-level document at viewport height and scroll inside a `div` or iframe. In that case `cssContentSize.height` can equal the viewport height. A full-document screenshot is then viewport-sized. A Puppeteer issue documents this exact overflow-container pattern.
- Lazy-loaded content may not exist until the page or inner scroller is traversed; a single capture does not inherently trigger those loads.
- Extremely large requested images can fail or return blank regions due to rendering/memory limits. Older Puppeteer/Chromium issues show this; exact current thresholds should be measured rather than assumed.
- Expanding the viewport to force rendering may fire resize handlers or change responsive layout, so it can alter the page being captured.

**Product decision:** a one-click hybrid is technically feasible: attach the debugger, measure `cssContentSize`, attempt one full-page capture, detach in `finally`, and run scroll capture if the one-shot path errors or is clearly incomplete. Chrome lists two install warnings for `debugger`—page debugger access and read/change data on all websites—and it cannot be requested as an optional permission. The hybrid therefore makes every installation accept this broader permission, even when scrolling would have sufficed. A privacy-focused extension can instead ship scroll capture alone; a separate desktop/browser-automation product could choose CDP without imposing that extension warning on every install.

Fallback detection is only partial: an API error, a measured app-shell viewport-sized document with an identifiable inner scroller, or an output smaller than expected are strong signals. Full-sized output with blank lazy content can look valid, so a pre-scroll/loading pass and targeted test pages remain necessary. If Chrome DevTools opens on the same tab during our attachment, `chrome.debugger.onDetach` fires; treat that as a retry/fallback condition and always clean up session state.

Diagnostic for a one-shot prototype: compare `cssContentSize` with viewport dimensions before capturing; then inspect the resulting PNG dimensions and actual lower-page pixels. If metrics equal viewport, investigate inner scroll containers. If dimensions are full but lower pixels are blank, investigate lazy loading or rendering limits.

Sources: https://chromedevtools.github.io/devtools-protocol/1-3/Page/ ; https://pptr.dev/api/puppeteer.screenshotoptions ; https://github.com/puppeteer/puppeteer/issues/1273 ; https://github.com/puppeteer/puppeteer/issues/3202 ; https://github.com/puppeteer/puppeteer/issues/5300 ; https://developer.chrome.com/docs/extensions/reference/permissions-list ; https://developer.chrome.com/docs/extensions/reference/api/permissions

## Recommendation

Build a small Chrome Manifest V3 extension around `activeTab` + `scripting`, using Chrome's `captureVisibleTab` to collect viewport tiles. Bundle **Konva** for editor objects and **jsPDF** for multi-page PDF. Use the open-source projects below as code references, and consider extracting a well-tested capture module after a license and code review. Do not ship a renamed, unchanged extension: the Chrome Web Store applies repetitive-content rules, and users need a meaningful reason to switch.

Our useful difference is a focused screenshot workflow: free crop/annotation/redaction, polished A4/Letter PDF pagination, no account, no screenshot upload, and a clear, minimal permission story.

## Approaches

| Approach | Speed | Permission fit | Main tradeoff |
| --- | --- | --- | --- |
| Scroll + `captureVisibleTab` + stitch | Best MVP choice | `activeTab` + `scripting` for ordinary pages | Must handle scroll seams, sticky elements, lazy loading, and Chrome's 2 captures/second ceiling. |
| `chrome.debugger` + DevTools Protocol full-page capture | Faster capture on some pages | Poor: powerful debugger permission and browser warning | Conflicts with the trust proposition; defer. |
| DOM-to-canvas libraries such as html2canvas | Easy demo | Still needs page access | Can differ from what Chrome rendered, especially cross-origin frames, fonts, canvas/video, and complex CSS; not the core engine. |
| Fork an existing full extension | Fastest apparent start | Depends on manifest | Inherits code, UX, permissions, bugs, and maintenance burden. Audit and make substantial improvements before launch. |

## Open-source shortlist

| Project | License / fit | Decision |
| --- | --- | --- |
| [OpenScreenShot](https://github.com/pghqdev/OpenScreenShot) | MIT, MV3, capture + annotation + multi-page PDF already present. Its current manifest has no required host permissions, but requires `downloads`, `storage`, `unlimitedStorage`, `clipboardWrite`, `offscreen`, and `contextMenus`, and includes recording features. | Best full implementation to study or fork if hands-on audit passes. Strip recording and unrelated permissions if forking. |
| [Snaproll](https://github.com/debashisn94/snaproll-extension) | MIT, small MV3 capture/crop/PNG/PDF reference with no dependencies. Its PDF is one long JPEG page and it has no annotation suite. | Good capture/stitch reference, not a complete product base. |
| [Original GoFullPage source](https://github.com/mrcoles/full-page-screen-capture-chrome-extension) | MIT, but public manifest is MV2 and the store runs a private fork. | Historical algorithm reference only; not a launch-ready base. |
| [Konva](https://github.com/konvajs/konva) | MIT canvas editor library; shapes, transforms, free drawing, and export. | Preferred editor engine. Implement crop and redaction behavior in our app. |
| [Fabric.js](https://github.com/fabricjs/fabric.js) | MIT and richer built-in image filters/brushes. | Viable alternative if Konva requires too much custom editor work. Choose one, not both. |
| [jsPDF](https://github.com/parallax/jsPDF) | MIT client-side PDF generator with image insertion. | Preferred first PDF exporter; slice edited raster to A4/Letter pages at controlled DPI. |

## Proposed architecture

1. Toolbar action begins a capture of the active tab. A content script measures document and viewport, controls scrolling, handles temporary CSS, and restores the original state.
2. The extension calls `chrome.tabs.captureVisibleTab` at Chrome's documented maximum rate of two calls per second; each tile records its actual scroll position and dimensions.
3. An extension page assembles tiles and hosts the editor. Avoid keeping large image state only in the MV3 service worker, which can terminate when idle.
4. The editor holds the screenshot as a locked image and annotations as separate Konva objects. Crop is a viewport/export boundary; undo/redo operates on edit commands. Export flattens the selected crop and edits to PNG.
5. PDF export rasterizes the edited result into page-sized strips, adds each strip to a jsPDF page, and downloads locally. Provide A4/Letter and portrait/landscape. Show an explicit warning when a single PNG exceeds canvas limits and offer segmented output.
6. Do not retain captures after the editor closes in v1 unless recovery is needed. Use a temporary local mechanism for transfer only. No backend or analytics.

## Permission and publication notes

Start with required `activeTab` and `scripting`; add `storage` only if needed for transfer/settings. A user-clicked anchor with a Blob URL may provide ordinary downloads without `downloads`; verify in Chrome. If naming, automatic saving, or PDF download require the Downloads API, make `downloads` optional and ask at the point of use. Avoid `debugger`, `<all_urls>`, and continuous content scripts. Bundle library code in the extension; MV3 does not allow remotely hosted executable code.

For the Chrome Web Store, prepare a privacy policy, accurate permission/data-use disclosures, listing assets, and a tested ZIP. Use a private or unlisted beta first; these listings still undergo review. Publication depends on the user's developer account and final review.

## First engineering spike

Build an unpacked extension that captures three representative pages: a static article, a long lazy-loading page, and a page with sticky UI. Verify no blank seams, original scroll position restored, and the expected install prompt. In parallel, open one captured bitmap in a Konva editor and export a cropped/annotated PNG and A4 PDF. Only after this spike choose whether to reuse code from OpenScreenShot or keep the smaller new implementation.

## Sources

- Chrome tabs API (`captureVisibleTab`, rate limit): https://developer.chrome.com/docs/extensions/reference/api/tabs
- Chrome activeTab and scripting: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab and https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome MV3 lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome Web Store privacy and MV3 code rules: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy and https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
- Chrome Web Store distribution: https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- Repositories and libraries linked above.
