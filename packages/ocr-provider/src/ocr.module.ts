import { Module, DynamicModule } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IOcrProvider } from "@qckstrt/common";
import { OcrService } from "./ocr.service.js";
import { TesseractOcrProvider } from "./providers/tesseract.provider.js";

/**
 * OCR Module Configuration
 */
export interface OcrModuleConfig {
  /** Languages for OCR recognition (ISO 639-3 codes, e.g., ['eng', 'spa']) */
  languages?: string[];
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

    // Main OCR service
    {
      provide: OcrService,
      useFactory: (provider: IOcrProvider) => {
        return new OcrService(provider);
      },
      inject: ["OCR_PROVIDER"],
    },
  ],
  exports: [OcrService, "OCR_PROVIDER"],
})
export class OcrModule {
  /**
   * Configure the module with custom options (for testing or direct usage)
   */
  static forRoot(config: OcrModuleConfig = {}): DynamicModule {
    const languages = config.languages || ["eng"];

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
          provide: OcrService,
          useFactory: (provider: IOcrProvider) => {
            return new OcrService(provider);
          },
          inject: ["OCR_PROVIDER"],
        },
      ],
      exports: [OcrService, "OCR_PROVIDER"],
    };
  }
}
