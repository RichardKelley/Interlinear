import type { PageSettings, Rect } from "./schema.js";

export const PAGE_OBJECT_MIN_WIDTH = 48;
export const PAGE_OBJECT_MIN_HEIGHT = 36;

export type PageObjectResizeHandle = "nw" | "ne" | "sw" | "se";
export type PageObjectRectBounds = Pick<PageSettings, "width" | "height">;

export function sanitizePageObjectRect(rect: Rect, bounds?: PageObjectRectBounds): Rect {
  const maxWidth = bounds?.width ?? Number.POSITIVE_INFINITY;
  const maxHeight = bounds?.height ?? Number.POSITIVE_INFINITY;
  const width = Math.min(maxWidth, Math.max(PAGE_OBJECT_MIN_WIDTH, rect.width));
  const height = Math.min(maxHeight, Math.max(PAGE_OBJECT_MIN_HEIGHT, rect.height));

  return {
    ...rect,
    x: bounds ? clamp(rect.x, 0, Math.max(0, bounds.width - width)) : rect.x,
    y: bounds ? clamp(rect.y, 0, Math.max(0, bounds.height - height)) : rect.y,
    width,
    height
  };
}

export function resizePageObjectRect(
  rect: Rect,
  handle: PageObjectResizeHandle,
  dx: number,
  dy: number,
  bounds?: PageObjectRectBounds
): Rect {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  let next: Rect = { ...rect };

  if (handle.includes("e")) {
    next.width = rect.width + dx;
  }
  if (handle.includes("s")) {
    next.height = rect.height + dy;
  }
  if (handle.includes("w")) {
    next.x = rect.x + dx;
    next.width = rect.width - dx;
  }
  if (handle.includes("n")) {
    next.y = rect.y + dy;
    next.height = rect.height - dy;
  }

  if (handle.includes("w") && next.width < PAGE_OBJECT_MIN_WIDTH) {
    next.width = PAGE_OBJECT_MIN_WIDTH;
    next.x = right - PAGE_OBJECT_MIN_WIDTH;
  }
  if (handle.includes("n") && next.height < PAGE_OBJECT_MIN_HEIGHT) {
    next.height = PAGE_OBJECT_MIN_HEIGHT;
    next.y = bottom - PAGE_OBJECT_MIN_HEIGHT;
  }

  return sanitizePageObjectRect(next, bounds);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
