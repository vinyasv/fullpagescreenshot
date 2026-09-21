import { finishScroll, inspectPage, moveScroll, startScroll } from './page';
import { reachedEnd } from './geometry';
import type { CaptureRecord, ScrollPlan } from './types';
import { imageSegmentHeights, isCaptureRequest } from './capture-safety';
import { deleteCapture, readCaptureRecord, saveCaptureRecord, saveCaptureTile } from './capture-store';

type Job = { canceled: boolean; stopping: boolean; sourceTabId: number; percent: number; windowId?: number; documentId?: string };
const jobs = new Map<number, Job>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function progress(job: Job, percent: number, message: string) {
  job.percent = percent;
  await chrome.action.setBadgeText({ tabId: job.sourceTabId, text: `${percent}%` }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'progress', sourceTabId: job.sourceTabId, percent, message }).catch(() => {});
}

async function runInPage<T, A extends unknown[]>(tabId: number, func: (...args: A) => T, args: A): Promise<T> {
  const job = jobs.get(tabId);
  const results = await chrome.scripting.executeScript({ target: { tabId, ...(job?.documentId ? { documentIds: [job.documentId] } : {}) }, func, args });
  if (!results[0] || results[0].result === undefined && func !== finishScroll) throw new Error('Unable to access this page.');
  if (job && !job.documentId) job.documentId = results[0].documentId;
  return results[0].result as T;
}

// Keep a tab switch/navigation latched even when the user switches back quickly.
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  for (const job of jobs.values()) if (job.windowId === windowId && job.sourceTabId !== tabId) job.canceled = true;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') { const job = jobs.get(tabId); if (job) job.canceled = true; }
});
chrome.tabs.onRemoved.addListener(tabId => { const job = jobs.get(tabId); if (job) job.canceled = true; });

async function assertSourceActive(job: Job) {
  assertActive(job);
  const tab = await chrome.tabs.get(job.sourceTabId);
  if (!tab.active || tab.windowId !== job.windowId) throw new Error('The source tab lost focus during capture.');
  assertActive(job);
}

function assertActive(job: Job) {
  if (job.canceled) throw new Error('Capture canceled.');
}

async function scrollCapture(tabId: number, id: string, job: Job, measured: ReturnType<typeof inspectPage>) {
  let plan: ScrollPlan | undefined;
  let count = 0;
  const actualPositions: number[] = [];
  try {
    plan = await runInPage(tabId, startScroll, [measured]);
    imageSegmentHeights(plan.width * measured.pixelRatio, plan.height * measured.pixelRatio);
    for (let index = 0; index < plan.positions.length; index++) {
      if (job.stopping && count > 0) break;
      const position = plan.positions[index];
      await assertSourceActive(job);
      const actual = await runInPage(tabId, moveScroll, [position, index === 0]);
      if (index > 0 && actual <= actualPositions[index - 1]) throw new Error('The page did not move during capture.');
      actualPositions.push(actual);
      await sleep(index === 0 ? 250 : 540);
      await assertSourceActive(job);
      const dataUrl = await chrome.tabs.captureVisibleTab(job.windowId!, { format: 'png' });
      // captureVisibleTab targets a window's active tab, not a particular tab ID.
      await assertSourceActive(job);
      await saveCaptureTile(id, index, dataUrl);
      count++;
      await progress(job, Math.round(count / plan.positions.length * 100), `Scrolling page · ${count} of ${plan.positions.length}`);
      if (job.stopping) break;
    }
    const viewport = plan.inner ? plan.inner.height : plan.viewportHeight;
    const extent = plan.inner ? plan.inner.scrollHeight : plan.height;
    if (job.stopping) {
      const capturedExtent = Math.min(extent, Math.ceil(actualPositions.at(-1)! + viewport));
      if (plan.inner) {
        plan.height -= plan.inner.scrollHeight - capturedExtent;
        plan.inner.scrollHeight = capturedExtent;
      } else plan.height = capturedExtent;
      plan.positions = plan.positions.slice(0, count);
    } else if (!reachedEnd(actualPositions.at(-1)!, viewport, extent)) {
      throw new Error('The capture did not reach the bottom of the page.');
    }
    return { plan, count, actualPositions };
  } catch (error) {
    await removeTiles(id, count);
    throw error;
  } finally {
    await runInPage(tabId, finishScroll, []).catch(() => {});
  }
}

async function removeTiles(id: string, count: number) {
  if (count) await deleteCapture(id, count);
}

async function capture(sourceTabId: number, editorTabId?: number, previousId?: string | null) {
  if (jobs.has(sourceTabId)) return;
  const job: Job = { canceled: false, stopping: false, sourceTabId, percent: 0 };
  jobs.set(sourceTabId, job);
  const id = crypto.randomUUID();
  let stored = 0;
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId: sourceTabId, color: '#302e29' });
    await chrome.action.setBadgeText({ tabId: sourceTabId, text: '…' });
    const tab = await chrome.tabs.get(sourceTabId);
    job.windowId = tab.windowId;
    if (!tab.url || !/^(https?:|file:)/.test(tab.url)) throw new Error('Chrome does not allow capture of this browser page.');
    if (editorTabId) await chrome.tabs.update(sourceTabId, { active: true });
    const measured = await runInPage(sourceTabId, inspectPage, []);
    await progress(job, 0, 'Scrolling page…');
    const result = await scrollCapture(sourceTabId, id, job, measured);
    stored = result.count;
    assertActive(job);
    const record: CaptureRecord = {
      id, sourceTabId, mode: 'scroll', width: result.plan.width, height: result.plan.height,
      viewportWidth: measured.viewportWidth, viewportHeight: measured.viewportHeight,
      positions: result.actualPositions, inner: result.plan.inner, count: stored,
    };
    await saveCaptureRecord(record);
    await progress(job, 100, 'Opening editor…');
    assertActive(job);
    const url = chrome.runtime.getURL(`editor.html?id=${encodeURIComponent(id)}`);
    if (editorTabId) await chrome.tabs.update(editorTabId, { url, active: true });
    else await chrome.tabs.create({ url, active: true });
    // Retire the replaced capture only after its replacement opened successfully.
    if (previousId && previousId !== id) {
      try {
        const previous = await readCaptureRecord(previousId);
        if (previous?.sourceTabId === sourceTabId && Number.isSafeInteger(previous.count) && previous.count >= 0 && previous.count <= 300) {
          await deleteCapture(previousId, previous.count);
        }
      } catch (error) { console.error('Could not remove the replaced capture:', error); }
    }
  } catch (error) {
    await deleteCapture(id, stored).catch(console.error);
    const message = error instanceof Error ? error.message : String(error);
    console.error('Capture failed:', message);
    await chrome.action.setBadgeText({ tabId: sourceTabId, text: job.canceled ? '' : 'ERR' }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'capture-error', sourceTabId, message, canceled: job.canceled }).catch(() => {});
  } finally {
    jobs.delete(sourceTabId);
    setTimeout(() => chrome.action.setBadgeText({ tabId: sourceTabId, text: '' }).catch(() => {}), 5000);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isCaptureRequest(message) || sender.id !== chrome.runtime.id || !sender.url) return;
  const senderUrl = new URL(sender.url);
  const allowedPage = message.type === 'retry' ? 'editor.html' : 'progress.html';
  if (senderUrl.protocol !== 'chrome-extension:' || senderUrl.host !== chrome.runtime.id
    || senderUrl.pathname !== `/${allowedPage}`
    || (message.type === 'retry' && sender.tab?.id !== message.editorTabId)) return;
  if (message.type === 'status') {
    const job = jobs.get(message.sourceTabId);
    sendResponse({ active: !!job, percent: job?.percent || 0 });
  }
  if (message.type === 'start') {
    void capture(message.sourceTabId);
    sendResponse({ ok: true });
  }
  if (message.type === 'cancel') {
    const job = jobs.get(message.sourceTabId);
    if (job) job.canceled = true;
    sendResponse({ ok: !!job });
  }
  if (message.type === 'stop') {
    const job = jobs.get(message.sourceTabId);
    if (job) job.stopping = true;
    sendResponse({ ok: !!job });
  }
  if (message.type === 'retry') {
    if (jobs.has(message.sourceTabId)) { sendResponse({ ok: false, message: 'A capture is already running for this page.' }); return; }
    void capture(message.sourceTabId, message.editorTabId, senderUrl.searchParams.get('id'));
    sendResponse({ ok: true });
  }
});
