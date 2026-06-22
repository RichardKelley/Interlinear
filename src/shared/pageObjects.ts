import type { PageSettings, Rect } from "./schema.js";

export const PAGE_OBJECT_MIN_WIDTH = 48;
export const PAGE_OBJECT_MIN_HEIGHT = 36;

export type PageObjectResizeHandle = "nw" | "ne" | "sw" | "se";
export type PageObjectRectBounds = Pick<PageSettings, "width" | "height"> &
  Partial<Pick<PageSettings, "marginTop" | "marginRight" | "marginBottom" | "marginLeft">>;

export function sanitizePageObjectRect(rect: Rect, bounds?: PageObjectRectBounds, constrainToMargins = false): Rect {
  const minX = constrainToMargins ? bounds?.marginLeft ?? 0 : 0;
  const minY = constrainToMargins ? bounds?.marginTop ?? 0 : 0;
  const maxX = bounds ? bounds.width - (constrainToMargins ? bounds.marginRight ?? 0 : 0) : Number.POSITIVE_INFINITY;
  const maxY = bounds ? bounds.height - (constrainToMargins ? bounds.marginBottom ?? 0 : 0) : Number.POSITIVE_INFINITY;
  const maxWidth = Math.max(0, maxX - minX);
  const maxHeight = Math.max(0, maxY - minY);
  const width = Math.min(maxWidth, Math.max(PAGE_OBJECT_MIN_WIDTH, rect.width));
  const height = Math.min(maxHeight, Math.max(PAGE_OBJECT_MIN_HEIGHT, rect.height));

  return {
    ...rect,
    x: bounds ? clamp(rect.x, minX, Math.max(minX, maxX - width)) : rect.x,
    y: bounds ? clamp(rect.y, minY, Math.max(minY, maxY - height)) : rect.y,
    width,
    height
  };
}

export function resizePageObjectRect(
  rect: Rect,
  handle: PageObjectResizeHandle,
  dx: number,
  dy: number,
  bounds?: PageObjectRectBounds,
  constrainToMargins = false
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

  return sanitizePageObjectRect(next, bounds, constrainToMargins);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
