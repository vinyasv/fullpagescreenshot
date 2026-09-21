import './progress.css';

const message = document.querySelector<HTMLElement>('#message')!;
const bar = document.querySelector<HTMLElement>('#bar')!;
const percent = document.querySelector<HTMLElement>('#percent')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const track = document.querySelector<HTMLElement>('[role="progressbar"]')!;
let sourceTabId: number | undefined;
let stopping = false;

function update(value: number, label: string) {
  const progress = Math.max(0, Math.min(100, value));
  bar.style.width = `${progress}%`;
  percent.textContent = `${progress}%`;
  message.textContent = label;
  track.setAttribute('aria-valuenow', String(progress));
}

chrome.runtime.onMessage.addListener(event => {
  if (event.type === 'progress' && event.sourceTabId === sourceTabId) {
    update(event.percent, stopping ? 'Finishing screenshot…' : event.message);
  }
  if (event.type === 'capture-error' && event.sourceTabId === sourceTabId) {
    if (event.canceled) { window.close(); return; }
    stopping = false;
    update(0, event.message);
    stop.hidden = cancel.hidden = true;
  }
});

stop.onclick = async () => {
  if (!sourceTabId) return;
  stopping = true;
  stop.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'stop', sourceTabId });
    message.textContent = 'Finishing screenshot…';
  } catch (error) {
    stopping = false;
    stop.disabled = false;
    message.textContent = error instanceof Error ? error.message : 'Could not stop capture.';
  }
};

cancel.onclick = async () => {
  if (!sourceTabId) return;
  stop.disabled = true;
  cancel.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'cancel', sourceTabId });
    window.close();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Could not cancel capture.';
  }
};

async function start() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { update(0, 'Open a webpage to capture.'); stop.hidden = cancel.hidden = true; return; }
  if (!tab.url || !/^(https?:|file:)/.test(tab.url)) { update(0, 'This browser page cannot be captured.'); stop.hidden = cancel.hidden = true; return; }
  sourceTabId = tab.id;
  const state = await chrome.runtime.sendMessage({ type: 'status', sourceTabId });
  if (state.active) update(state.percent, `Scrolling page · ${state.percent}%`);
  else await chrome.runtime.sendMessage({ type: 'start', sourceTabId });
}

start().catch(error => { update(0, error instanceof Error ? error.message : 'Capture could not start.'); stop.hidden = cancel.hidden = true; });
