export type CaptureMode = 'scroll';

export interface ScrollPlan {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  positions: number[];
  inner?: { left: number; top: number; width: number; height: number; scrollHeight: number };
}

export interface CaptureRecord {
  id: string;
  sourceTabId: number;
  mode: CaptureMode;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  positions: number[];
  inner?: ScrollPlan['inner'];
  count: number;
}

export type CaptureRequest =
  | { type: 'start' | 'status' | 'stop' | 'cancel'; sourceTabId: number }
  | { type: 'retry'; sourceTabId: number; editorTabId: number };

export type CaptureMessage = CaptureRequest
  | { type: 'progress'; sourceTabId: number; percent: number; message: string };
