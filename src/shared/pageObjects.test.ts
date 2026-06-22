import { describe, expect, it } from "vitest";
import {
  PAGE_OBJECT_MIN_HEIGHT,
  PAGE_OBJECT_MIN_WIDTH,
  resizePageObjectRect,
  sanitizePageObjectRect
} from "./pageObjects";

describe("page object geometry", () => {
  it("enforces minimum object dimensions", () => {
    expect(sanitizePageObjectRect({ x: 10, y: 20, width: 1, height: 2 })).toEqual({
      x: 10,
      y: 20,
      width: PAGE_OBJECT_MIN_WIDTH,
      height: PAGE_OBJECT_MIN_HEIGHT
    });
  });

  it("resizes from a corner while preserving the opposite edge at minimum size", () => {
    const rect = { x: 100, y: 80, width: 120, height: 90 };

    expect(resizePageObjectRect(rect, "nw", 1000, 1000)).toEqual({
      x: 172,
      y: 134,
      width: PAGE_OBJECT_MIN_WIDTH,
      height: PAGE_OBJECT_MIN_HEIGHT
    });
  });

  it("clamps resized objects to page bounds", () => {
    expect(resizePageObjectRect({ x: 100, y: 80, width: 120, height: 90 }, "nw", -500, -500, { width: 300, height: 240 })).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 240
    });
  });

  it("clamps margin-constrained objects to the content box", () => {
    const settings = { width: 612, height: 792, marginTop: 54, marginRight: 54, marginBottom: 54, marginLeft: 54 };

    expect(sanitizePageObjectRect({ x: 600, y: 10, width: 170, height: 120 }, settings, true)).toEqual({
      x: 388,
      y: 54,
      width: 170,
      height: 120
    });
  });

  it("clamps margin-constrained resizing to the content box", () => {
    const settings = { width: 300, height: 240, marginTop: 20, marginRight: 30, marginBottom: 40, marginLeft: 10 };

    expect(resizePageObjectRect({ x: 100, y: 80, width: 120, height: 90 }, "nw", -500, -500, settings, true)).toEqual({
      x: 10,
      y: 20,
      width: 260,
      height: 180
    });
  });
});
