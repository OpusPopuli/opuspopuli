import { Logger } from "@nestjs/common";
import {
  IOcrProvider,
  OcrInput,
  OcrResult,
  OcrError,
  UnsupportedMimeTypeError,
} from "@opuspopuli/common";

/**
 * Vision-language-model OCR, served by Ollama (#1050).
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Tesseract cannot read a phone photograph of a dense legal page well enough
 * for the product to work. Measured in production 2026-09-13 on five real
 * scans of the same petition: page confidence 27-42, four rejected outright as
 * `unreadable`, and the one that cleared the analysis gate was skipped before
 * retrieval. Match rate: zero of five.
 *
 * The same image through this provider, measured on the node against the live
 * propositions corpus with production's own embedding model: rank 1 on every
 * run, margin ~0.155, top-1 the correct measure. The capture was never the
 * problem — telemetry (#1049) showed detection confidence 1.0, the crop firing
 * every time, and sharpness ~20,000 against a floor of 40.
 *
 * ── Why the model is pinned separately from LLM_MODEL ────────────────────
 *
 * `OCR_VISION_MODEL`, deliberately NOT `LLM_MODEL`. Inference is moving to a
 * US-provenance model (OLMo) which has no vision capability at all; reusing
 * `LLM_MODEL` here would mean OCR silently breaking on the day that switch
 * happens — the exact "correct when written, wrong once something moved"
 * failure this codebase keeps hitting.
 *
 * Keeping it separate also makes the provenance boundary auditable: a
 * Qwen-derived model is confined to one declared job, named in one config
 * value, and every row records which engine produced it in
 * `documents.ocr_provider`.
 */
export class VisionOcrProvider implements IOcrProvider {
  private readonly logger = new Logger(VisionOcrProvider.name);

  private static readonly SUPPORTED_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
  ];

  constructor(
    private readonly model: string,
    private readonly baseUrl: string,
    /**
     * Supplies the transcription instruction. Injected rather than inlined:
     * prompt text lives in prompt-service, never in this repo (#1143, #1246).
     * Returning the hash and version alongside keeps the transcription
     * attributable to the exact instruction that produced it.
     */
    private readonly getPrompt: () => Promise<{
      promptText: string;
      promptHash: string;
      promptVersion: string;
    }>,
    private readonly timeoutMs = 120_000,
  ) {}

  getName(): string {
    return `vision:${this.model}`;
  }

  getSupportedLanguages(): string[] {
    // A VLM is not language-configured the way Tesseract is; it reads what is
    // on the page. Declared as the two the product actually serves.
    return ["eng", "spa"];
  }

  supportsMimeType(mimeType: string): boolean {
    return VisionOcrProvider.SUPPORTED_MIME_TYPES.includes(
      mimeType.toLowerCase(),
    );
  }

  supports(input: OcrInput): boolean {
    return this.supportsMimeType(input.mimeType);
  }

  async extractText(input: OcrInput): Promise<OcrResult> {
    if (!this.supports(input)) {
      throw new UnsupportedMimeTypeError(input.mimeType, this.getName());
    }

    const started = Date.now();
    const prompt = await this.getPrompt();
    const text = await this.generate(input, prompt.promptText);
    const processingTimeMs = Date.now() - started;

    const confidence = readabilityScore(text);
    this.logger.log(
      `Vision OCR completed: ${text.length} chars, ` +
        `${confidence.toFixed(1)}% readable, ${processingTimeMs}ms ` +
        `(${this.model}, prompt ${prompt.promptVersion})`,
    );

    return {
      text,
      // A VLM emits no per-word geometry or per-word confidence. Returning an
      // empty array is the honest representation: callers that need word boxes
      // (the signature-block scrub) must not silently receive a fabricated one.
      blocks: [],
      confidence,
      provider: this.getName(),
      processingTimeMs,
    };
  }

  private async generate(input: OcrInput, promptText: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          prompt: promptText,
          images: [toBase64(input)],
          stream: false,
          // Non-negotiable on a reasoning-capable model. Measured on the node:
          // with thinking on, qwen3.6 spent its entire 1400-token budget
          // reasoning and returned an EMPTY response with done_reason=length —
          // a total failure that looks like a model incompatibility and is
          // actually a single flag.
          think: false,
          options: {
            temperature: 0.1,
            // Sized for a full page. Too low truncates mid-document and the
            // truncation is invisible: the text simply stops.
            num_predict: 2400,
            // These models loop a sentence when transcribing repetitive forms.
            repeat_penalty: 1.15,
          },
        }),
      });

      if (!res.ok) {
        throw new OcrError(
          this.getName(),
          new Error(`request failed: ${res.status} ${await res.text()}`),
        );
      }

      const body = (await res.json()) as {
        response?: string;
        done_reason?: string;
      };
      const text = (body.response ?? "").trim();

      if (!text) {
        throw new OcrError(
          this.getName(),
          new Error(
            `model returned no text (done_reason=${body.done_reason}). ` +
              `A reasoning model with thinking enabled exhausts its token ` +
              `budget before emitting any transcription.`,
          ),
        );
      }

      return text;
    } catch (err) {
      if (err instanceof OcrError) throw err;
      throw new OcrError(
        this.getName(),
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * A readability score for text a VLM produced, on Tesseract's 0-100 scale.
 *
 * ── Why this is not a confidence ─────────────────────────────────────────
 *
 * `OcrResult.confidence` is defined as a per-word recognition confidence, and
 * a VLM has no such thing — it emits tokens, not scored glyphs. Returning a
 * constant would be worse than useless: it would sail through the downstream
 * gates while telling the reader nothing, and the first garbled transcription
 * would be indistinguishable from a perfect one.
 *
 * So this measures the property those gates were really reaching for — is this
 * text, or is it noise? — using the one signal available: the proportion of
 * output that looks like words rather than OCR debris. It is reported on the
 * same 0-100 scale so it is comparable in a log line, and it is named
 * `readability` everywhere it is discussed so nobody mistakes it for a
 * calibrated confidence.
 *
 * Gate thresholds calibrated against Tesseract's scale do NOT transfer to it.
 * That is why the vision path carries its own threshold — see
 * MIN_VISION_READABILITY in the analysis and retrieval services.
 */
/**
 * The model wants base64, and half the callers already have it — so the
 * base64 branch costs nothing rather than round-tripping through a Buffer.
 */
function toBase64(input: OcrInput): string {
  return input.type === "base64" ? input.data : input.buffer.toString("base64");
}

export function readabilityScore(text: string): number {
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;

  const wordLike = tokens.filter((token) => {
    const stripped = token.replace(/[^\p{L}\p{N}]/gu, "");
    if (stripped.length === 0) return false;
    // Pure numbers are legitimate on a petition (dates, section numbers).
    if (/^\p{N}+$/u.test(stripped)) return true;
    // Otherwise: at least two letters and a vowel. OCR debris like "|]l~"
    // and "rrn" fails this; real words pass it in English and Spanish.
    return (
      stripped.length >= 2 &&
      /\p{L}{2}/u.test(stripped) &&
      /[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]/u.test(stripped)
    );
  }).length;

  return Math.round((wordLike / tokens.length) * 1000) / 10;
}
