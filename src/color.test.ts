import { describe, expect, it } from 'vitest';
import { clamp, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './color';

describe('color conversion', () => {
  it('validates hex and rounds bounded channels', () => {
    expect(hexToRgb('#A0b1C2')).toEqual({ r: 160, g: 177, b: 194 });
    expect(hexToRgb('#123')).toBeNull();
    expect(rgbToHex({ r: 300, g: -1, b: 127.6 })).toBe('#ff0080');
    expect(clamp(NaN, 0, 1)).toBe(0);
  });
  it('round-trips colors through HSV', () => {
    for (const hex of ['#e56142', '#ffffff', '#000000', '#4582dc', '#19ac64']) {
      expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex)!)))).toBe(hex);
    }
  });
});
