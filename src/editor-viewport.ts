export type ViewportBox = { x: number; y: number; width: number; height: number };

export function visibleViewport(full: ViewportBox, crop: ViewportBox | null, editingCrop: boolean): ViewportBox {
  return crop && !editingCrop ? crop : full;
}

export function viewportLayout(box: ViewportBox, zoom: number) {
  return {
    width: box.width * zoom,
    height: box.height * zoom,
    offsetX: -box.x * zoom,
    offsetY: -box.y * zoom,
  };
}
