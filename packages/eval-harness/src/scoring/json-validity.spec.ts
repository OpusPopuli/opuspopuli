import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scoreJsonValidity, looksTruncated } from "./json-validity.js";

const BUDGET = 6000; // PROPOSITION_ANALYSIS_MAX_TOKENS

describe("looksTruncated", () => {
  test("believes an explicit length finish reason", () => {
    assert.equal(
      looksTruncated({ text: "x", finishReason: "length", maxTokens: BUDGET }),
      true,
    );
  });

  test("infers truncation from a spent budget when the reason is missing", () => {
    // Older Ollama builds omit done_reason, and the provider used to map it
    // from `done` — true whenever generation finished for any reason at all.
    assert.equal(
      looksTruncated({ text: "x", tokensOut: 5990, maxTokens: BUDGET }),
      true,
    );
  });

  test("does not call a short, complete answer truncated", () => {
    assert.equal(
      looksTruncated({
        text: "x",
        finishReason: "stop",
        tokensOut: 900,
        maxTokens: BUDGET,
      }),
      false,
    );
  });
});

describe("scoreJsonValidity", () => {
  test("accepts a clean payload", () => {
    const r = scoreJsonValidity({
      text: '{"analysisSummary":"A summary.","keyProvisions":["one"]}',
      finishReason: "stop",
      maxTokens: BUDGET,
    });
    assert.equal(r.verdict, "valid");
    assert.equal(r.payload?.analysisSummary, "A summary.");
  });

  test("finds the object inside prose the model wrapped around it", () => {
    const r = scoreJsonValidity({
      text: 'Here is the analysis:\n```json\n{"analysisSummary":"A summary."}\n```\nHope that helps.',
      finishReason: "stop",
      maxTokens: BUDGET,
    });
    assert.equal(r.verdict, "valid");
  });

  test("diagnoses an empty response on its own terms", () => {
    // The #1142 configuration failure: with reasoning on, qwen3.5:9b spent the
    // whole budget thinking and returned nothing. Folding this into "no-json"
    // reads as a model that cannot follow a format instruction, which is what
    // sent the first run to the wrong conclusion.
    const r = scoreJsonValidity({
      text: "",
      finishReason: "length",
      tokensOut: BUDGET,
      maxTokens: BUDGET,
    });
    assert.equal(r.verdict, "empty-response");
    assert.equal(r.valid, false);
  });

  test("separates a budget cut-off from a model that wrote no JSON", () => {
    const cutOff = scoreJsonValidity({
      text: '{"analysisSummary":"A long summary that never clo',
      finishReason: "length",
      maxTokens: BUDGET,
    });
    assert.equal(cutOff.verdict, "truncated");

    const prose = scoreJsonValidity({
      text: "I am unable to analyse this measure.",
      finishReason: "stop",
      maxTokens: BUDGET,
    });
    assert.equal(prose.verdict, "no-json");
  });

  test("reports malformed JSON that was not truncated as a parse error", () => {
    const r = scoreJsonValidity({
      text: '{"analysisSummary": "unterminated, }',
      finishReason: "stop",
      maxTokens: BUDGET,
    });
    assert.ok(r.verdict === "parse-error" || r.verdict === "no-json");
    assert.equal(r.valid, false);
  });

  test("records response length on every verdict", () => {
    const r = scoreJsonValidity({
      text: "not json",
      finishReason: "stop",
      maxTokens: BUDGET,
    });
    assert.equal(r.responseChars, "not json".length);
  });
});
