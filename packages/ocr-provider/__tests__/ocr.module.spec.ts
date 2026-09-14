import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { OcrModule } from "../src/ocr.module";
import type { IOcrProvider } from "@opuspopuli/common";

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
});
