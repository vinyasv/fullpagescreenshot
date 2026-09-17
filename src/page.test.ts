import { afterEach, expect, it, vi } from 'vitest';
import { finishScroll, startScroll } from './page';

afterEach(() => vi.unstubAllGlobals());

it('bounds pathological scroll plans and restores page state after failure', () => {
  const root = { style: { scrollBehavior: 'smooth' } };
  const scrollTo = vi.fn();
  vi.stubGlobal('document', { scrollingElement: root });
  vi.stubGlobal('window', { scrollX: 20, scrollY: 80, scrollTo });
  expect(() => startScroll({ width: 800, height: 1e12, viewportWidth: 800, viewportHeight: 600, pixelRatio: 1, inner: undefined })).toThrow('too long');
  finishScroll();
  expect(scrollTo).toHaveBeenCalledWith(20, 80);
  expect(root.style.scrollBehavior).toBe('smooth');
  expect(window.__pagecraftState).toBeUndefined();
});

it('plans overlapping tiles through the bottom of an ordinary page', () => {
  vi.stubGlobal('document', { scrollingElement: { style: { scrollBehavior: '' } } });
  vi.stubGlobal('window', { scrollX: 0, scrollY: 0 });
  expect(startScroll({ width: 800, height: 1700, viewportWidth: 800, viewportHeight: 600, pixelRatio: 1, inner: undefined }).positions)
    .toEqual([0, 480, 960, 1100]);
});
