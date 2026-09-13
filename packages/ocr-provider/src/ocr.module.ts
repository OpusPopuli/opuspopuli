import { Module, DynamicModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { IOcrProvider } from "@opuspopuli/common";
import { ocrConfig } from "@opuspopuli/config-provider";
import { OcrService } from "./ocr.service.js";
import { TesseractOcrProvider } from "./providers/tesseract.provider.js";
import { VisionOcrProvider } from "./providers/vision.provider.js";
import { ImagePreprocessor } from "./preprocessing/image-preprocessor.js";
import {
  PreprocessingConfig,
  PreprocessingPreset,
} from "./preprocessing/types.js";
import { getPipelineForPreset } from "./preprocessing/presets.js";

/**
 * OCR Module Configuration
 */
export interface OcrModuleConfig {
  /** Languages for OCR recognition (ISO 639-3 codes, e.g., ['eng', 'spa']) */
  languages?: string[];
  /** Preprocessing configuration */
  preprocessing?: Partial<PreprocessingConfig>;
}

/**
 * OCR Module
 *
 * Configures Dependency Injection for OCR providers.
 *
 * To swap providers, change the OCR_PROVIDER factory:
 * - Tesseract (default, OSS, in-process, no external services)
 * - Vision (OCR_PROVIDER=vision) — a local vision-language model via Ollama.
 *   Reads phone photographs of dense legal text that Tesseract cannot; see
 *   VisionOcrProvider for the production measurements. Requires the app to
 *   register an OCR_PROMPT_SUPPLIER (prompt text never lives in this repo).
 * - Google Vision (cloud, paid, high accuracy) - future
 *
 * Preprocessing can be enabled via configuration:
 * - OCR_PREPROCESSING_ENABLED: true/false (default: true)
 * - OCR_PREPROCESSING_PRESET: fast/balanced/quality (default: balanced)
 */
@Module({
  imports: [ConfigModule.forFeature(ocrConfig)],
  providers: [
    // OCR provider selection
    {
      provide: "OCR_PROVIDER",
      useFactory: (
        configService: ConfigService,
        promptSupplier?: () => Promise<{
          promptText: string;
          promptHash: string;
          promptVersion: string;
        }>,
      ): IOcrProvider => {
        const provider =
          configService.get<string>("ocr.provider") || "tesseract";
        const languagesConfig = configService.get<string>("ocr.languages");
        const languages = languagesConfig
          ? languagesConfig.split(",").map((l) => l.trim())
          : ["eng"];

        switch (provider.toLowerCase()) {
          case "vision": {
            if (!promptSupplier) {
              // Fail at boot, not per scan. Without a prompt the provider
              // cannot run at all, and a per-scan failure would look like a
              // model problem rather than a wiring one.
              throw new Error(
                "OCR_PROVIDER=vision requires an OCR_PROMPT_SUPPLIER provider. " +
                  "Register one in the consuming module — prompt text is served " +
                  "from prompt-service and must never be inlined here.",
              );
            }
            return new VisionOcrProvider(
              configService.get<string>("ocr.vision.model") || "qwen2.5vl:7b",
              configService.get<string>("ocr.vision.url") ||
                "http://localhost:11434",
              promptSupplier,
              configService.get<number>("ocr.vision.timeoutMs") ?? 120_000,
            );
          }
          case "tesseract":
          default:
            return new TesseractOcrProvider(languages);
        }
      },
      inject: [ConfigService, { token: "OCR_PROMPT_SUPPLIER", optional: true }],
    },

    // Image preprocessor
    {
      provide: ImagePreprocessor,
      useFactory: (configService: ConfigService): ImagePreprocessor | null => {
        const enabled =
          configService.get<string>("ocr.preprocessing.enabled") !== "false";

        if (!enabled) {
          return null as unknown as ImagePreprocessor;
        }

        const preset =
          (configService.get<string>(
            "ocr.preprocessing.preset",
          ) as PreprocessingPreset) || "balanced";

        const config: PreprocessingConfig = {
          enabled: true,
          preset,
          pipeline: getPipelineForPreset(preset),
        };

        return new ImagePreprocessor(config);
      },
      inject: [ConfigService],
    },

    // Main OCR service
    {
      provide: OcrService,
      useFactory: (
        provider: IOcrProvider,
        preprocessor: ImagePreprocessor | null,
      ) => {
        return new OcrService(provider, preprocessor || undefined);
      },
      inject: ["OCR_PROVIDER", ImagePreprocessor],
    },
  ],
  exports: [OcrService, "OCR_PROVIDER", ImagePreprocessor],
})
export class OcrModule {
  /**
   * Configure the module with custom options (for testing or direct usage)
   */
  static forRoot(config: OcrModuleConfig = {}): DynamicModule {
    const languages = config.languages || ["eng"];
    const preprocessingEnabled = config.preprocessing?.enabled !== false;
    const preset = config.preprocessing?.preset || "balanced";

    return {
      module: OcrModule,
      providers: [
        {
          provide: "OCR_PROVIDER",
          useFactory: (): IOcrProvider => {
            return new TesseractOcrProvider(languages);
          },
        },
        {
          provide: ImagePreprocessor,
          useFactory: (): ImagePreprocessor | null => {
            if (!preprocessingEnabled) {
              return null as unknown as ImagePreprocessor;
            }

            const preprocessingConfig: PreprocessingConfig = {
              enabled: true,
              preset,
              pipeline:
                config.preprocessing?.pipeline || getPipelineForPreset(preset),
              globalOptions: config.preprocessing?.globalOptions,
            };

            return new ImagePreprocessor(preprocessingConfig);
          },
        },
        {
          provide: OcrService,
          useFactory: (
            provider: IOcrProvider,
            preprocessor: ImagePreprocessor | null,
          ) => {
            return new OcrService(provider, preprocessor || undefined);
          },
          inject: ["OCR_PROVIDER", ImagePreprocessor],
        },
      ],
      exports: [OcrService, "OCR_PROVIDER", ImagePreprocessor],
    };
  }
}
