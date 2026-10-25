import type {
  PreprocessingConfig,
  PreprocessingPreset,
} from "./preprocessing/types.js";
import { ImagePreprocessor } from "./preprocessing/image-preprocessor.js";
import { getPipelineForPreset } from "./preprocessing/presets.js";
import { TesseractOcrProvider } from "./providers/tesseract.provider.js";
import { OcrService } from "./ocr.service.js";

/** `OCR_LANGUAGES` / `ocr.languages`: comma-separated, default English. */
export function parseOcrLanguages(value: string | undefined): string[] {
  const languages = (value ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return languages.length > 0 ? languages : ["eng"];
}

/**
 * The preprocessor `ocr.preprocessing` describes, or undefined when it is off.
 *
 * `enabled` arrives as a BOOLEAN from `ocrConfig` (which already applied
 * `!== "false"` to the env var) and as a string from a raw env read. Comparing
 * the boolean to the string `"false"` — as this used to — is always unequal,
 * so `OCR_PREPROCESSING_ENABLED=false` never switched preprocessing off.
 */
export function createImagePreprocessor(
  enabled: boolean | string | undefined,
  preset: string | undefined,
): ImagePreprocessor | undefined {
  if (enabled === false || enabled === "false") return undefined;
  const chosen = (preset || "balanced") as PreprocessingPreset;
  const config: PreprocessingConfig = {
    enabled: true,
    preset: chosen,
    pipeline: getPipelineForPreset(chosen),
  };
  return new ImagePreprocessor(config);
}

/**
 * A Tesseract `OcrService` built from the OCR env vars, without Nest — for a
 * worker thread (the S6 CPU lane) that must OCR exactly as `OcrModule`
 * configures the main process, so both report the same `getProviderInfo()`
 * and therefore the same parse key. Tesseract only: `OCR_PROVIDER=vision`
 * is an LLM call, not CPU work, and needs prompt-service.
 */
export function createTesseractOcrServiceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OcrService {
  return new OcrService(
    new TesseractOcrProvider(parseOcrLanguages(env.OCR_LANGUAGES)),
    createImagePreprocessor(
      env.OCR_PREPROCESSING_ENABLED,
      env.OCR_PREPROCESSING_PRESET,
    ),
  );
}
