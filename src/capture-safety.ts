export const MAX_TILES = 300;
export const MAX_IMAGE_EDGE = 30_000;
export const MAX_IMAGE_PIXELS = 120_000_000;

export function imageSegmentHeights(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0) || width > MAX_IMAGE_EDGE) {
    throw new Error('This page is too wide to capture safely. Try a smaller window.');
  }
  const maxHeight = Math.min(MAX_IMAGE_EDGE, Math.floor(MAX_IMAGE_PIXELS / Math.ceil(width)));
  if (maxHeight < 1) throw new Error('This page is too wide to capture safely. Try a smaller window.');
  const heights: number[] = [];
  for (let remaining = Math.ceil(height); remaining > 0; remaining -= maxHeight) heights.push(Math.min(maxHeight, remaining));
  return heights;
}

export function assertImageSize(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)
    || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('This page exceeds the single-image limit. Try a smaller window or page.');
  }
}

export function annotationOpacity(type: string, opacity: number) {
  // Redaction must never reveal underlying pixels, including during export.
  return type === 'redact' ? 1 : opacity;
}

export function isCaptureRequest(value: unknown): value is import('./types').CaptureRequest {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return ['start', 'status', 'stop', 'cancel', 'retry'].includes(message.type as string)
    && Number.isSafeInteger(message.sourceTabId) && (message.sourceTabId as number) >= 0
    && (message.type !== 'retry' || (Number.isSafeInteger(message.editorTabId) && (message.editorTabId as number) >= 0));
}
