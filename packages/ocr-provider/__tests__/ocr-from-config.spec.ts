import { createTesseractOcrServiceFromEnv } from "../src/ocr-from-config";

/**
 * What an env-built OCR service reports is what the S6 thread and the module
 * both feed the parse key (K-P1), so everything that changes OCR text must
 * change it. Helper parsing is covered in `ocr.module.spec.ts`.
 */
describe("createTesseractOcrServiceFromEnv — the parse key's inputs", () => {
  const info = (env: NodeJS.ProcessEnv) =>
    createTesseractOcrServiceFromEnv(env).getProviderInfo();

  it("reports the languages and preprocessing the module would", () => {
    expect(info({ OCR_LANGUAGES: "eng,spa" })).toMatchObject({
      supportedLanguages: expect.arrayContaining(["eng", "spa"]),
      preprocessingEnabled: true,
      preprocessing: { preset: "balanced" },
    });
  });

  it("differs by preset, so two hosts on different presets never share a parse", () => {
    expect(info({ OCR_PREPROCESSING_PRESET: "fast" })).not.toEqual(
      info({ OCR_PREPROCESSING_PRESET: "quality" }),
    );
    expect(info({ OCR_PREPROCESSING_PRESET: "fast" })).toEqual(
      info({ OCR_PREPROCESSING_PRESET: "fast" }),
    );
  });

  it("differs with preprocessing off", () => {
    expect(info({ OCR_PREPROCESSING_ENABLED: "false" })).not.toEqual(info({}));
  });
});
