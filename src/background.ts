import { finishScroll, inspectPage, moveScroll, readScrollExtent, startScroll } from './page';
import { reachedEnd } from './geometry';
import type { CaptureMessage, CaptureRecord, ScrollPlan } from './types';

type Job = { canceled: boolean; sourceTabId: number; percent: number };
const jobs = new Map<number, Job>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function progress(job: Job, percent: number, message: string) {
  job.percent = percent;
  await chrome.action.setBadgeText({ tabId: job.sourceTabId, text: `${percent}%` }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'progress', sourceTabId: job.sourceTabId, percent, message }).catch(() => {});
}

async function runInPage<T, A extends unknown[]>(tabId: number, func: (...args: A) => T, args: A): Promise<T> {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!results[0]) throw new Error('Unable to access this page.');
  return results[0].result as T;
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
    if (plan.width * plan.height > 120_000_000 || plan.width > 30_000 || plan.height > 30_000) {
      throw new Error('This page exceeds the single-image limit. Try a smaller window or page.');
    }
    for (let index = 0; index < plan.positions.length; index++) {
      const position = plan.positions[index];
      assertActive(job);
      const active = await chrome.tabs.query({ active: true, windowId: (await chrome.tabs.get(tabId)).windowId });
      if (active[0]?.id !== tabId) throw new Error('The source tab lost focus during capture.');
      const actual = await runInPage(tabId, moveScroll, [position, index === 0]);
      if (index > 0 && actual <= actualPositions[index - 1]) throw new Error('The page did not move during capture.');
      actualPositions.push(actual);
      await sleep(index === 0 ? 250 : 540);
      assertActive(job);
      const dataUrl = await chrome.tabs.captureVisibleTab((await chrome.tabs.get(tabId)).windowId, { format: 'png' });
      await chrome.storage.local.set({ [`tile:${id}:${index}`]: dataUrl });
      count++;
      if (index === plan.positions.length - 1) {
        const extent = await runInPage(tabId, readScrollExtent, []);
        const previous = plan.inner ? plan.inner.scrollHeight : plan.height;
        if (extent > previous + 8) {
          const viewport = plan.inner ? plan.inner.height : plan.viewportHeight;
          const stride = Math.max(1, Math.floor(viewport - Math.min(120, viewport / 5)));
          const last = Math.max(0, Math.ceil(extent - viewport));
          const oldLast = plan.positions.at(-1)!;
          for (let pos = oldLast + stride; pos < last; pos += stride) plan.positions.push(pos);
          if (last > oldLast) plan.positions.push(last);
          if (plan.positions.length > 300) throw new Error('The page keeps growing during capture.');
          if (plan.inner) {
            plan.height += extent - plan.inner.scrollHeight;
            plan.inner.scrollHeight = extent;
          } else plan.height = extent;
          if (plan.width * plan.height > 120_000_000 || plan.height > 30_000) throw new Error('This page grew beyond the single-image limit.');
        }
      }
      await progress(job, Math.round(count / plan.positions.length * 100), `Scrolling page · ${count} of ${plan.positions.length}`);
    }
    const viewport = plan.inner ? plan.inner.height : plan.viewportHeight;
    const extent = plan.inner ? plan.inner.scrollHeight : plan.height;
    if (!reachedEnd(actualPositions.at(-1)!, viewport, extent)) throw new Error('The capture did not reach the bottom of the page.');
    return { plan, count, actualPositions };
  } catch (error) {
    await removeTiles(id, count);
    throw error;
  } finally {
    await runInPage(tabId, finishScroll, []).catch(() => {});
  }
}

async function removeTiles(id: string, count: number) {
  if (count) await chrome.storage.local.remove(Array.from({ length: count }, (_, i) => `tile:${id}:${i}`));
}

async function capture(sourceTabId: number, editorTabId?: number) {
  if (jobs.has(sourceTabId)) { jobs.get(sourceTabId)!.canceled = true; return; }
  const job: Job = { canceled: false, sourceTabId, percent: 0 };
  jobs.set(sourceTabId, job);
  const id = crypto.randomUUID();
  let stored = 0;
  await chrome.action.setBadgeBackgroundColor({ tabId: sourceTabId, color: '#302e29' });
  await chrome.action.setBadgeText({ tabId: sourceTabId, text: '…' });
  try {
    const tab = await chrome.tabs.get(sourceTabId);
    if (!tab.url || !/^(https?:|file:)/.test(tab.url)) throw new Error('Chrome does not allow capture of this browser page.');
    if (editorTabId) await chrome.tabs.update(sourceTabId, { active: true });
    const measured = await runInPage(sourceTabId, inspectPage, []);
    await progress(job, 0, 'Scrolling page…');
    const result = await scrollCapture(sourceTabId, id, job, measured);
    stored = result.count;
    assertActive(job);
    const record: CaptureRecord = {
      id, sourceTabId, title: tab.title || 'Untitled page', mode: 'scroll', width: result.plan.width, height: result.plan.height,
      viewportWidth: measured.viewportWidth, viewportHeight: measured.viewportHeight,
      positions: result.actualPositions, inner: result.plan.inner, count: stored, createdAt: Date.now(),
    };
    await chrome.storage.local.set({ [`capture:${id}`]: record });
    await progress(job, 100, 'Opening editor…');
    const url = chrome.runtime.getURL(`editor.html?id=${encodeURIComponent(id)}`);
    if (editorTabId) await chrome.tabs.update(editorTabId, { url, active: true });
    else await chrome.tabs.create({ url, active: true });
  } catch (error) {
    await removeTiles(id, stored);
    const message = error instanceof Error ? error.message : String(error);
    console.error('Capture failed:', message);
    await chrome.action.setBadgeText({ tabId: sourceTabId, text: 'ERR' }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'progress', sourceTabId, percent: job.percent, message }).catch(() => {});
    if (editorTabId) chrome.runtime.sendMessage({ type: 'capture-error', sourceTabId, message }).catch(() => {});
    else await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?error=${encodeURIComponent(message)}`) }).catch(() => {});
  } finally {
    jobs.delete(sourceTabId);
    setTimeout(() => chrome.action.setBadgeText({ tabId: sourceTabId, text: '' }).catch(() => {}), 5000);
  }
}

chrome.runtime.onMessage.addListener((message: CaptureMessage, _sender, sendResponse) => {
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
  if (message.type === 'retry') {
    void capture(message.sourceTabId, message.editorTabId);
    sendResponse({ ok: true });
  }
});
