/**
 * OCR cross-check — run both readers on the same image and compare (E-24).
 *
 * See `scoring/divergence.ts` for why a worse OCR engine is worth running: it
 * cannot decide part of the page is uninteresting, so a token it read and the
 * vision model did not emit is a token that was on the page.
 *
 * This is the *calibration* step the v1.27.1 validation pack asked for before
 * the guard is wired into production. It deliberately does not ship a
 * threshold — see the note it prints.
 *
 * Usage:
 *   PROMPT_SERVICE_URL=... PROMPT_SERVICE_API_KEY=... \
 *     pnpm --filter @opuspopuli/eval-harness eval:divergence -- \
 *       [--vision-model qwen2.5vl:7b]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertFreshBuilds } from "./build-freshness.js";
import {
  scoreDivergence,
  calibrateDivergence,
  omissionSignal,
  type DivergenceResult,
} from "./scoring/divergence.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface ScanItem {
  id: string;
  gold: string;
  image: string;
  notes?: string;
}

/**
 * The SHIPPED Tesseract provider, including its preprocessing — not
 * `tesseract.js` directly.
 *
 * The guard is only meaningful if the second reader is the one production
 * would actually run. Calling the library directly would measure a different
 * pipeline (no deskew, no preprocessing) and produce a baseline that does not
 * describe the system the guard would protect.
 */
async function tesseractRead(imagePath: string): Promise<string> {
  const mod = await import("@opuspopuli/ocr-provider");
  const P = (
    mod as unknown as {
      TesseractOcrProvider: new () => {
        extractText(input: {
          type: "buffer";
          buffer: Buffer;
          mimeType: string;
        }): Promise<{ text: string }>;
      };
    }
  ).TesseractOcrProvider;
  const provider = new P();
  const out = await provider.extractText({
    type: "buffer",
    buffer: readFileSync(imagePath),
    mimeType: imagePath.endsWith(".png") ? "image/png" : "image/jpeg",
  });
  return out.text ?? "";
}

/**
 * Transcribe with the vision model, STREAMING.
 *
 * Not an optimisation — a correctness fix. Ollama sends no response headers on
 * a non-streaming request until generation has finished, and undici's
 * `headersTimeout` is 300s and is **not** governed by `AbortSignal.timeout`.
 * A cold vision model on a full-frame photograph exceeds that, and the failure
 * surfaces as a bare `fetch failed`, which reads as the server being down.
 *
 * Streaming makes headers arrive immediately, so the only limit that applies is
 * the gap between chunks. It is also what `OllamaLLMProvider` does, so this
 * matches the path production actually takes.
 */
async function visionRead(
  imagePath: string,
  model: string,
  prompt: string,
): Promise<string> {
  const url = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const image = readFileSync(imagePath).toString("base64");
  const timeoutMs = Number.parseInt(
    process.env.OCR_REQUEST_TIMEOUT_MS ?? "1800000",
    10,
  );

  let response: Response;
  try {
    response = await fetch(`${url}/api/generate`, {
      signal: AbortSignal.timeout(timeoutMs),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        images: [image],
        stream: true,
        // Mandatory on reasoning-capable models: with thinking on, qwen3.6
        // spent its whole budget reasoning and returned an EMPTY response,
        // which reads as model incompatibility and is one flag (#1142).
        think: false,
        options: { temperature: 0 },
      }),
    });
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    const detail = cause ? ` (${cause})` : "";
    throw new Error(
      `vision request to ${model} failed: ${(error as Error).message}${detail}.`,
    );
  }
  if (!response.ok || !response.body) {
    throw new Error(`ollama returned ${response.status} for ${model}`);
  }

  // NDJSON: one JSON object per line, each carrying a slice of the answer.
  let out = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { response?: string; done?: boolean };
      if (parsed.response) out += parsed.response;
    }
  }
  return out;
}

/**
 * The transcription instruction, from prompt-service.
 *
 * `getOcrTranscriptionPrompt` has no hardcoded fallback by design (#1246): an
 * unseeded service throws rather than quietly transcribing against a prompt
 * nobody published.
 */
async function loadPrompt(): Promise<{
  text: string;
  hash: string;
  version: string;
}> {
  const { DbService } = await import("@opuspopuli/relationaldb-provider");
  const { PromptClientService } = await import("@opuspopuli/prompt-client");
  const db = new DbService();
  try {
    const client = new PromptClientService(db, {
      promptServiceUrl: process.env.PROMPT_SERVICE_URL,
      promptServiceApiKey: process.env.PROMPT_SERVICE_API_KEY,
      hmacNodeId: process.env.PROMPT_SERVICE_NODE_ID,
    });
    const r = await client.getOcrTranscriptionPrompt({ variant: "document" });
    return {
      text: r.promptText,
      hash: r.promptHash,
      version: r.promptVersion,
    };
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  assertFreshBuilds();

  const argv = process.argv.slice(2);
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const visionModel =
    arg("vision-model") ?? process.env.OCR_VISION_MODEL ?? "qwen2.5vl:7b";

  const fixture = JSON.parse(
    readFileSync(join(ROOT, "fixtures/scans.json"), "utf8"),
  ) as { items: ScanItem[] };

  const prompt = await loadPrompt();

  const rows: Array<{
    id: string;
    notes?: string;
    divergence: DivergenceResult;
  }> = [];

  for (const item of fixture.items) {
    const imagePath = join(ROOT, "fixtures", item.image);
    if (!existsSync(imagePath)) {
      console.error(`missing image: ${item.image} — skipping ${item.id}`);
      continue;
    }

    process.stderr.write(`${item.id}: tesseract ... `);
    const tesseract = await tesseractRead(imagePath);
    process.stderr.write(`${tesseract.length}ch, vision ... `);
    const vlm = await visionRead(imagePath, visionModel, prompt.text);
    process.stderr.write(`${vlm.length}ch\n`);

    rows.push({
      id: item.id,
      notes: item.notes,
      divergence: scoreDivergence(tesseract, vlm),
    });
  }

  const cal = calibrateDivergence(rows.map((r) => r.divergence.omissionRate));

  const lines = [
    `vision=${visionModel}  tesseract=tesseract.js`,
    `prompt=ocr-transcription-document ${prompt.version} hash=${prompt.hash.slice(0, 12)}`,
    "",
    "scan                 tess tok  vlm tok  shared  omission  overlap  len ratio",
  ];
  for (const r of rows) {
    const d = r.divergence;
    lines.push(
      [
        r.id.padEnd(21),
        String(d.tesseractTokens).padStart(8),
        String(d.vlmTokens).padStart(9),
        String(d.shared).padStart(8),
        d.omissionRate.toFixed(3).padStart(10),
        d.overlap.toFixed(3).padStart(9),
        d.lengthRatio.toFixed(2).padStart(11),
      ].join(""),
    );
  }

  lines.push("", `CALIBRATION: ${cal.note}`);

  // Ask the guard for its verdict rather than reading the rates above as one.
  // It refuses until calibrated, which is the point: the refusal is what a
  // future reader wiring this into a gate should hit.
  const signals = rows.map((r) => ({
    id: r.id,
    signal: omissionSignal(r.divergence, cal),
  }));
  const [first] = signals;
  if (first && !first.signal.available) {
    lines.push(
      "",
      `GUARD: unavailable — ${first.signal.reason}`,
      "No threshold is emitted, and none should be inferred from these numbers.",
    );
  } else {
    for (const { id, signal } of signals) {
      lines.push(
        `${id.padEnd(21)} ${signal.flagged ? "FLAGGED" : "within baseline"} — ${signal.reason}`,
      );
    }
  }

  // The tokens Tesseract read and the VLM did not are the guard's actual
  // output. Showing a sample is how a reader judges whether the signal is
  // omission or Tesseract noise — which at this sample size they must do
  // themselves.
  for (const r of rows) {
    const sample = r.divergence.vlmMissing.slice(0, 12);
    if (sample.length) {
      lines.push(
        "",
        `${r.id} — read by tesseract, absent from the VLM (first ${sample.length}):`,
        `  ${sample.join(", ")}`,
      );
    }
  }

  console.log(`\n${lines.join("\n")}`);

  mkdirSync(join(ROOT, "results"), { recursive: true });
  const out = join(ROOT, "results", "divergence.json");
  writeFileSync(
    out,
    `${JSON.stringify({ ranAt: new Date().toISOString(), visionModel, prompt, rows, calibration: cal, signals }, null, 2)}\n`,
  );
  console.log(`\nwritten: ${out.replace(ROOT, ".")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
