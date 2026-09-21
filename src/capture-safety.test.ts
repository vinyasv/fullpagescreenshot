import { describe, expect, it } from 'vitest';
import { annotationOpacity, assertImageSize, imageSegmentHeights, isCaptureRequest } from './capture-safety';

describe('capture limits', () => {
  it('accepts the image boundary and rejects oversized high-DPI images', () => {
    expect(() => assertImageSize(4000, 30_000)).not.toThrow();
    expect(() => assertImageSize(4000 * 2, 30_000 * 2)).toThrow();
    expect(() => assertImageSize(20_000, 20_000)).toThrow();
  });
  it.each([NaN, Infinity, 0, -1])('rejects invalid dimensions: %s', value => {
    expect(() => assertImageSize(value, 100)).toThrow();
    expect(() => assertImageSize(100, value)).toThrow();
  });
});

describe('image segmentation', () => {
  it('keeps ordinary captures in one image', () => {
    expect(imageSegmentHeights(4000, 20_000)).toEqual([20_000]);
  });

  it('splits a long capture into the minimum safe number of images', () => {
    expect(imageSegmentHeights(4000, 35_000)).toEqual([30_000, 5_000]);
    expect(imageSegmentHeights(8000, 31_000)).toEqual([15_000, 15_000, 1_000]);
  });

  it('still rejects an image wider than the browser-safe edge', () => {
    expect(() => imageSegmentHeights(30_001, 1000)).toThrow('too wide');
  });
});

it('keeps redactions opaque even with a transparent saved color', () => {
  for (const opacity of [0, 0.25, 1, NaN]) expect(annotationOpacity('redact', opacity)).toBe(1);
  expect(annotationOpacity('rect', 0.25)).toBe(0.25);
});

it('rejects malformed commands at the runtime boundary', () => {
  for (const value of [null, undefined, {}, { type: 'start', sourceTabId: '1' },
    { type: 'start', sourceTabId: -1 }, { type: 'retry', sourceTabId: 1 },
    { type: 'progress', sourceTabId: 1 }]) expect(isCaptureRequest(value)).toBe(false);
  expect(isCaptureRequest({ type: 'retry', sourceTabId: 1, editorTabId: 2 })).toBe(true);
});
