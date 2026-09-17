/** Portion of a viewport tile that has not already been included. */
export function uncoveredSlice(covered: number, position: number, viewport: number, content: number) {
  const start = Math.max(covered, position);
  const end = Math.min(content, position + viewport);
  return {
    sourceOffset: start - position,
    destination: start,
    length: Math.max(0, end - start),
    covered: Math.max(covered, end),
  };
}

export function reachedEnd(lastPosition: number, viewport: number, content: number) {
  return lastPosition + viewport >= content - 2;
}
