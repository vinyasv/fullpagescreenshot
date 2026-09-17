import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let listener: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => void;
let activated: (info: { tabId: number; windowId: number }) => void;
let updated: (tabId: number, change: { status: string }) => void;
const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/progress.html' };
const plan = { width: 800, height: 600, viewportWidth: 800, viewportHeight: 600, positions: [0], pixelRatio: 1 };
let api: ReturnType<typeof makeApi>;

function makeApi() {
  return {
    runtime: { id: sender.id, getURL: (path: string) => `chrome-extension://${sender.id}/${path}`,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: { addListener: vi.fn(callback => { listener = callback; }) } },
    action: { setBadgeText: vi.fn().mockResolvedValue(undefined), setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined) },
    storage: { local: { get: vi.fn().mockResolvedValue({}), setAccessLevel: vi.fn().mockResolvedValue(undefined), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } },
    tabs: {
      get: vi.fn().mockResolvedValue({ id: 1, windowId: 5, active: true, url: 'https://example.com', title: 'Example' }),
      create: vi.fn().mockResolvedValue({ id: 2 }), update: vi.fn().mockResolvedValue(undefined),
      captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,test'),
      onActivated: { addListener: vi.fn(callback => { activated = callback; }) },
      onUpdated: { addListener: vi.fn(callback => { updated = callback; }) },
      onRemoved: { addListener: vi.fn() },
    },
    scripting: { executeScript: vi.fn(async ({ func, args }: { func: (...args: never[]) => unknown; args: unknown[] }) => {
      const result = func.name === 'inspectPage' || func.name === 'startScroll' ? { ...plan, positions: [...plan.positions] }
        : func.name === 'moveScroll' ? args[0] : func.name === 'readScrollExtent' ? 600 : undefined;
      return [{ result, documentId: 'source-document' }];
    }) },
  };
}

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api = makeApi(); vi.stubGlobal('chrome', api);
  await import('./background');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function send(message: unknown, from = sender) {
  const respond = vi.fn(); listener(message, from, respond); return respond;
}
async function start() {
  send({ type: 'start', sourceTabId: 1 });
  await vi.advanceTimersByTimeAsync(0);
}

it('captures the authorized document and restricts stored screenshots', async () => {
  await start(); await vi.advanceTimersByTimeAsync(1000);
  expect(api.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  expect(api.tabs.captureVisibleTab).toHaveBeenCalledWith(5, { format: 'png' });
  expect(api.scripting.executeScript.mock.calls.slice(1).every(([call]) =>
    (call as unknown as { target: { documentIds: string[] } }).target.documentIds[0] === 'source-document')).toBe(true);
  expect(api.tabs.create.mock.calls[0][0].url).toContain('editor.html?id=');
  expect(send({ type: 'status', sourceTabId: 1 })).toHaveBeenCalledWith({ active: false, percent: 0 });
});

it('does not capture after a switch away and back during the render delay', async () => {
  await start(); activated({ tabId: 2, windowId: 5 }); activated({ tabId: 1, windowId: 5 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(api.storage.local.set).not.toHaveBeenCalled();
  expect(api.scripting.executeScript.mock.calls.some(([call]) => call.func.name === 'finishScroll')).toBe(true);
});

it('discards an image if the tab switches while captureVisibleTab is pending', async () => {
  api.tabs.captureVisibleTab.mockImplementation(async () => { activated({ tabId: 2, windowId: 5 }); return 'wrong-tab'; });
  await start(); await vi.advanceTimersByTimeAsync(1000);
  expect(api.tabs.captureVisibleTab).toHaveBeenCalled();
  expect(api.storage.local.set).not.toHaveBeenCalled();
});

it('cancels a capture when the source navigates', async () => {
  await start(); updated(1, { status: 'loading' });
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.tabs.captureVisibleTab).not.toHaveBeenCalled();
});

it('removes both the record and tiles if opening the editor fails', async () => {
  api.tabs.create.mockRejectedValueOnce(new Error('Tab closed'));
  await start(); await vi.advanceTimersByTimeAsync(1000);
  const keys = api.storage.local.remove.mock.calls.at(-1)![0] as string[];
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^capture:/); expect(keys[1]).toMatch(/^tile:/);
});

it('releases the job when badge initialization fails', async () => {
  api.action.setBadgeBackgroundColor.mockRejectedValueOnce(new Error('Tab closed'));
  await start();
  expect(send({ type: 'status', sourceTabId: 1 })).toHaveBeenCalledWith({ active: false, percent: 0 });
  await start(); await vi.advanceTimersByTimeAsync(1000);
  expect(api.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
});

it('deletes the replaced capture only after a successful recapture', async () => {
  api.storage.local.get.mockResolvedValue({ 'capture:old': { sourceTabId: 1, count: 2 } });
  listener({ type: 'retry', sourceTabId: 1, editorTabId: 2 }, { ...sender, url: 'chrome-extension://test-extension/editor.html?id=old', tab: { id: 2 } as chrome.tabs.Tab }, vi.fn());
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.storage.local.remove).toHaveBeenCalledWith(['capture:old', 'tile:old:0', 'tile:old:1']);
  expect(api.tabs.update.mock.invocationCallOrder.at(-1)).toBeLessThan(api.storage.local.remove.mock.invocationCallOrder[0]);
});

it('preserves the previous capture when recapture fails', async () => {
  api.tabs.captureVisibleTab.mockRejectedValueOnce(new Error('Capture failed'));
  listener({ type: 'retry', sourceTabId: 1, editorTabId: 2 }, { ...sender, url: 'chrome-extension://test-extension/editor.html?id=old', tab: { id: 2 } as chrome.tabs.Tab }, vi.fn());
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.storage.local.get).not.toHaveBeenCalled();
  expect(api.storage.local.remove.mock.calls.flat(2)).not.toContain('capture:old');
});

it('rejects malformed messages, content scripts and a forged retry destination', async () => {
  send(null);
  send({ type: 'start', sourceTabId: 1 }, { ...sender, url: 'https://example.com/progress.html' });
  listener({ type: 'retry', sourceTabId: 1, editorTabId: 99 }, { ...sender, url: 'chrome-extension://test-extension/editor.html', tab: { id: 2 } as chrome.tabs.Tab }, vi.fn());
  await vi.advanceTimersByTimeAsync(1000);
  expect(api.tabs.get).not.toHaveBeenCalled();
});
