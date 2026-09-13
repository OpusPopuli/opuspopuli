/**
 * Minimal `ImageData` declaration for the Node-side harness.
 *
 * `detect-probe.ts` runs the FRONTEND's document detector — the real
 * `analyzeFrame`, not a reimplementation, because a reimplementation would
 * measure a detector production does not run. Those modules take a browser
 * `ImageData`, which has no declaration in a package whose `lib` is ES2022.
 *
 * Declared narrowly here instead of adding "DOM" to `lib`. Adding the DOM
 * library would make `document`, `window` and every other browser global
 * typecheck clean in a Node package where they are all undefined at runtime —
 * turning a compile error into a crash, in a harness whose entire job is to be
 * trusted about what it measured.
 *
 * The runtime side is already handled: detect-probe installs an `ImageData`
 * shim on `globalThis` before importing anything that constructs one.
 */
declare interface ImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "srgb" | "display-p3";
}

declare const ImageData: {
  prototype: ImageData;
  new (data: Uint8ClampedArray, width: number, height: number): ImageData;
};
