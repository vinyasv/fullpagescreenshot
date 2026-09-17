export const MAX_TILES = 300;

export function assertImageSize(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)
    || width > 30_000 || height > 30_000 || width * height > 120_000_000) {
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
  return ['start', 'status', 'cancel', 'retry'].includes(message.type as string)
    && Number.isSafeInteger(message.sourceTabId) && (message.sourceTabId as number) >= 0
    && (message.type !== 'retry' || (Number.isSafeInteger(message.editorTabId) && (message.editorTabId as number) >= 0));
}
