import { Global, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { OcrModule } from "../src/ocr.module";
import {
  METRICS_OBSERVER,
  type IOcrProvider,
  type MetricsObserver,
} from "@opuspopuli/common";
import { OcrService } from "../src/ocr.service";

/**
 * #1050. The bug these exist for shipped to production and booted clean.
 *
 * `OcrModule` carried the provider-selection rule TWICE — once in the static
 * `@Module` factory and once in `forRoot`. The static copy learned the
 * `vision` case; `forRoot` did not, and hardcoded Tesseract without even
 * reading `ocr.provider`. Because `forRootAsync` builds on `forRoot`, the one
 * registration that DOES supply a prompt supplier was the only one that could
 * never select the provider needing it.
 *
 * Result: `OCR_PROVIDER=vision` started healthy, logged "OcrModule
 * dependencies initialized", attached the supplier to nothing, and ran
 * Tesseract. Every check passed. The deploy verification passed. Nothing was
 * wrong from any single file's point of view.
 *
 * So these assert the provider that was SELECTED, never that the module
 * merely started.
 */
describe("OcrModule provider selection", () => {
  const supplier = () =>
    Promise.resolve({
      promptText: "Transcribe.",
      promptHash: "abc",
      promptVersion: "v1",
    });

  const build = async (env: Record<string, string>, useAsync: boolean) => {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
      const mod = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
          useAsync
            ? OcrModule.forRootAsync({ useFactory: () => supplier })
            : OcrModule.forRoot(),
        ],
      }).compile();
      return mod.get<IOcrProvider>("OCR_PROVIDER");
    } finally {
      process.env = prev;
    }
  };

  describe("forRootAsync — the path documents uses", () => {
    it("SELECTS the vision provider, not merely boots", async () => {
      const provider = await build({ OCR_PROVIDER: "vision" }, true);

      expect(provider.getName()).toMatch(/^vision:/);
    });

    it("still selects Tesseract when not configured for vision", async () => {
      const provider = await build({ OCR_PROVIDER: "tesseract" }, true);

      expect(provider.getName()).toBe("Tesseract");
    });
  });

  describe("forRoot — must not diverge from the static module", () => {
    it("reads ocr.provider rather than hardcoding Tesseract", async () => {
      // forRoot has no supplier, so vision must THROW rather than silently
      // downgrade. A silent downgrade is precisely what shipped.
      await expect(build({ OCR_PROVIDER: "vision" }, false)).rejects.toThrow(
        /OCR_PROMPT_SUPPLIER/,
      );
    });

    it("selects Tesseract by default", async () => {
      const provider = await build({}, false);

      expect(provider.getName()).toBe("Tesseract");
    });
  });

  it("honours the configured vision model", async () => {
    const provider = await build(
      { OCR_PROVIDER: "vision", OCR_VISION_MODEL: "qwen2.5vl:7b" },
      true,
    );

    expect(provider.getName()).toBe("vision:qwen2.5vl:7b");
  });
  describe("metrics observer reaches the service through DI", () => {
    /**
     * The same shape of bug as #1050, found live on 2026-10-22.
     *
     * `OcrService` takes the observer as an `@Optional() @Inject()`
     * constructor parameter, and BOTH module registrations build it with a
     * `useFactory`. A factory supplies arguments positionally and ignores
     * parameter decorators entirely, so the decorator compiled, the module
     * booted, the class tests passed — and the `ocr` stage recorded nothing
     * through a live sync that was visibly preprocessing images.
     *
     * Constructing `OcrService` directly cannot catch that; only resolving it
     * from the module can. So this asserts an observation ARRIVES, never that
     * the module merely started.
     */
    const metricsModule = (observer: MetricsObserver) => {
      @Global()
      @Module({
        providers: [{ provide: METRICS_OBSERVER, useValue: observer }],
        exports: [METRICS_OBSERVER],
      })
      class TestMetricsModule {}
      return TestMetricsModule;
    };

    const buildWithObserver = async (useAsync: boolean) => {
      const observed: string[] = [];
      const observer: MetricsObserver = {
        observe: (metric) => observed.push(metric),
        increment: () => undefined,
      };
      const prev = { ...process.env };
      Object.assign(process.env, { OCR_PROVIDER: "tesseract" });
      try {
        // OCR_PROVIDER is stubbed: this test is about the module WIRING, and
        // a real Tesseract would try to load language data and hang.
        const stub: IOcrProvider = {
          extractText: () =>
            Promise.resolve({
              text: "stub",
              blocks: [],
              confidence: 100,
              provider: "stub",
              processingTimeMs: 1,
            }),
          supports: () => true,
          supportsMimeType: () => true,
          getName: () => "stub",
          getSupportedLanguages: () => ["eng"],
        } as unknown as IOcrProvider;

        const mod = await Test.createTestingModule({
          imports: [
            ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
            // GLOBAL, as MetricsModule is in production. A provider declared
            // in the testing module's own `providers` is not visible inside
            // OcrModule's scope, so the optional inject resolves to undefined
            // and the test passes or fails for the wrong reason.
            metricsModule(observer),
            useAsync
              ? OcrModule.forRootAsync({ useFactory: () => supplier })
              : OcrModule.forRoot(),
          ],
        })
          .overrideProvider("OCR_PROVIDER")
          .useValue(stub)
          .compile();
        return { service: mod.get(OcrService), observed };
      } finally {
        process.env = prev;
      }
    };

    it.each([
      ["forRoot", false],
      ["forRootAsync", true],
    ])(
      "%s times the extraction as the `ocr` stage",
      async (_name, useAsync) => {
        const { service, observed } = await buildWithObserver(
          useAsync as boolean,
        );

        // Tesseract on a 1x1 buffer: the result does not matter, only that the
        // stage was measured around whatever happened.
        await service
          .extractText({
            type: "buffer",
            buffer: Buffer.from("not-an-image"),
            mimeType: "image/png",
          })
          .catch(() => undefined);

        expect(observed).toContain("pipeline_stage_duration_seconds");
      },
    );
  });
});

describe("OCR configured from env (S6 CPU-lane threads)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    createImagePreprocessor,
    parseOcrLanguages,
  } = require("../src/ocr-from-config");

  it("switches preprocessing off for the boolean false ocrConfig produces, not only the string", () => {
    // The module compared ocrConfig's BOOLEAN to the string "false", so
    // OCR_PREPROCESSING_ENABLED=false never turned it off.
    expect(createImagePreprocessor(false, "balanced")).toBeUndefined();
    expect(createImagePreprocessor("false", "balanced")).toBeUndefined();
    expect(createImagePreprocessor(true, "balanced")).toBeDefined();
    expect(createImagePreprocessor(undefined, undefined)).toBeDefined();
  });

  it("parses the language list, defaulting to English", () => {
    expect(parseOcrLanguages(undefined)).toEqual(["eng"]);
    expect(parseOcrLanguages(" eng , spa ")).toEqual(["eng", "spa"]);
    expect(parseOcrLanguages(",")).toEqual(["eng"]);
  });
});
