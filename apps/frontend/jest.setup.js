import "@testing-library/jest-dom";
import "@/lib/i18n";

/**
 * jsdom provides no ImageData, but the vision code under test constructs one —
 * `deskewImageData` and the #1075 signature crop both do. Shimming it here
 * rather than per-file keeps production code using the real constructor, which
 * is what browsers need for `putImageData`.
 */
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(a, b, c) {
      if (typeof a === "number") {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a;
        this.width = b;
        this.height = c;
      }
      this.colorSpace = "srgb";
    }
  };
}

/**
 * jsdom has no ResizeObserver. `DocumentFrameOverlay` uses one to measure the
 * viewfinder, because the #1075 exclusion band is bounded by the on-screen
 * guide box and so has to be positioned in container pixels rather than camera
 * pixels. Without this shim the component silently skips its measure effect and
 * the band never renders — the band's tests would pass vacuously by asserting
 * on an element that was never going to appear.
 *
 * Layout is inert in jsdom, so tests that need a measured container also stub
 * clientWidth/clientHeight; this only supplies the observer itself.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      this.callback([], this);
    }
    unobserve() {}
    disconnect() {}
  };
}
