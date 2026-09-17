import { describe, expect, it } from 'vitest';
import { visibleViewport, viewportLayout } from './editor-viewport';

const full = { x: 0, y: 0, width: 1200, height: 800 };
const crop = { x: 100, y: 60, width: 500, height: 300 };

describe('editor crop viewport', () => {
  it('shows the full image while a crop is being edited', () => {
    expect(visibleViewport(full, crop, true)).toEqual(full);
    expect(visibleViewport(full, null, false)).toEqual(full);
  });

  it('shows only the cropped result after editing', () => {
    expect(visibleViewport(full, crop, false)).toEqual(crop);
    expect(viewportLayout(crop, 1.5)).toEqual({ width: 750, height: 450, offsetX: -150, offsetY: -90 });
  });
});
