# Full-page screenshot extension: product brief

Research checked 2026-09-17. The linked original GoFullPage review page could not be read reliably, so this brief does not claim review counts or quote individual reviews.

## Opportunity

GoFullPage offers unlimited free captures and image/PDF export, but requires Premium ($12/year) to download a cropped or annotated result. Its optional iframe flow can ask for `tabs`, `webNavigation`, and `<all_urls>`, triggering Chrome's “Read and change all your data on all websites” warning. GoFullPage says this is requested only when needed and only runs after activation. We should describe the tradeoff accurately, not imply that it silently requests blanket access.

The product promise: **one-click, full-page capture; useful editing and export free; screenshots stay on the device; no access to every site by default.**

## MVP

1. Chrome Manifest V3 extension, invoked from the toolbar or shortcut.
2. Capture the active page by scrolling and stitching visible viewport images. Show progress and allow cancel.
3. Open a local editor with crop, arrows, rectangles, text, pen, blur/redaction, undo/redo.
4. Export PNG and multi-page PDF, with A4/Letter size choices. Copy image to clipboard.
5. No account, server upload, tracking, watermark, or paywall for editing.
6. Clear failure messages for browser internal pages, protected surfaces, embedded frames, and pages that change during capture.

## Permission design

Required: `activeTab` and `scripting`. The user gesture grants temporary access to the current tab; `scripting` controls scrolling and page-state adjustments. `captureVisibleTab` works with `activeTab`. Do not request `tabs`, `webNavigation`, `debugger`, or `<all_urls>` for the basic flow. Avoid `downloads` initially by initiating a user download from the editor page; add it as an optional permission only if automated naming or saving proves valuable. Test the exact install warning in Chrome before release.

Default to capturing the rendered iframe area as seen in each viewport. Deep scrolling inside embedded frames is a separate, explicit feature requiring a permission review. Explain that limitation in the UI. Never claim “zero permissions.”

## Technical plan

- **Capture controller:** record viewport size, device pixel ratio, scroll offsets, document height, and original scroll position. Scroll in measured increments; wait for layout to settle; capture each viewport at no more than Chrome's documented two `captureVisibleTab` calls per second; restore page state in `finally`.
- **Stitcher:** align images using actual scroll offsets and pixel ratio, handle final overlap, fixed/sticky elements, lazy loading, smooth scrolling, and page-height changes. Process in an extension page so large image work does not rely on the service worker staying alive.
- **Editor:** maintain non-destructive edits above the captured bitmap. Render redactions into exports and make the visual treatment explicit; cropping or blurring does not remove sensitive content from an underlying original if that original is separately shared.
- **Large pages:** detect browser canvas/encoding limits before final assembly. Offer segmented images with a clear explanation rather than a corrupt single file.
- **Privacy:** all pixel data stays in browser memory/local storage only as needed. No remote scripts or analytics. Open source the extension and publish a concise permission/data-handling page.

## Hard cases to test

Long pages; sticky headers; fixed chat widgets; lazy-loaded images; infinite scroll; inner scroll containers; cross-origin iframes; zoom and high-DPI displays; dark mode; very wide pages; rapidly changing content; browser-restricted pages; cancellation midway. Test on real public pages and a controlled fixture page. Compare captured dimensions, seams, duplicated fixed elements, restored scroll position, and export output.

## Release order and success bar

1. Prototype capture + stitching on ordinary pages.
2. Add local editor, PNG export, and multi-page PDF export.
3. Make hard cases reliable, document unsupported pages, and verify install/runtime permission prompts.
4. Beta release with an opt-in, user-initiated bug report that does not attach screenshots automatically.

Success bar: install without an all-sites warning; one click to capture; free crop/annotate/PNG/PDF export; no network transfer of captures; no blank bands or obvious seams on the controlled test set; original scroll state restored after success, failure, or cancel.

## Positioning and business model

The feature gap is narrow: free editing plus trust. A competing extension should be genuinely easier and reliable, not merely cheaper. Keep the core free indefinitely. If revenue is needed, consider optional team workflows or a one-time supporter purchase, with no capture/editor limits. Validate demand through a small beta before adding sharing, cloud storage, or subscriptions.

## Sources

- GoFullPage FAQ and pricing: https://gofullpage.com/faq and https://gofullpage.com/premium
- GoFullPage permission explanation: https://blog.gofullpage.com/2025/09/02/your-privacy-our-priority-a-guide-to-gofullpages-permissions/
- GoFullPage Chrome listing update: https://blog.gofullpage.com/2026/08/11/gofullpage-chrome-update/
- Chrome `activeTab`, `scripting`, tabs, permissions: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab , https://developer.chrome.com/docs/extensions/reference/api/scripting , https://developer.chrome.com/docs/extensions/reference/api/tabs , https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
- Chrome extension service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
