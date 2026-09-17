import { describe, expect, it } from 'vitest';
import { reachedEnd, uncoveredSlice } from './geometry';

describe('viewport overlap', () => {
  it('starts after the pixels already captured', () => {
    expect(uncoveredSlice(800, 680, 800, 2000)).toEqual({ sourceOffset: 120, destination: 800, length: 680, covered: 1480 });
  });

  it('clips the final tile to the content boundary', () => {
    expect(uncoveredSlice(1480, 1200, 800, 1740)).toEqual({ sourceOffset: 280, destination: 1480, length: 260, covered: 1740 });
  });

  it('does not duplicate a tile when the page fails to move', () => {
    expect(uncoveredSlice(800, 0, 800, 2000).length).toBe(0);
  });
});

describe('scroll coverage', () => {
  it('accepts a complete page, including a short page', () => {
    expect(reachedEnd(1200, 800, 2000)).toBe(true);
    expect(reachedEnd(0, 800, 600)).toBe(true);
  });

  it('rejects an image when the page stopped scrolling early', () => {
    expect(reachedEnd(680, 800, 2000)).toBe(false);
  });
});
