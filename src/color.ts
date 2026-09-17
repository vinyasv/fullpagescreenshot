export type RGB = { r: number; g: number; b: number };
export type HSV = { h: number; s: number; v: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function hexToRgb(hex: string): RGB | null {
  const value = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map(channel => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const [red, green, blue] = [r, g, b].map(channel => clamp(channel, 0, 255) / 255);
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min;
  let h = 0;
  if (delta) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? delta / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1); v = clamp(v, 0, 1);
  const chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = v - chroma;
  const sectors = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const [r, g, b] = sectors[Math.floor(h / 60)];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
