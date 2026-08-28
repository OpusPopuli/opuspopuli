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
