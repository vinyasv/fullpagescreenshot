import './progress.css';

const message = document.querySelector<HTMLElement>('#message')!;
const bar = document.querySelector<HTMLElement>('#bar')!;
const percent = document.querySelector<HTMLElement>('#percent')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const track = document.querySelector<HTMLElement>('[role="progressbar"]')!;
let sourceTabId: number | undefined;

function update(value: number, label: string) {
  const progress = Math.max(0, Math.min(100, value));
  bar.style.width = `${progress}%`;
  percent.textContent = `${progress}%`;
  message.textContent = label;
  track.setAttribute('aria-valuenow', String(progress));
}

chrome.runtime.onMessage.addListener(event => {
  if (event.type === 'progress' && event.sourceTabId === sourceTabId) update(event.percent, event.message);
});

cancel.onclick = async () => {
  if (!sourceTabId) return;
  await chrome.runtime.sendMessage({ type: 'cancel', sourceTabId });
  update(0, 'Stopping capture…');
  cancel.disabled = true;
};

async function start() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { update(0, 'Open a webpage to capture.'); cancel.hidden = true; return; }
  if (!tab.url || !/^(https?:|file:)/.test(tab.url)) { update(0, 'This browser page cannot be captured.'); cancel.hidden = true; return; }
  sourceTabId = tab.id;
  const state = await chrome.runtime.sendMessage({ type: 'status', sourceTabId });
  if (state.active) update(state.percent, `Scrolling page · ${state.percent}%`);
  else await chrome.runtime.sendMessage({ type: 'start', sourceTabId });
}

start().catch(error => { update(0, error instanceof Error ? error.message : 'Capture could not start.'); cancel.hidden = true; });
