// These functions are serialized by chrome.scripting.executeScript. Keep them self-contained.
type PageState = {
  scroller: Element | null;
  originalX: number;
  originalY: number;
  originalScrollTop: number;
  scrollBehavior: string;
  hidden: Array<{ element: HTMLElement; visibility: string }>;
};

declare global {
  interface Window { __pagecraftState?: PageState }
}

export function inspectPage() {
  const root = document.scrollingElement || document.documentElement;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.max(root.scrollWidth, document.body?.scrollWidth || 0, viewportWidth);
  const height = Math.max(root.scrollHeight, document.body?.scrollHeight || 0, viewportHeight);
  let inner: { left: number; top: number; width: number; height: number; scrollHeight: number } | undefined;
  if (height <= viewportHeight + 4) {
    let best = 0;
    for (const element of document.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.height < 100 || rect.width < 100 || rect.top >= viewportHeight || rect.bottom <= 0) continue;
      const style = getComputedStyle(element);
      if (!/(auto|scroll)/.test(style.overflowY)) continue;
      const excess = element.scrollHeight - element.clientHeight;
      if (excess > best && excess > 100) {
        best = excess;
        inner = {
          left: Math.max(0, rect.left), top: Math.max(0, rect.top),
          width: Math.min(rect.width, viewportWidth - Math.max(0, rect.left)),
          height: Math.min(rect.height, viewportHeight - Math.max(0, rect.top)),
          scrollHeight: element.scrollHeight,
        };
      }
    }
  }
  return { width, height, viewportWidth, viewportHeight, inner, pixelRatio: window.devicePixelRatio };
}

export function startScroll(measured: ReturnType<typeof inspectPage>): import('./types').ScrollPlan {
  const root = document.scrollingElement || document.documentElement;
  let scroller: Element | null = null;
  if (measured.inner) {
    let best = 0;
    for (const element of document.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      const excess = element.scrollHeight - element.clientHeight;
      if (Math.abs(rect.top - measured.inner.top) < 2 && excess > best && /(auto|scroll)/.test(getComputedStyle(element).overflowY)) {
        scroller = element;
        best = excess;
      }
    }
  }
  const target = scroller || root;
  const css = (target as HTMLElement).style;
  window.__pagecraftState = {
    scroller, originalX: window.scrollX, originalY: window.scrollY,
    originalScrollTop: scroller?.scrollTop || 0,
    scrollBehavior: css.scrollBehavior, hidden: [],
  };
  css.scrollBehavior = 'auto';
  const viewport = scroller ? measured.inner!.height : measured.viewportHeight;
  const content = scroller ? measured.inner!.scrollHeight : measured.height;
  const last = Math.max(0, Math.ceil(content - viewport));
  const stride = Math.max(1, Math.floor(viewport - Math.min(120, viewport / 5)));
  const positions: number[] = [0];
  for (let pos = stride; pos < last; pos += stride) {
    if (positions.length >= 300) throw new Error('This page is too long to capture safely.');
    positions.push(pos);
  }
  if (last > 0) positions.push(last);
  // Limit infinite-scroll and pathological documents to a finite capture.
  if (positions.length > 300) throw new Error('This page is too long to capture safely.');
  return {
    width: measured.viewportWidth,
    height: scroller ? Math.ceil(measured.inner!.top + measured.inner!.scrollHeight + measured.viewportHeight - (measured.inner!.top + measured.inner!.height)) : measured.height,
    viewportWidth: measured.viewportWidth, viewportHeight: measured.viewportHeight,
    positions, inner: scroller ? measured.inner : undefined,
  };
}

export function moveScroll(position: number, first: boolean): number {
  const state = window.__pagecraftState;
  if (!state) throw new Error('Capture state was lost.');
  if (!first && !state.scroller && !state.hidden.length) {
    for (const element of document.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(element);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10 || rect.top >= innerHeight || rect.bottom <= 0) continue;
      state.hidden.push({ element, visibility: element.style.visibility });
      element.style.visibility = 'hidden';
    }
  }
  if (state.scroller) {
    state.scroller.scrollTop = position;
    return state.scroller.scrollTop;
  }
  window.scrollTo(0, position);
  return window.scrollY;
}

export function finishScroll() {
  const state = window.__pagecraftState;
  if (!state) return;
  const target = (state.scroller || document.scrollingElement || document.documentElement) as HTMLElement;
  for (const item of state.hidden) item.element.style.visibility = item.visibility;
  if (state.scroller) state.scroller.scrollTop = state.originalScrollTop;
  window.scrollTo(state.originalX, state.originalY);
  target.style.scrollBehavior = state.scrollBehavior;
  delete window.__pagecraftState;
}
