import { Module, DynamicModule, FactoryProvider } from "@nestjs/common";
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

/**
 * Build the configured OCR provider. ONE definition, used by the static module
 * and by forRoot/forRootAsync alike.
 *
 * It existed twice. The static `@Module` factory learned the `vision` case
 * (#1050); `forRoot` did not, and it hardcoded Tesseract without even reading
 * `ocr.provider`. Since `forRootAsync` builds on `forRoot`, the one module
 * registration that DOES supply a prompt supplier was the one that could never
 * select the provider needing it — so `OCR_PROVIDER=vision` booted clean,
 * reported healthy, attached the supplier to nothing, and ran Tesseract.
 *
 * Nothing errored, because nothing was wrong from any single file's point of
 * view. Two copies of a selection rule is the defect; this is the fix.
 */
function selectOcrProvider(
  configService: ConfigService,
  languages: string[],
  promptSupplier?: OcrPromptSupplier,
): IOcrProvider {
  const provider = configService.get<string>("ocr.provider") || "tesseract";

  if (provider.toLowerCase() === "vision") {
    if (!promptSupplier) {
      // Fail at boot, not per scan: without a prompt the provider cannot run
      // at all, and a per-scan failure would read as a model problem rather
      // than a wiring one.
      throw new Error(
        "OCR_PROVIDER=vision requires an OCR_PROMPT_SUPPLIER provider. " +
          "Register one via OcrModule.forRootAsync() in the consuming module — " +
          "prompt text is served from prompt-service and must never be inlined here.",
      );
    }
    return new VisionOcrProvider(
      configService.get<string>("ocr.vision.model") || "qwen2.5vl:7b",
      configService.get<string>("ocr.vision.url") || "http://localhost:11434",
      promptSupplier,
      configService.get<number>("ocr.vision.timeoutMs") ?? 120_000,
    );
  }

  return new TesseractOcrProvider(languages);
}

/** Supplies the transcription instruction; see VisionOcrProvider. */
export type OcrPromptSupplier = () => Promise<{
  promptText: string;
  promptHash: string;
  promptVersion: string;
}>;

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
        const languagesConfig = configService.get<string>("ocr.languages");
        const languages = languagesConfig
          ? languagesConfig.split(",").map((l) => l.trim())
          : ["eng"];
        return selectOcrProvider(configService, languages, promptSupplier);
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
   * Register the module with a prompt supplier resolved from the consuming
   * module's own providers (#1050).
   *
   * ── Why this exists rather than the consumer just registering the token ──
   *
   * NestJS resolves a module's factory dependencies within THAT module's
   * scope. Providing `OCR_PROMPT_SUPPLIER` in the consuming module does not
   * make it visible here — the static `OcrModule` still sees nothing and the
   * vision provider throws at boot. That is exactly how this was first wired,
   * and only starting the service revealed it.
   *
   * So the supplier is threaded in explicitly. `imports` lets the caller bring
   * whatever module owns the prompt client, without this package taking a
   * dependency on prompt-client — which matters, because the point of the
   * exercise is that prompt text lives in prompt-service, not in a package
   * that could be tempted to inline a default.
   */
  static forRootAsync(options: {
    imports?: DynamicModule["imports"];
    inject?: FactoryProvider["inject"];
    useFactory: (...args: never[]) => () => Promise<{
      promptText: string;
      promptHash: string;
      promptVersion: string;
    }>;
  }): DynamicModule {
    const base = OcrModule.forRoot();
    return {
      ...base,
      imports: [...(base.imports ?? []), ...(options.imports ?? [])],
      providers: [
        ...(base.providers ?? []),
        {
          provide: "OCR_PROMPT_SUPPLIER",
          useFactory: options.useFactory,
          inject: options.inject,
        } as FactoryProvider,
      ],
    };
  }

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
          useFactory: (
            configService: ConfigService,
            promptSupplier?: OcrPromptSupplier,
          ): IOcrProvider =>
            selectOcrProvider(configService, languages, promptSupplier),
          inject: [
            ConfigService,
            { token: "OCR_PROMPT_SUPPLIER", optional: true },
          ],
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
