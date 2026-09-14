import {
  VisionOcrProvider,
  readabilityScore,
} from "../src/providers/vision.provider";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@nestjs/common", () => ({
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

const prompt = jest.fn().mockResolvedValue({
  promptText: "Transcribe all readable text.",
  promptHash: "abc123",
  promptVersion: "v1",
});

const ok = (response: string, extra: Record<string, unknown> = {}) => ({
  ok: true,
  json: () => Promise.resolve({ response, done_reason: "stop", ...extra }),
});

const input = {
  type: "buffer" as const,
  buffer: Buffer.from("fake-image"),
  mimeType: "image/jpeg",
};

describe("VisionOcrProvider", () => {
  let provider: VisionOcrProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new VisionOcrProvider(
      "qwen2.5vl:7b",
      "http://localhost:11434",
      prompt,
    );
  });

  const bodyOf = () => JSON.parse(mockFetch.mock.calls[0][1].body);

  it("names itself by model, so the row records which engine read the page", () => {
    // documents.ocr_provider is the attestation: a transcription that cannot
    // say which engine produced it is not evidence.
    expect(provider.getName()).toBe("vision:qwen2.5vl:7b");
  });

  it("sends the image and the prompt from prompt-service", async () => {
    mockFetch.mockResolvedValueOnce(ok("SECTION 1. FINDINGS."));

    await provider.extractText(input);

    expect(prompt).toHaveBeenCalled();
    expect(bodyOf().prompt).toBe("Transcribe all readable text.");
    expect(bodyOf().images).toEqual([
      Buffer.from("fake-image").toString("base64"),
    ]);
  });

  /**
   * Measured on the node: with thinking enabled, a reasoning-capable model
   * spent its ENTIRE token budget reasoning and returned an empty response
   * with done_reason=length. It reads as a broken model and is one flag.
   */
  it("disables thinking, which otherwise consumes the whole budget", async () => {
    mockFetch.mockResolvedValueOnce(ok("text"));

    await provider.extractText(input);

    expect(bodyOf().think).toBe(false);
  });

  it("fails loudly when the model returns nothing, naming the cause", async () => {
    mockFetch.mockResolvedValueOnce(ok("", { done_reason: "length" }));

    await expect(provider.extractText(input)).rejects.toThrow(/no text/);
  });

  it("accepts base64 input without a Buffer round-trip", async () => {
    mockFetch.mockResolvedValueOnce(ok("text"));

    await provider.extractText({
      type: "base64",
      data: "QUJD",
      mimeType: "image/png",
    });

    expect(bodyOf().images).toEqual(["QUJD"]);
  });

  it("rejects a MIME type it cannot read", async () => {
    await expect(
      provider.extractText({ ...input, mimeType: "application/pdf" }),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  /**
   * A VLM emits no per-word geometry. Returning [] is the honest answer —
   * the signature-block scrub reads blocks, and a fabricated box would put
   * a stranger's name back in play while looking like it had been handled.
   */
  it("returns no text blocks rather than inventing them", async () => {
    mockFetch.mockResolvedValueOnce(ok("some text here"));

    const result = await provider.extractText(input);

    expect(result.blocks).toEqual([]);
  });
});

describe("readabilityScore", () => {
  /**
   * Anchored to values measured on the node, 2026-09-13, same petition.
   * If this drifts, the floors in ocr-quality.ts stop meaning what they were
   * set to mean.
   */
  it("scores a real transcription high", () => {
    const real =
      "INITIATIVE MEASURE TO BE SUBMITTED DIRECTLY TO THE VOTERS. " +
      "The Attorney General of California has prepared the following " +
      "circulating title and summary of the chief purpose and points of " +
      "the proposed measure.";

    expect(readabilityScore(real)).toBeGreaterThan(90);
  });

  it("scores OCR debris low", () => {
    expect(readabilityScore("|]l~ rrn |_| ~~ }{ 1| /\\/ ,,, ;;")).toBeLessThan(
      30,
    );
  });

  it("counts bare numbers as legitimate, not debris", () => {
    // Dates and section numbers are real content on a petition.
    expect(readabilityScore("SECTION 3 2026 1988 amended")).toBeGreaterThan(90);
  });

  it("returns 0 for empty text rather than dividing by zero", () => {
    expect(readabilityScore("")).toBe(0);
    expect(readabilityScore("   ")).toBe(0);
  });

  it("handles Spanish accents, which the product serves", () => {
    expect(readabilityScore("elección medida constitución votantes")).toBe(100);
  });
});
