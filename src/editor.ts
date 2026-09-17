import Konva from 'konva';
import { jsPDF } from 'jspdf';
import type { CaptureRecord } from './types';
import { uncoveredSlice } from './geometry';
import { clamp, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type HSV } from './color';
import { visibleViewport, viewportLayout, type ViewportBox } from './editor-viewport';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import './editor.css';
import caretIcon from '../Arrow/Caret_Down_MD.svg?url';
import undoIcon from '../Edit/Undo.svg?url';
import redoIcon from '../Edit/Redo.svg?url';
import selectIcon from '../default/Navigation/Navigation.svg?url';
import rectIcon from '../default/Interface/Dummy_Square.svg?url';
import arrowIcon from '../default/Arrow/Arrow_Up_Right_MD.svg?url';
import circleIcon from '../default/Interface/Dummy_Circle.svg?url';
import penIcon from '../default/Edit/Edit_Pencil_02.svg?url';
import textIcon from '../default/Edit/Text.svg?url';
import cropIcon from '../default/Edit/Crop.svg?url';
import redactIcon from '../default/Dummy_Square.svg?url';

type Tool = 'select' | 'crop' | 'pen' | 'arrow' | 'rect' | 'circle' | 'text' | 'redact';
const toolIcons: Record<Tool, string> = {
  select: selectIcon, rect: rectIcon, arrow: arrowIcon,
  circle: circleIcon, pen: penIcon, text: textIcon,
  crop: cropIcon, redact: redactIcon,
};
const DEFAULT_STROKE_WIDTH = 2;
type Box = ViewportBox;
type EditBase = { id: string; name: string; color: string; opacity: number };
type ShapeEdit<T extends 'rect' | 'circle'> = EditBase & { type: T; box: Box; strokeWidth: number; filled: boolean; cornerRadius?: number };
type Edit =
  | (EditBase & { type: 'crop'; box: Box })
  | (EditBase & { type: 'pen'; points: number[]; strokeWidth: number })
  | (EditBase & { type: 'arrow'; points: number[]; strokeWidth: number })
  | ShapeEdit<'rect'>
  | ShapeEdit<'circle'>
  | (EditBase & { type: 'redact'; box: Box })
  | (EditBase & { type: 'text'; x: number; y: number; width: number; text: string; fontSize: number; bold: boolean; fontFamily?: string });
const colors = ['#e56142', '#2563eb', '#16a34a', '#eab308', '#151515', '#ffffff'];
const fontFamilies = ['Inter', 'Arial', 'Georgia', 'Courier New'] as const;
type SavedColor = { color: string; opacity: number };
const savedColors: SavedColor[] = colors.map(color => ({ color, opacity: 1 }));

const app = document.querySelector<HTMLDivElement>('#app')!;
const id = new URLSearchParams(location.search).get('id');
let record: CaptureRecord;
let stage: Konva.Stage;
let art: Konva.Layer;
let overlay: Konva.Layer;
let baseImage: HTMLImageElement;
let scale = 1;
let tool: Tool = 'select';
let edits: Edit[] = [];
let undoStack: Edit[][] = [];
let redoStack: Edit[][] = [];
let selectedId: string | null = null;
let activeColor = colors[0];
let draft: Konva.Shape | null = null;
let start = { x: 0, y: 0 };
let penPoints: number[] = [];
let busy = false;
let transformer: Konva.Transformer;
let baseNode: Konva.Image;
let viewZoom = 1;
let zoomIsFit = true;
let draggedLayerId: string | null = null;
let pickerId: string | null = null;
let pickerGestureActive = false;
let pickerHue = 0;
let textEditor: HTMLTextAreaElement | null = null;
let textEditorId: string | null = null;
let finishTextEditor: ((save: boolean) => void) | null = null;

function el<T extends Element>(selector: string): T { return document.querySelector<T>(selector)!; }
function status(message: string) { el<HTMLElement>('#status').textContent = message; }
function boxFrom(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
function clampCrop(box: Box): Box {
  const x = Math.max(0, Math.min(stage.width() - 20, box.x));
  const y = Math.max(0, Math.min(stage.height() - 20, box.y));
  return { x, y, width: Math.max(20, Math.min(box.width, stage.width() - x)), height: Math.max(20, Math.min(box.height, stage.height() - y)) };
}
function point() { return stage.getPointerPosition() || { x: 0, y: 0 }; }
function fullBox(): Box { return { x: 0, y: 0, width: stage.width(), height: stage.height() }; }
function cropBox(): Box { return [...edits].reverse().find(e => e.type === 'crop')?.box || fullBox(); }
function editorViewport(): Box {
  const crop = [...edits].reverse().find(edit => edit.type === 'crop');
  return visibleViewport(fullBox(), crop?.type === 'crop' ? crop.box : null, crop?.id === selectedId);
}

function commit(change: () => void) {
  undoStack.push(structuredClone(edits));
  redoStack = [];
  change();
  drawEdits();
}

function selectedEdit() { return edits.find(edit => edit.id === selectedId); }

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function updateSelected(id: string, change: (edit: Edit) => void) {
  commit(() => { const edit = edits.find(item => item.id === id); if (edit) change(edit); });
}

function renderLayers() {
  const list = el<HTMLElement>('#layer-list');
  const crop = edits.find(edit => edit.type === 'crop');
  const annotations = edits.filter(edit => edit.type !== 'crop');
  list.innerHTML = `${crop ? `<button class="layer-row crop-row ${selectedId === crop.id ? 'active' : ''}" data-layer="${crop.id}"><img class="layer-icon" src="${cropIcon}" alt=""><span class="layer-name">${escapeHtml(crop.name)}</span></button>` : ''}
    ${[...annotations].reverse().map(edit => `<div class="layer-row ${selectedId === edit.id ? 'active' : ''}" data-layer="${edit.id}" draggable="true"><img class="layer-icon" src="${toolIcons[edit.type]}" alt=""><button class="layer-select" title="Select ${escapeHtml(edit.name)}">${escapeHtml(edit.name)}</button></div>`).join('')}
    <div class="layer-row base-row ${annotations.length ? 'with-annotations' : ''}"><span class="layer-icon">▣</span><span class="layer-name">Screenshot</span><span class="locked" title="Fixed base layer">⌁</span></div>`;
  list.querySelectorAll<HTMLElement>('[data-layer]').forEach(row => {
    const id = row.dataset.layer!;
    row.querySelector('.layer-select')?.addEventListener('click', () => select(id));
    if (edits.find(edit => edit.id === id)?.type === 'text') row.addEventListener('dblclick', () => beginTextEdit(id));
    if (row.classList.contains('crop-row')) row.addEventListener('click', () => select(id));
    if (!row.classList.contains('crop-row')) {
      row.addEventListener('dragstart', event => { draggedLayerId = id; event.dataTransfer?.setData('text/plain', id); });
      row.addEventListener('dragover', event => { if (draggedLayerId && draggedLayerId !== id) { event.preventDefault(); row.classList.add('drop-target'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', event => { event.preventDefault(); row.classList.remove('drop-target'); if (draggedLayerId) reorderLayer(draggedLayerId, id); draggedLayerId = null; });
      row.addEventListener('dragend', () => { draggedLayerId = null; row.classList.remove('drop-target'); });
    }
  });
}

function reorderLayer(id: string, targetId: string, after = false) {
  if (id === targetId) return;
  commit(() => {
    const from = edits.findIndex(edit => edit.id === id);
    if (from < 0 || edits[from].type === 'crop') return;
    const [item] = edits.splice(from, 1);
    const target = edits.findIndex(edit => edit.id === targetId);
    edits.splice(target + (after ? 1 : 0), 0, item);
    selectedId = id;
  });
}

function renderInspector() {
  const inspector = el<HTMLElement>('#inspector');
  const selected = selectedEdit();
  if (pickerId && selected?.id !== pickerId) closePicker();
  if (!selected) { inspector.innerHTML = '<div class="empty-properties"><span>◫</span><p>Select an element to edit its properties.</p></div>'; return; }
  const update = (change: (edit: Edit) => void) => updateSelected(selected.id, change);
  const shape = selected.type === 'rect' || selected.type === 'circle';
  const stepper = (name: string, id: string, value: number) => `<label class="field-label" for="${id}">${name}</label><div class="stepper"><button data-step="${id}" data-delta="-1" aria-label="Decrease ${name}">−</button><input id="${id}" type="number" value="${value}" aria-label="${name}"><button data-step="${id}" data-delta="1" aria-label="Increase ${name}">+</button></div>`;
  inspector.innerHTML = `<div class="property-section name-section"><label class="field-label" for="layer-name">Name</label><input id="layer-name" class="field" value="${escapeHtml(selected.name)}" maxlength="60"></div>
    ${selected.type === 'crop' ? `<div class="property-section"><div class="section-title">Crop area</div><p class="property-note">Drag the frame or handles on the screenshot.</p><div class="property-grid"><label>Width<input id="crop-width" type="number" min="20" value="${Math.round(selected.box.width / scale)}"></label><label>Height<input id="crop-height" type="number" min="20" value="${Math.round(selected.box.height / scale)}"></label></div><button id="done-crop" class="wide-button primary">Done cropping</button></div>` : `<div class="property-section"><div class="section-title">Appearance</div>
      ${shape ? `<div class="field-label">Style</div><div class="segmented-control" role="group" aria-label="Shape style"><button data-fill="outline" aria-pressed="${!selected.filled}" class="${selected.filled ? '' : 'active'}">Outline</button><button data-fill="filled" aria-pressed="${selected.filled}" class="${selected.filled ? 'active' : ''}">Filled</button></div>` : ''}
      <label class="field-label" for="property-hex">Color</label>
      <div class="color-control"><button id="open-picker" class="color-chip" style="--current-color:${selected.color};--current-opacity:${selected.opacity}" aria-label="Open color picker" aria-expanded="${pickerId === selected.id}"></button><input id="property-hex" aria-label="Hex color" maxlength="7" spellcheck="false" value="${selected.color.slice(1).toUpperCase()}"></div>
      ${'strokeWidth' in selected ? stepper('Line Width', 'stroke-width', selected.strokeWidth) : ''}
      ${selected.type === 'rect' ? stepper('Border Radius', 'corner-radius', selected.cornerRadius || 0) : ''}
      ${selected.type === 'text' ? `<div class="typography"><div class="field-label">Typography</div><label class="select-wrap"><select id="font-family" aria-label="Font family">${fontFamilies.map(family => `<option value="${family}" ${family === (selected.fontFamily || 'Arial') ? 'selected' : ''}>${family}</option>`).join('')}</select><img src="${caretIcon}" alt=""></label><div class="type-row"><label class="select-wrap"><select id="font-weight" aria-label="Font weight"><option value="regular" ${selected.bold ? '' : 'selected'}>Regular</option><option value="bold" ${selected.bold ? 'selected' : ''}>Bold</option></select><img src="${caretIcon}" alt=""></label><label class="select-wrap"><select id="font-size" aria-label="Font size">${Array.from({ length: 113 }, (_, i) => i + 8).map(size => `<option value="${size}" ${size === selected.fontSize ? 'selected' : ''}>${size}</option>`).join('')}</select><img src="${caretIcon}" alt=""></label></div></div>` : ''}
    </div>`}
    <div class="property-section last"><button id="delete-selected" class="wide-button danger">Delete layer</button></div>`;
  inspector.querySelector<HTMLInputElement>('#layer-name')!.onchange = event => update(edit => { edit.name = (event.target as HTMLInputElement).value.trim() || edit.name; });
  const setColor = (color: string) => { activeColor = color; update(edit => { if (edit.type !== 'crop') edit.color = color; }); };
  inspector.querySelector<HTMLButtonElement>('#open-picker')?.addEventListener('click', event => { if (pickerId === selected.id) closePicker(); else openPicker(selected.id, event.currentTarget as HTMLElement); });
  inspector.querySelector<HTMLInputElement>('#property-hex')?.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(value)) setColor(`#${value.toLowerCase()}`);
    else input.value = selected.color.slice(1).toUpperCase();
  });
  inspector.querySelectorAll<HTMLButtonElement>('[data-fill]').forEach(button => button.onclick = () => update(edit => { if (edit.type === 'rect' || edit.type === 'circle') edit.filled = button.dataset.fill === 'filled'; }));
  const changeNumber = (id: string, value: number) => update(edit => {
    if (id === 'stroke-width' && 'strokeWidth' in edit) edit.strokeWidth = Math.round(clamp(value, 1, 40));
    if (id === 'corner-radius' && edit.type === 'rect') edit.cornerRadius = Math.round(clamp(value, 0, Math.min(edit.box.width, edit.box.height) / 2));
  });
  for (const id of ['stroke-width', 'corner-radius']) inspector.querySelector<HTMLInputElement>(`#${id}`)?.addEventListener('change', event => changeNumber(id, Number((event.target as HTMLInputElement).value)));
  inspector.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => button.onclick = () => {
    const input = inspector.querySelector<HTMLInputElement>(`#${button.dataset.step}`)!;
    changeNumber(button.dataset.step!, Number(input.value) + Number(button.dataset.delta));
  });
  inspector.querySelector<HTMLSelectElement>('#font-family')?.addEventListener('change', event => update(edit => { if (edit.type === 'text') edit.fontFamily = (event.target as HTMLSelectElement).value; }));
  inspector.querySelector<HTMLSelectElement>('#font-size')?.addEventListener('change', event => update(edit => { if (edit.type === 'text') edit.fontSize = Number((event.target as HTMLSelectElement).value); }));
  inspector.querySelector<HTMLSelectElement>('#font-weight')?.addEventListener('change', event => update(edit => { if (edit.type === 'text') edit.bold = (event.target as HTMLSelectElement).value === 'bold'; }));
  for (const dimension of ['width', 'height'] as const) inspector.querySelector<HTMLInputElement>(`#crop-${dimension}`)?.addEventListener('change', event => update(edit => { if (edit.type === 'crop') edit.box = clampCrop({ ...edit.box, [dimension]: Math.max(20, Number((event.target as HTMLInputElement).value) * scale) }); }));
  inspector.querySelector<HTMLButtonElement>('#done-crop')?.addEventListener('click', () => { selectedId = null; selectTool('select'); drawEdits(); });
  inspector.querySelector<HTMLButtonElement>('#delete-selected')?.addEventListener('click', deleteSelected);
}

function closePicker() {
  document.querySelector('#color-picker')?.remove();
  document.removeEventListener('pointerdown', dismissPicker);
  document.removeEventListener('keydown', escapePicker);
  pickerId = null;
  pickerGestureActive = false;
  document.querySelector('#open-picker')?.setAttribute('aria-expanded', 'false');
}

function pickerValue(color: string, opacity: number, continuous = false) {
  if (!pickerId) return;
  const id = pickerId;
  color = color.toLowerCase();
  const edit = edits.find(item => item.id === id);
  if (!edit || edit.type === 'crop' || (edit.color === color && edit.opacity === opacity)) return;
  if (continuous) {
    if (!pickerGestureActive) { undoStack.push(structuredClone(edits)); redoStack = []; pickerGestureActive = true; }
    edit.color = color; edit.opacity = opacity; activeColor = color; drawEdits();
  } else {
    pickerGestureActive = false;
    activeColor = color;
    updateSelected(id, current => { if (current.type !== 'crop') { current.color = color; current.opacity = opacity; } });
  }
  renderPickerState();
}

function renderPickerState() {
  const picker = document.querySelector<HTMLElement>('#color-picker');
  const edit = selectedEdit();
  if (!picker || !edit || edit.type === 'crop') return;
  const rgb = hexToRgb(edit.color)!;
  const hsv = rgbToHsv(rgb);
  if (hsv.s > 0) pickerHue = hsv.h;
  picker.style.setProperty('--picker-hue', String(pickerHue));
  picker.style.setProperty('--picker-color', edit.color);
  picker.style.setProperty('--picker-opacity', String(edit.opacity));
  picker.querySelector<HTMLElement>('.color-field')!.style.setProperty('--field-hue', `hsl(${pickerHue} 100% 50%)`);
  picker.querySelector<HTMLElement>('.field-handle')!.style.left = `${hsv.s * 100}%`;
  picker.querySelector<HTMLElement>('.field-handle')!.style.top = `${(1 - hsv.v) * 100}%`;
  picker.querySelector<HTMLElement>('.color-field')!.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
  picker.querySelector<HTMLElement>('.color-field')!.setAttribute('aria-valuetext', `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
  picker.querySelector<HTMLInputElement>('#picker-hue')!.value = String(Math.round(pickerHue));
  picker.querySelector<HTMLInputElement>('#picker-alpha')!.value = String(Math.round(edit.opacity * 100));
  picker.querySelectorAll<HTMLInputElement>('[data-rgb]').forEach(input => { if (document.activeElement !== input) input.value = String(rgb[input.dataset.rgb as keyof typeof rgb]); });
  const hex = picker.querySelector<HTMLInputElement>('#picker-hex');
  if (hex && document.activeElement !== hex) hex.value = edit.color.slice(1).toUpperCase();
  const percent = picker.querySelector<HTMLInputElement>('#picker-percent');
  if (percent && document.activeElement !== percent) percent.value = String(Math.round(edit.opacity * 100));
  picker.querySelector<HTMLElement>('.saved-colors')!.innerHTML = savedColors.map((item, index) => `<button class="saved-swatch ${item.color === edit.color && item.opacity === edit.opacity ? 'current' : ''}" data-saved="${index}" style="--swatch:${item.color};--swatch-opacity:${item.opacity}" aria-label="Use saved color ${item.color}, ${Math.round(item.opacity * 100)}% opacity"></button>`).join('');
}

function openPicker(id: string, anchor: HTMLElement) {
  closePicker();
  pickerId = id;
  anchor.setAttribute('aria-expanded', 'true');
  const picker = document.createElement('div');
  picker.id = 'color-picker';
  picker.className = 'color-picker';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Color Picker');
  picker.innerHTML = `<div class="picker-heading"><strong>Color Picker</strong><button id="picker-close" aria-label="Close color picker">×</button></div>
    <div class="color-field" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-label="Color saturation and brightness"><span class="field-handle"></span></div>
    <div class="picker-sliders"><input id="picker-hue" type="range" min="0" max="359" aria-label="Hue"><input id="picker-alpha" type="range" min="0" max="100" aria-label="Opacity"></div>
    <div class="picker-values"><label class="select-wrap"><select id="picker-mode" aria-label="Color format"><option value="rgb">RGB</option><option value="hex">HEX</option></select><img src="${caretIcon}" alt=""></label><div class="picker-channels" id="picker-channels"></div></div>
    <div class="saved-heading"><span>Saved Colors</span><button id="save-color" aria-label="Save current color">+</button></div><div class="saved-colors" aria-label="Saved Colors"></div>`;
  document.body.append(picker);
  const rect = anchor.getBoundingClientRect();
  picker.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - Math.min(490, picker.offsetHeight) - 8))}px`;
  picker.style.left = `${Math.max(8, Math.min(rect.left - picker.offsetWidth - 12, window.innerWidth - picker.offsetWidth - 8))}px`;
  if (rect.left < picker.offsetWidth + 20) picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - picker.offsetWidth - 8))}px`;
  picker.querySelector<HTMLButtonElement>('#picker-close')!.onclick = closePicker;
  const field = picker.querySelector<HTMLElement>('.color-field')!;
  const pickField = (event: PointerEvent) => {
    const bounds = field.getBoundingClientRect();
    const selected = selectedEdit();
    if (!selected) return;
    const hsv: HSV = { h: pickerHue, s: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), v: 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
    pickerValue(rgbToHex(hsvToRgb(hsv)), selected.opacity, true);
  };
  field.addEventListener('pointerdown', event => { field.setPointerCapture(event.pointerId); pickField(event); });
  field.addEventListener('pointermove', event => { if (field.hasPointerCapture(event.pointerId)) pickField(event); });
  field.addEventListener('pointerup', () => { pickerGestureActive = false; });
  field.addEventListener('pointercancel', () => { pickerGestureActive = false; });
  field.addEventListener('keydown', event => {
    const edit = selectedEdit(); if (!edit) return;
    const hsv = rgbToHsv(hexToRgb(edit.color)!);
    if (event.key === 'ArrowLeft') hsv.s = clamp(hsv.s - .01, 0, 1);
    else if (event.key === 'ArrowRight') hsv.s = clamp(hsv.s + .01, 0, 1);
    else if (event.key === 'ArrowUp') hsv.v = clamp(hsv.v + .01, 0, 1);
    else if (event.key === 'ArrowDown') hsv.v = clamp(hsv.v - .01, 0, 1);
    else return;
    event.preventDefault(); hsv.h = pickerHue;
    pickerValue(rgbToHex(hsvToRgb(hsv)), edit.opacity);
  });
  picker.querySelector<HTMLInputElement>('#picker-hue')!.addEventListener('input', event => {
    const edit = selectedEdit(); if (!edit) return;
    const hsv = rgbToHsv(hexToRgb(edit.color)!);
    pickerHue = Number((event.target as HTMLInputElement).value);
    pickerValue(rgbToHex(hsvToRgb({ ...hsv, h: pickerHue, s: hsv.s || 1 })), edit.opacity, true);
  });
  picker.querySelector<HTMLInputElement>('#picker-alpha')!.addEventListener('input', event => {
    const edit = selectedEdit(); if (edit) pickerValue(edit.color, Number((event.target as HTMLInputElement).value) / 100, true);
  });
  picker.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => input.addEventListener('change', () => { pickerGestureActive = false; }));
  const channels = picker.querySelector<HTMLElement>('#picker-channels')!;
  const mode = picker.querySelector<HTMLSelectElement>('#picker-mode')!;
  const renderChannels = () => {
    channels.innerHTML = mode.value === 'rgb' ? `<input data-rgb="r" type="number" min="0" max="255" aria-label="Red"><input data-rgb="g" type="number" min="0" max="255" aria-label="Green"><input data-rgb="b" type="number" min="0" max="255" aria-label="Blue"><label><input id="picker-percent" type="number" min="0" max="100" aria-label="Opacity percent">%</label>` : `<label class="picker-hex"><span>#</span><input id="picker-hex" maxlength="6" spellcheck="false" aria-label="Hex color"></label><label><input id="picker-percent" type="number" min="0" max="100" aria-label="Opacity percent">%</label>`;
    renderPickerState();
  };
  mode.onchange = renderChannels;
  channels.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    const edit = selectedEdit(); if (!edit) return;
    if (input.id === 'picker-percent') pickerValue(edit.color, clamp(Number(input.value), 0, 100) / 100);
    else if (input.id === 'picker-hex') { const rgb = hexToRgb(input.value); if (rgb) pickerValue(rgbToHex(rgb), edit.opacity); else input.value = edit.color.slice(1).toUpperCase(); }
    else if (input.dataset.rgb) {
      const rgb = hexToRgb(edit.color)!;
      rgb[input.dataset.rgb as keyof typeof rgb] = Math.round(clamp(Number(input.value), 0, 255));
      pickerValue(rgbToHex(rgb), edit.opacity);
    }
    renderPickerState();
  });
  picker.querySelector<HTMLButtonElement>('#save-color')!.onclick = () => {
    const edit = selectedEdit(); if (!edit || edit.type === 'crop') return;
    if (!savedColors.some(item => item.color === edit.color && item.opacity === edit.opacity)) savedColors.push({ color: edit.color, opacity: edit.opacity });
    renderPickerState();
  };
  picker.querySelector<HTMLElement>('.saved-colors')!.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-saved]');
    if (button) { const item = savedColors[Number(button.dataset.saved)]; pickerValue(item.color, item.opacity); }
  });
  renderChannels();
  document.addEventListener('pointerdown', dismissPicker);
  document.addEventListener('keydown', escapePicker);
}

function dismissPicker(event: PointerEvent) {
  if (!(event.target as Element).closest('#color-picker, #open-picker')) closePicker();
}
function escapePicker(event: KeyboardEvent) { if (event.key === 'Escape') { event.stopPropagation(); closePicker(); } }

function select(id: string | null) {
  selectedId = id;
  drawEdits();
}

function deleteSelected() {
  if (!selectedId) return;
  const id = selectedId;
  commit(() => { edits = edits.filter(edit => edit.id !== id); selectedId = null; });
}

function dimOutside(box: Box) {
  const fill = 'rgba(23, 22, 20, .52)';
  const { x, y, width, height } = box;
  for (const region of [
    { x: 0, y: 0, width: stage.width(), height: y },
    { x: 0, y, width: x, height },
    { x: x + width, y, width: stage.width() - x - width, height },
    { x: 0, y: y + height, width: stage.width(), height: stage.height() - y - height },
  ]) overlay.add(new Konva.Rect({ ...region, fill, listening: false }));
}

function drawEdits() {
  art.destroyChildren();
  art.listening(selectedEdit()?.type !== 'crop');
  baseNode = new Konva.Image({ image: baseImage, width: stage.width(), height: stage.height() });
  art.add(baseNode);
  overlay.destroyChildren();
  for (const edit of edits) {
    if (edit.type === 'crop') continue;
    let node: Konva.Shape;
    if (edit.type === 'pen' || edit.type === 'arrow') {
      const points = edit.points.map((value, index) => value - edit.points[index % 2]);
      const attrs = { x: edit.points[0], y: edit.points[1], points, stroke: edit.color, strokeWidth: edit.strokeWidth, lineCap: 'round' as const, lineJoin: 'round' as const, hitStrokeWidth: 18, draggable: true };
      node = edit.type === 'pen' ? new Konva.Line({ ...attrs, tension: 0.2 }) : new Konva.Arrow({ ...attrs, fill: edit.color, pointerLength: 11, pointerWidth: 11 });
    } else if (edit.type === 'rect') node = new Konva.Rect({ ...edit.box, cornerRadius: Math.min(edit.cornerRadius || 0, edit.box.width / 2, edit.box.height / 2), stroke: edit.color, strokeWidth: edit.strokeWidth, fill: edit.filled ? edit.color : undefined, draggable: true });
    else if (edit.type === 'circle') node = new Konva.Ellipse({ x: edit.box.x + edit.box.width / 2, y: edit.box.y + edit.box.height / 2, radiusX: edit.box.width / 2, radiusY: edit.box.height / 2, stroke: edit.color, strokeWidth: edit.strokeWidth, fill: edit.filled ? edit.color : undefined, draggable: true });
    else if (edit.type === 'redact') node = new Konva.Rect({ ...edit.box, fill: edit.color, draggable: true });
    else node = new Konva.Text({ x: edit.x, y: edit.y, width: edit.width, text: edit.text, fontSize: edit.fontSize, fontFamily: edit.fontFamily || 'Arial', fontStyle: edit.bold ? 'bold' : 'normal', fill: edit.color, draggable: true });
    node.opacity(edit.opacity);
    node.name(edit.id);
    node.on('mousedown touchstart', event => { event.cancelBubble = true; selectedId = edit.id; transformer.nodes(edit.type === 'arrow' ? [] : [node]); transformer.enabledAnchors(edit.type === 'text' ? ['middle-left', 'middle-right'] : ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']); renderInspector(); renderLayers(); });
    node.on('click tap', event => { event.cancelBubble = true; if (edit.type === 'arrow') select(edit.id); });
    node.on('dblclick dbltap', event => { event.cancelBubble = true; if (edit.type === 'text') beginTextEdit(edit.id); });
    node.on('dragend transformend', () => commit(() => {
      const current = edits.find(item => item.id === edit.id);
      if (!current) return;
      if (current.type === 'pen' || current.type === 'arrow') {
        const shape = node as Konva.Line;
        const points = shape.points();
        current.points = points.map((value, index) => {
          const local = index % 2 ? { x: points[index - 1], y: value } : { x: value, y: points[index + 1] };
          return index % 2 ? node.getTransform().point(local).y : node.getTransform().point(local).x;
        });
      } else if (current.type === 'text') {
        current.x = node.x(); current.y = node.y(); current.width = Math.max(40, node.width() * node.scaleX());
      } else if (current.type === 'circle') {
        const ellipse = node as Konva.Ellipse;
        const width = ellipse.radiusX() * 2 * ellipse.scaleX();
        const height = ellipse.radiusY() * 2 * ellipse.scaleY();
        current.box = { x: ellipse.x() - width / 2, y: ellipse.y() - height / 2, width, height };
      } else if (current.type !== 'crop') {
        current.box = { x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY() };
        if (current.type === 'rect') current.cornerRadius = Math.min(current.cornerRadius || 0, current.box.width / 2, current.box.height / 2);
      }
    }));
    art.add(node);
  }
  const crop = [...edits].reverse().find(e => e.type === 'crop');
  if (crop?.type === 'crop' && selectedId === crop.id) {
    dimOutside(crop.box);
    const node = new Konva.Rect({ ...crop.box, stroke: '#ffffff', strokeWidth: 2, dash: [8, 5], fill: 'rgba(255,255,255,.001)', draggable: true });
    node.name(crop.id);
    node.on('mousedown touchstart', event => { event.cancelBubble = true; selectedId = crop.id; transformer.nodes([node]); renderInspector(); renderLayers(); });
    node.on('click tap', event => { event.cancelBubble = true; select(crop.id); });
    node.on('dragend transformend', () => commit(() => { crop.box = clampCrop({ x: node.x(), y: node.y(), width: node.width() * node.scaleX(), height: node.height() * node.scaleY() }); }));
    overlay.add(node);
  }
  transformer = new Konva.Transformer({ rotateEnabled: false, flipEnabled: false, borderStroke: '#e56142', anchorStroke: '#e56142', anchorFill: '#ffffff', anchorSize: 9, padding: 3, boundBoxFunc: (oldBox, newBox) => newBox.width < 20 || newBox.height < 20 ? oldBox : newBox });
  overlay.add(transformer);
  if (selectedId) {
    const node = [...art.getChildren(), ...overlay.getChildren()].find(item => item.name() === selectedId);
    if (node) {
      transformer.nodes(selectedEdit()?.type === 'arrow' ? [] : [node]);
      transformer.enabledAnchors(selectedEdit()?.type === 'text' ? ['middle-left', 'middle-right'] : ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']);
    } else selectedId = null;
  }
  const selected = selectedEdit();
  if (selected?.type === 'arrow') {
    const arrow = art.getChildren().find(item => item.name() === selected.id) as Konva.Arrow | undefined;
    if (arrow) {
      const endpoints = [0, 2].map(index => new Konva.Circle({ x: selected.points[index], y: selected.points[index + 1], radius: 7, fill: '#ffffff', stroke: '#e56142', strokeWidth: 2, draggable: true }));
      for (const handle of endpoints) {
        handle.on('mousedown touchstart click tap', event => { event.cancelBubble = true; });
        handle.on('dragmove', () => {
          arrow.position({ x: endpoints[0].x(), y: endpoints[0].y() });
          arrow.points([0, 0, endpoints[1].x() - endpoints[0].x(), endpoints[1].y() - endpoints[0].y()]);
        });
        handle.on('dragend', () => commit(() => {
          const current = selectedEdit();
          if (current?.type === 'arrow') current.points = [endpoints[0].x(), endpoints[0].y(), endpoints[1].x(), endpoints[1].y()];
        }));
        overlay.add(handle);
      }
    }
  }
  el<HTMLButtonElement>('#undo').disabled = !undoStack.length;
  el<HTMLButtonElement>('#redo').disabled = !redoStack.length;
  const viewport = editorViewport();
  const viewportKey = `${viewport.x},${viewport.y},${viewport.width},${viewport.height}`;
  if (el<HTMLElement>('#canvas-extent').dataset.viewport !== viewportKey) updateZoom(zoomIsFit, viewZoom);
  status(selectedId === crop?.id ? 'Crop preview · drag the frame or handles, then choose Done cropping' : `${Math.round(viewport.width / scale)} × ${Math.round(viewport.height / scale)} px · click an annotation to edit it`);
  renderInspector();
  renderLayers();
}

function add(edit: Edit) {
  selectedId = edit.id;
  const shell = el<HTMLElement>('.editor-shell');
  if (window.innerWidth <= 760) shell.classList.remove('properties-collapsed');
  else shell.classList.remove('layers-collapsed', 'properties-collapsed');
  commit(() => edits.push(edit));
  if (zoomIsFit) requestAnimationFrame(() => updateZoom(true));
}

function beginTextEdit(id: string, selectAll = false) {
  const edit = edits.find(item => item.id === id);
  if (edit?.type !== 'text') return;
  if (textEditor) {
    if (textEditorId === id) { textEditor.focus(); return; }
    finishTextEditor?.(true);
  }
  selectedId = id;
  drawEdits();
  const node = art.getChildren().find(item => item.name() === id) as Konva.Text | undefined;
  node?.hide();
  transformer.nodes([]);
  const input = document.createElement('textarea');
  textEditor = input;
  textEditorId = id;
  input.className = 'text-editor';
  input.rows = 1;
  input.value = edit.text;
  input.placeholder = 'Type text';
  input.style.left = `${edit.x}px`; input.style.top = `${edit.y}px`;
  input.style.width = `${edit.width}px`;
  input.style.color = edit.color;
  input.style.fontSize = `${edit.fontSize}px`;
  input.style.fontWeight = edit.bold ? 'bold' : 'normal';
  input.style.fontFamily = edit.fontFamily || 'Arial';
  input.style.opacity = String(edit.opacity);
  stage.container().style.position = 'relative';
  stage.container().append(input);
  const fitInput = () => { input.style.height = 'auto'; input.style.height = `${Math.max(edit.fontSize, input.scrollHeight)}px`; };
  input.addEventListener('input', fitInput);
  fitInput();
  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    input.remove();
    textEditor = null;
    textEditorId = null;
    finishTextEditor = null;
    if (save && value !== edit.text && edits.some(item => item.id === id)) commit(() => { const current = edits.find(item => item.id === id); if (current?.type === 'text') current.text = value || 'Text'; });
    else drawEdits();
  };
  finishTextEditor = finish;
  input.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== input) finish(true); }, 0); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); }
  });
  input.focus();
  if (selectAll) input.select();
}

function bindStage() {
  stage.on('mousedown touchstart', event => {
    if (busy) return;
    if (event.target !== baseNode) return;
    if (tool === 'select' || tool === 'crop' || tool === 'text') { select(null); return; }
    start = point();
    if (tool === 'pen') penPoints = [start.x, start.y];
    draft?.destroy();
    if (tool === 'pen') draft = new Konva.Line({ points: penPoints, stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH, lineCap: 'round', lineJoin: 'round' });
    else if (tool === 'arrow') draft = new Konva.Arrow({ points: [start.x, start.y, start.x, start.y], stroke: activeColor, fill: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH, pointerLength: 11, pointerWidth: 11 });
    else if (tool === 'circle') draft = new Konva.Ellipse({ x: start.x, y: start.y, radiusX: 0, radiusY: 0, stroke: activeColor, strokeWidth: DEFAULT_STROKE_WIDTH });
    else draft = new Konva.Rect({ x: start.x, y: start.y, width: 0, height: 0, stroke: tool === 'redact' ? '#151515' : activeColor, strokeWidth: DEFAULT_STROKE_WIDTH, fill: tool === 'redact' ? '#151515' : undefined });
    overlay.add(draft);
  });
  stage.on('mousemove touchmove', () => {
    if (!draft) return;
    const current = point();
    if (tool === 'pen') { penPoints.push(current.x, current.y); (draft as Konva.Line).points(penPoints); }
    else if (tool === 'arrow') (draft as Konva.Arrow).points([start.x, start.y, current.x, current.y]);
    else if (tool === 'circle') {
      const box = boxFrom(start, current);
      (draft as Konva.Ellipse).setAttrs({ x: box.x + box.width / 2, y: box.y + box.height / 2, radiusX: box.width / 2, radiusY: box.height / 2 });
    } else (draft as Konva.Rect).setAttrs(boxFrom(start, current));
  });
  const end = () => {
    if (!draft) return;
    const current = point();
    draft.destroy(); draft = null;
    if (tool === 'pen' && penPoints.length >= 4) add({ id: crypto.randomUUID(), name: nextName('Pen'), type: 'pen', points: [...penPoints], color: activeColor, opacity: 1, strokeWidth: DEFAULT_STROKE_WIDTH });
    else if (tool === 'arrow' && Math.hypot(current.x - start.x, current.y - start.y) > 8) add({ id: crypto.randomUUID(), name: nextName('Arrow'), type: 'arrow', points: [start.x, start.y, current.x, current.y], color: activeColor, opacity: 1, strokeWidth: DEFAULT_STROKE_WIDTH });
    else if (tool === 'rect' || tool === 'circle' || tool === 'redact') {
      const box = boxFrom(start, current);
      if (box.width > 8 && box.height > 8) {
        if (tool === 'redact') add({ id: crypto.randomUUID(), name: nextName('Redaction'), type: 'redact', box, color: '#151515', opacity: 1 });
        else if (tool === 'circle') add({ id: crypto.randomUUID(), name: nextName('Circle'), type: 'circle', box, color: activeColor, opacity: 1, strokeWidth: DEFAULT_STROKE_WIDTH, filled: false });
        else add({ id: crypto.randomUUID(), name: nextName('Box'), type: 'rect', box, color: activeColor, opacity: 1, strokeWidth: DEFAULT_STROKE_WIDTH, filled: false });
      }
    }
    selectTool('select');
  };
  stage.on('mouseup touchend', end);
  window.addEventListener('mouseup', end);
}

function nextName(type: string) { return `${type} ${edits.filter(edit => edit.name.startsWith(`${type} `)).length + 1}`; }

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('A screenshot tile could not be decoded.')); img.src = url;
  });
}

async function assemble(capture: CaptureRecord): Promise<HTMLImageElement> {
  const keys = Array.from({ length: capture.count }, (_, i) => `tile:${capture.id}:${i}`);
  const values = await chrome.storage.local.get(keys);
  if (keys.some(k => typeof values[k] !== 'string')) throw new Error('Capture data is missing. Retry the screenshot.');
  const first = await image(values[keys[0]] as string);
  const ratio = first.naturalWidth / capture.viewportWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(capture.width * ratio);
  canvas.height = Math.ceil(capture.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Chrome could not allocate an image canvas.');
  ctx.drawImage(first, 0, 0);
  const inner = capture.inner;
  let covered = inner ? inner.height : capture.viewportHeight;
  for (let i = 1; i < capture.count; i++) {
    const tile = await image(values[keys[i]] as string);
    const position = capture.positions[i];
    const extent = inner ? inner.height : capture.viewportHeight;
    const slice = uncoveredSlice(covered, position, extent, inner ? inner.scrollHeight : capture.height);
    if (slice.length) {
      const x = inner ? inner.left : 0;
      const y = inner ? inner.top : 0;
      const width = inner ? inner.width : capture.width;
      ctx.drawImage(tile, x * ratio, (y + slice.sourceOffset) * ratio, width * ratio, slice.length * ratio,
        x * ratio, (y + slice.destination) * ratio, width * ratio, slice.length * ratio);
      covered = slice.covered;
    }
  }
  if (inner && inner.top + inner.height < capture.viewportHeight) {
    const footer = capture.viewportHeight - inner.top - inner.height;
    ctx.drawImage(first, 0, (inner.top + inner.height) * ratio, first.width, footer * ratio,
      0, (inner.top + inner.scrollHeight) * ratio, first.width, footer * ratio);
  }
  return image(canvas.toDataURL('image/png'));
}

function exportCanvas(region: Box): HTMLCanvasElement {
  overlay.visible(false);
  try { return stage.toCanvas({ x: region.x, y: region.y, width: region.width, height: region.height, pixelRatio: 1 / scale }); }
  finally { overlay.visible(true); }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function savePNG() {
  const region = cropBox();
  if (region.width * region.height / (scale * scale) > 120_000_000) throw new Error('The PNG is too large. Crop the image before export.');
  const canvas = exportCanvas(region);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed.');
  download(blob, 'fullpage-screenshot.png');
}

async function savePDF() {
  const region = cropBox();
  const format = el<HTMLSelectElement>('#paper').value as 'a4' | 'letter';
  const pdf = new jsPDF({ format, orientation: region.width > region.height ? 'landscape' : 'portrait', unit: 'mm', compress: true });
  const margin = 8;
  const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2;
  const sliceHeight = pageHeight / pageWidth * region.width;
  for (let offset = 0, page = 0; offset < region.height; offset += sliceHeight, page++) {
    const height = Math.min(sliceHeight, region.height - offset);
    const canvas = exportCanvas({ x: region.x, y: region.y + offset, width: region.width, height });
    if (page) pdf.addPage(format, region.width > region.height ? 'landscape' : 'portrait');
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pageWidth, height / region.width * pageWidth);
    status(`Preparing PDF page ${page + 1}…`);
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  download(pdf.output('blob'), 'fullpage-screenshot.pdf');
}

async function load() {
  const error = new URLSearchParams(location.search).get('error');
  if (error) throw new Error(error);
  if (!id) throw new Error('No capture was selected.');
  const value = await chrome.storage.local.get(`capture:${id}`);
  record = value[`capture:${id}`] as CaptureRecord;
  if (!record) throw new Error('This capture is no longer available.');
  baseImage = await assemble(record);
  await Promise.all([document.fonts.load('400 16px Inter'), document.fonts.load('700 16px Inter')]);
  const downloadIcon = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 1.5v12m0 0 4.5-4.5M10 13.5 5.5 9M2 18h16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  app.innerHTML = `
    <header class="topbar"><strong class="header-title">Fullpage Screenshot</strong><div class="top-actions"><button id="undo" class="icon-action" title="Undo (⌘/Ctrl+Z)" aria-label="Undo"><img src="${undoIcon}" alt=""></button><button id="redo" class="icon-action" title="Redo (⌘/Ctrl+Shift+Z)" aria-label="Redo"><img src="${redoIcon}" alt=""></button><button class="download-action" id="pdf" aria-label="Download PDF"><span class="download-label"><span class="download-prefix">Download </span>PDF</span>${downloadIcon}</button><button class="download-action" id="png" aria-label="Download PNG"><span class="download-label"><span class="download-prefix">Download </span>PNG</span>${downloadIcon}</button></div></header>
    <main class="editor-shell layers-collapsed properties-collapsed"><aside class="side-panel layers-panel" aria-label="Layers"><div class="panel-heading"><strong>Layers</strong><button id="collapse-layers" class="panel-toggle" title="Collapse layers" aria-label="Collapse layers">‹</button></div><div id="layer-list" class="layer-list"></div></aside>
      <section class="workspace"><div class="canvas-toolbar"><button id="show-layers" class="edge-toggle" title="Show layers" aria-label="Show layers">☰</button><span id="title" class="canvas-title"></span><div class="zoom-controls"><button id="zoom-out" title="Zoom out" aria-label="Zoom out">−</button><button id="zoom-fit" title="Fit width">Fit</button><span id="zoom-level"></span><button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button></div><button id="show-properties" class="edge-toggle" title="Show properties" aria-label="Show properties">☷</button></div>
      <div class="canvas-scroll"><div id="canvas-extent"><div id="canvas"></div></div></div>
      <nav class="floating-tools" aria-label="Annotation tools">${([
        ['select', 'Select and move', 'V'], ['rect', 'Square', 'R'], ['arrow', 'Arrow', 'A'],
        ['circle', 'Circle', 'O'], ['pen', 'Pen', 'P'], ['text', 'Text', 'T'], ['crop', 'Crop', 'C'],
      ] as [Tool, string, string][]).map(([name, label, key]) => toolButton(name, label, key)).join('')}<span class="tool-divider" aria-hidden="true"></span>${toolButton('redact', 'Redact', 'B')}</nav></section>
      <aside class="side-panel properties-panel" aria-label="Properties"><div class="panel-heading"><strong>Properties</strong><button id="collapse-properties" class="panel-toggle" title="Collapse properties" aria-label="Collapse properties">›</button></div><div id="inspector" class="inspector"></div></aside></main>
    <footer><span id="status"></span><div class="footer-actions"><label>PDF size <select id="paper" aria-label="PDF paper size"><option value="a4">A4</option><option value="letter">Letter</option></select></label><button id="retry" title="Capture the source page again">Recapture</button><button id="discard" title="Delete this capture and close the editor">Discard</button></div></footer>`;
  el<HTMLElement>('#title').textContent = record.title;
  const available = Math.max(300, window.innerWidth - 560);
  scale = Math.min(1, available / baseImage.width, 12_000 / baseImage.height);
  stage = new Konva.Stage({ container: 'canvas', width: Math.ceil(baseImage.width * scale), height: Math.ceil(baseImage.height * scale) });
  art = new Konva.Layer(); overlay = new Konva.Layer(); stage.add(art, overlay);
  bindStage(); drawEdits(); selectTool('select');
  updateZoom(true);
  el<HTMLButtonElement>('#zoom-fit').onclick = () => updateZoom(true);
  el<HTMLButtonElement>('#zoom-in').onclick = () => updateZoom(false, viewZoom * 1.25);
  el<HTMLButtonElement>('#zoom-out').onclick = () => updateZoom(false, viewZoom / 1.25);
  el<HTMLButtonElement>('#collapse-layers').onclick = () => togglePanel('layers', true);
  el<HTMLButtonElement>('#show-layers').onclick = () => togglePanel('layers', false);
  el<HTMLButtonElement>('#collapse-properties').onclick = () => togglePanel('properties', true);
  el<HTMLButtonElement>('#show-properties').onclick = () => togglePanel('properties', false);
  window.addEventListener('resize', () => { closePicker(); if (zoomIsFit) updateZoom(true); });
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => button.addEventListener('click', () => selectTool(button.dataset.tool as Tool)));
  el<HTMLButtonElement>('#undo').onclick = () => { const prior = undoStack.pop(); if (prior) { redoStack.push(structuredClone(edits)); edits = prior; selectedId = null; drawEdits(); } };
  el<HTMLButtonElement>('#redo').onclick = () => { const next = redoStack.pop(); if (next) { undoStack.push(structuredClone(edits)); edits = next; selectedId = null; drawEdits(); } };
  el<HTMLButtonElement>('#png').onclick = () => void runExport(savePNG);
  el<HTMLButtonElement>('#pdf').onclick = () => void runExport(savePDF);
  el<HTMLButtonElement>('#retry').onclick = async () => {
    if (busy) return;
    busy = true; status('Returning to the source page for scrolling capture…');
    const current = await chrome.tabs.getCurrent();
    if (!current?.id) { busy = false; status('Could not find this editor tab.'); return; }
    await chrome.runtime.sendMessage({ type: 'retry', sourceTabId: record.sourceTabId, editorTabId: current.id });
  };
  el<HTMLButtonElement>('#discard').onclick = async () => {
    const keys = [`capture:${record.id}`, ...Array.from({ length: record.count }, (_, i) => `tile:${record.id}:${i}`)];
    await chrome.storage.local.remove(keys);
    window.close();
  };
  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.target instanceof HTMLElement && event.target.closest('button')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); el<HTMLButtonElement>(event.shiftKey ? '#redo' : '#undo').click();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedId) { event.preventDefault(); deleteSelected(); }
    } else if (event.key === 'Enter' && selectedEdit()?.type === 'text') {
      event.preventDefault(); beginTextEdit(selectedId!);
    } else if (event.key === 'Escape') {
      selectedId = null; selectTool('select'); drawEdits();
    } else if (!event.metaKey && !event.ctrlKey) {
      const keys: Record<string, Tool> = { v: 'select', c: 'crop', p: 'pen', a: 'arrow', r: 'rect', o: 'circle', t: 'text', b: 'redact' };
      if (keys[event.key.toLowerCase()]) selectTool(keys[event.key.toLowerCase()]);
    }
  });
}

function toolButton(name: Tool, label: string, key: string) {
  const selected = name === 'select';
  return `<button data-tool="${name}" class="${selected ? 'selected' : ''}" title="${label} (${key})" aria-label="${label}" aria-pressed="${selected}"><img src="${toolIcons[name]}" alt=""></button>`;
}

function updateToolButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => {
    const selected = button.dataset.tool === tool;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function selectTool(next: Tool) {
  if (next !== 'crop' && selectedEdit()?.type === 'crop') {
    selectedId = null;
    drawEdits();
  }
  tool = next;
  updateToolButtons();
  if (!stage) return;
  stage.container().style.cursor = tool === 'select' ? 'default' : 'crosshair';
  if (tool === 'text') {
    const scroller = el<HTMLElement>('.canvas-scroll');
    const canvasRect = stage.container().getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const width = Math.min(180, stage.width() - 12);
    const x = Math.max(12, Math.min(stage.width() - width, (scrollerRect.left + scroller.clientWidth / 2 - canvasRect.left) / viewZoom - width / 2));
    const y = Math.max(12, Math.min(stage.height() - 36, (scrollerRect.top + Math.min(scroller.clientHeight / 3, 140) - canvasRect.top) / viewZoom));
    const edit: Edit = { id: crypto.randomUUID(), name: nextName('Text'), type: 'text', x, y, width, text: 'Text', color: activeColor, opacity: 1, fontSize: 16, bold: false, fontFamily: 'Inter' };
    add(edit);
    tool = 'select';
    updateToolButtons();
    beginTextEdit(edit.id, true);
  } else if (tool === 'crop') {
    const existing = edits.find(edit => edit.type === 'crop');
    if (existing) select(existing.id);
    else {
      const scroller = el<HTMLElement>('.canvas-scroll');
      const canvasRect = stage.container().getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const width = Math.max(30, stage.width() * .8);
      const height = Math.max(30, Math.min(stage.height() * .8, scroller.clientHeight * .75 / viewZoom));
      const centerX = (scrollerRect.left + scroller.clientWidth / 2 - canvasRect.left) / viewZoom;
      const topY = (scrollerRect.top + 35 - canvasRect.top) / viewZoom;
      const box = { x: Math.max(0, Math.min(stage.width() - width, centerX - width / 2)), y: Math.max(0, Math.min(stage.height() - height, topY)), width, height };
      add({ id: crypto.randomUUID(), name: 'Crop area', type: 'crop', box, color: '#ffffff', opacity: 1 });
    }
    tool = 'select';
    updateToolButtons();
  }
}

function updateZoom(fit: boolean, requested = viewZoom) {
  if (!stage) return;
  const scroller = el<HTMLElement>('.canvas-scroll');
  const viewport = editorViewport();
  zoomIsFit = fit;
  viewZoom = fit ? Math.max(.1, Math.min(6, 1 / scale, (scroller.clientWidth - 64) / viewport.width)) : Math.max(.1, Math.min(6, requested));
  const extent = el<HTMLElement>('#canvas-extent');
  const layout = viewportLayout(viewport, viewZoom);
  const viewportKey = `${viewport.x},${viewport.y},${viewport.width},${viewport.height}`;
  const viewportChanged = extent.dataset.viewport !== viewportKey;
  extent.style.width = `${layout.width}px`;
  extent.style.height = `${layout.height}px`;
  stage.container().style.transform = `translate(${layout.offsetX}px, ${layout.offsetY}px) scale(${viewZoom})`;
  extent.dataset.viewport = viewportKey;
  if (viewportChanged) { scroller.scrollLeft = 0; scroller.scrollTop = 0; }
  el<HTMLElement>('#zoom-level').textContent = `${Math.round(scale * viewZoom * 100)}%`;
  el<HTMLButtonElement>('#zoom-fit').classList.toggle('active', fit);
}

function togglePanel(side: 'layers' | 'properties', collapse: boolean) {
  const shell = el<HTMLElement>('.editor-shell');
  if ((side === 'properties' && collapse) || (side === 'layers' && !collapse && window.innerWidth <= 760)) closePicker();
  shell.classList.toggle(`${side}-collapsed`, collapse);
  if (!collapse && window.innerWidth <= 760) shell.classList.add(`${side === 'layers' ? 'properties' : 'layers'}-collapsed`);
  if (zoomIsFit) requestAnimationFrame(() => updateZoom(true));
}

async function runExport(operation: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try { await operation(); status('Export ready.'); }
  catch (error) { status(error instanceof Error ? error.message : 'Export failed.'); }
  finally { busy = false; }
}

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'capture-error' && message.sourceTabId === record?.sourceTabId) { busy = false; status(message.message); }
});

load().catch(error => {
  app.innerHTML = `<div class="empty"><strong>Capture unavailable</strong><p id="error"></p></div>`;
  el<HTMLElement>('#error').textContent = error instanceof Error ? error.message : 'Something went wrong.';
});
