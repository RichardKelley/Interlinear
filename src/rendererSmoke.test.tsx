import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("renderer launch smoke", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "interlinear", {
      configurable: true,
      value: undefined
    });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("loads the editor shell, ribbon, page canvas, and inspector without runtime errors", () => {
    const { container, unmount } = render(<App />);

    expect(screen.getByRole("region", { name: "Document" })).toBeInTheDocument();
    expect(container.querySelector(".ribbon")).toBeInTheDocument();
    expect(container.querySelector(".editor-shell")).toBeInTheDocument();
    expect(container.querySelector(".page")).toBeInTheDocument();
    expect(container.querySelector(".word-box")).not.toBeInTheDocument();
    expect(container.querySelector(".inspector")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save As document" })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();

    unmount();
  });
});
