import { Module, DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IOcrProvider } from "@qckstrt/common";
import { OcrService } from "./ocr.service.js";
import { TesseractOcrProvider } from "./providers/tesseract.provider.js";
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
 * - AWS Textract (cloud, paid, high accuracy) - future
 * - Google Vision (cloud, paid, high accuracy) - future
 *
 * Preprocessing can be enabled via configuration:
 * - OCR_PREPROCESSING_ENABLED: true/false (default: true)
 * - OCR_PREPROCESSING_PRESET: fast/balanced/quality (default: balanced)
 */
@Module({
  providers: [
    // OCR provider selection
    {
      provide: "OCR_PROVIDER",
      useFactory: (configService: ConfigService): IOcrProvider => {
        const provider =
          configService.get<string>("ocr.provider") || "tesseract";
        const languagesConfig = configService.get<string>("ocr.languages");
        const languages = languagesConfig
          ? languagesConfig.split(",").map((l) => l.trim())
          : ["eng"];

        switch (provider.toLowerCase()) {
          case "tesseract":
          default:
            return new TesseractOcrProvider(languages);
        }
      },
      inject: [ConfigService],
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
