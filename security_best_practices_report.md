# Extension security and code-quality audit

Date: 2026-09-17. Scope: TypeScript extension source, HTML entry points, manifest, build configuration, dependency lockfile, storage and export flows. Findings below describe the original code; linked locations refer to the repaired code. No critical issue or demonstrated remote code execution was found. Two high-impact privacy defects and several reliability defects were fixed. Boundary hardening is distinguished from demonstrated vulnerabilities.

## High severity — fixed

### 1. Capture could include another tab (CAPTURE-001)

**Location:** [background.ts:25](src/background.ts#L25), [background.ts:53](src/background.ts#L53).

**Evidence:** The original loop checked the active tab, then executed `await sleep(index === 0 ? 250 : 540)` before `chrome.tabs.captureVisibleTab(...)`, with no subsequent focus check. The API captures the active tab in a window. If a user switched to another tab with capture permission during that delay, its pixels could be saved into the first tab's screenshot. Navigation could also mix different documents.

**Impact:** Sensitive content from an unintended tab could appear in a locally stored or subsequently shared export. This is a privacy race, not evidence of arbitrary website access or data being sent to a server.

**Fix:** Latch cancellation on tab activation, navigation and removal; verify the source immediately before and after the capture call; discard a result when cancellation occurs; pin injected operations to the original document ID. Tests cover switching away and back, switching while capture is pending, navigation, and normal capture.

**Residual limit:** Chrome offers no atomic capture-by-tab-ID operation here. Checks and events substantially narrow the race and reject detected changes, but cannot establish an absolute atomicity guarantee. Real browser timing still needs smoke testing.

### 2. Redaction opacity could expose covered content (REDACTION-001)

**Location:** [editor.ts:204](src/editor.ts#L204), [editor.ts:374](src/editor.ts#L374), [capture-safety.ts:10](src/capture-safety.ts#L10).

**Evidence:** Redaction rectangles shared the ordinary color/opacity controls and `node.opacity(edit.opacity)` rendering path. Selecting a translucent saved swatch or reducing opacity exposed underlying pixels in both the preview and rasterized export.

**Impact:** Users could share sensitive information believing it had been redacted.

**Fix:** Force redaction opacity to 1 at both the editing and rendering boundaries; disable its opacity controls. Other annotations retain transparency. Tests cover transparent swatches and invalid opacity values. PNG/PDF exports continue to flatten the rendered canvas.

**Residual limit:** Redactions remain editable. Original screenshots remain locally stored until deleted; this is now explicit in the privacy policy. Cover the complete sensitive area and inspect the exported result.

## Medium severity — fixed

### 3. Image allocation limits ignored device-pixel scaling (RESOURCE-001)

**Location:** [background.ts:50](src/background.ts#L50), [editor.ts:565](src/editor.ts#L565), [capture-safety.ts:3](src/capture-safety.ts#L3).

**Evidence:** The worker checked CSS dimensions against 120 million pixels, while assembly later multiplied dimensions by `first.naturalWidth / capture.viewportWidth` with no allocation check. A 2× display can quadruple pixel count. Assembly also retrieved every base64 tile at once.

**Impact:** Large pages could cause excessive memory use, allocation failures, or an unresponsive editor.

**Fix:** Check device-pixel estimates during capture and actual rounded pixel dimensions before canvas creation and export. Reject non-finite, zero, negative, oversized dimensions and invalid tile counts. Load tiles sequentially, allow PNG data URLs only, and reject tile dimension changes. Limits are tested at and beyond their boundaries.

**Residual limit:** Valid images can still exceed available device memory. This is a bounded allocation policy, not a guarantee that every permitted image fits every browser.

### 4. Scroll-plan limits applied after allocation (RESOURCE-002)

**Location:** [page.ts:72](src/page.ts#L72), [background.ts:72](src/background.ts#L72).

**Evidence:** Both initial and dynamically growing plans appended all scroll positions before checking `positions.length > 300`.

**Impact:** Very large or growing documents could allocate and iterate over far more positions than the advertised safety limit.

**Fix:** Enforce the bound inside both loops. Tests exercise a pathological document height and restoration of scroll state after failure, plus normal overlapping scroll positions.

### 5. Failure and replacement paths left capture data behind (STORAGE-001)

**Location:** [background.ts:132](src/background.ts#L132), [background.ts:143](src/background.ts#L143).

**Evidence:** On editor-opening failure, the original catch removed tiles but left the already-written `capture:${id}` record. Recapture navigated the existing editor to a new ID without deleting its previous record or screenshot tiles.

**Impact:** Recapturing accumulated inaccessible screenshots, potentially containing sensitive information, and consumed persistent storage.

**Fix:** Remove the failed record as well as its tiles. Delete a replaced capture only after the replacement editor has opened successfully, checking source ownership and bounded tile count. Regression tests cover successful replacement and preservation of the prior capture on failure.

**Residual limit:** Worker termination/browser crashes can bypass cleanup. Existing orphaned captures were not deleted by this source change. See retained-data follow-up below.

## Low severity / reliability and hardening — fixed

### 6. Initialization failures and repeated requests could strand jobs (LIFECYCLE-001)

**Location:** [background.ts:103](src/background.ts#L103), [editor.ts:696](src/editor.ts#L696).

**Evidence:** Badge initialization originally ran before `try/finally`, after registering the job. A rejected badge call left a job in the map. Duplicate start requests canceled the existing job. Editor recapture awaited Chrome APIs without handling failures, leaving `busy` set.

**Fix:** Put initialization inside the cleanup boundary, make duplicate starts harmless, return a useful response for an already-running retry, and restore the editor after rejected requests. Discard also reports removal failures. Tests cover failed initialization followed by a successful new capture.

### 7. Privileged message and storage boundaries were implicit (JS-MSG-001 / JS-STORAGE-001)

**Location:** [background.ts:110](src/background.ts#L110), [background.ts:156](src/background.ts#L156), [capture-safety.ts:15](src/capture-safety.ts#L15).

**Evidence:** The original listener used a compile-time `CaptureMessage` annotation and ignored `_sender`; a retry supplied an arbitrary editor tab ID. Screenshot storage used the default access level.

**Fix:** Validate message shape and nonnegative safe-integer tab IDs. Accept requests only from the extension's exact popup/editor URL, and bind the retry destination to the actual sending editor tab. Restrict screenshot storage to `TRUSTED_CONTEXTS` before capture. Tests reject malformed commands, webpage senders and forged retry destinations.

**Exploitability note:** No external message handler, externally-connectable declaration, or page-message bridge was found. This is defense in depth against compromised extension/content-script contexts, not a demonstrated path for any webpage to issue commands. It does not protect against arbitrary code already executing in a privileged extension editor.

### 8. Export could use uncommitted or changing edits (EXPORT-001)

**Location:** [editor.ts:814](src/editor.ts#L814).

**Evidence:** Inline text commits were deferred after blur, while export could start immediately. PDF generation yields between pages, allowing subsequent edits to affect only later pages.

**Fix:** Commit active text before export, make the editor inert during export, suppress editing keyboard shortcuts while busy, and restore interaction in `finally`. The build type-checks these changes; browser interaction and exported pixels have not been tested end to end.

## Retained-data follow-up

Ordinary captures intentionally survive editor closure until Discard or uninstall, as documented in README. There is no history interface or automatic expiration. Crash-orphaned tiles can also remain. A future capture-history/expiration design should provide a way to review/delete old captures and recover interrupted jobs. This audit preserves the existing retention policy rather than silently expiring users' captures; PRIVACY.md now accurately describes persistence, replacement deletion, and unredacted originals.

## Validation and negative findings

- `npm test`: **27 tests passed across 6 files**, including 18 new regression tests.
- `npm run build`: TypeScript check, production Vite build and installable-manifest verification passed; updated output is in `dist/`.
- `git diff --check`: passed.
- `npm audit --json`: **0 known vulnerabilities** across the resolved dependency tree at audit time. This does not establish that dependencies are vulnerability-free.
- Inspected HTML construction: page titles and error messages use `textContent`; editable layer names are escaped. No confirmed DOM-XSS path was found through those inputs.
- Manifest retains scoped `activeTab` access without persistent host permissions. No remotely hosted script, telemetry request, external messaging bridge, or dynamic code evaluation was found in application source. The manifest uses Chrome's default MV3 extension-page CSP; no unsafe CSP override was added.
- Vite reports the existing >500 kB editor bundle warning. It is a performance follow-up, not a security failure.
- Automated lifecycle tests mock Chrome APIs. No live loaded-extension capture, real canvas redaction/PDF inspection, or Chrome service-worker termination test was performed. Manual scenarios are listed in README.
- The existing release ZIP was not regenerated; use `npm run package` before distributing a new ZIP.

## Platform references

The race assessment uses Chrome's documented active-tab semantics for [captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab). The storage restriction follows Chrome's documented [storage access levels](https://developer.chrome.com/docs/extensions/reference/api/storage). These references support the API behavior; findings themselves are based on the source and regression tests described above.
