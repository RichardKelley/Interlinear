import type { InterlinearApi } from "../electron/preload";

declare global {
  interface Window {
    interlinear?: InterlinearApi;
  }
}

export {};
