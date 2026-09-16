import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildProvenance,
  describeProvenance,
  slugFor,
  assertComparable,
  assertThinkDecided,
  type ModelProvenance,
} from "./provenance.js";

/**
 * Trimmed from a real `/api/show` for qwen3.5:9b on ollama 0.18.0. The parser
 * is what is under test, so the fixture keeps the fields it reads and drops
 * the ~40 architecture entries and the tensor list.
 */
const SHOW_QWEN = {
  details: {
    parent_model: "",
    format: "gguf",
    family: "qwen35",
    families: ["qwen35"],
    parameter_size: "9.7B",
    quantization_level: "Q4_K_M",
  },
  model_info: {
    "general.architecture": "qwen35",
    "general.file_type": 15,
    "general.parameter_count": 9653104368,
    "general.quantization_version": 2,
  },
  capabilities: ["completion", "vision", "tools", "thinking"],
};

const qwen = (): ModelProvenance =>
  buildProvenance(
    "qwen3.5:9b",
    SHOW_QWEN,
    "6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7",
    "0.18.0",
    "http://localhost:11434",
  );

describe("buildProvenance", () => {
  test("records quantization, architecture and exact parameter count", () => {
    const p = qwen();
    assert.equal(p.quantization, "Q4_K_M");
    assert.equal(p.architecture, "qwen35");
    assert.equal(p.parameterCount, 9653104368);
    assert.equal(p.parameterSize, "9.7B");
  });

  test("truncates the digest — the pin a tag is not", () => {
    assert.equal(qwen().digest, "6488c96fa5faab64");
  });

  test("strips a sha256 prefix from the digest", () => {
    const p = buildProvenance(
      "m",
      SHOW_QWEN,
      "sha256:abcdef0123456789abcdef",
      "0.18.0",
      "u",
    );
    assert.equal(p.digest, "abcdef0123456789");
  });

  test("records a missing digest as unknown rather than omitting it", () => {
    // The absence is itself something a reader of the result should see.
    const p = buildProvenance("m", SHOW_QWEN, undefined, "0.18.0", "u");
    assert.equal(p.digest, "unknown");
  });

  test("reports quantization it cannot determine as unknown", () => {
    // Real case: community GGUF builds report `unknown`, and a broken vision
    // build is indistinguishable from a working one by metadata alone.
    const p = buildProvenance(
      "hf.co/some/Community-GGUF:Q8_0",
      { details: { family: "qwen3", parameter_size: "8.19B" } },
      "7c20992caba5e121",
      "0.18.0",
      "u",
    );
    assert.equal(p.quantization, "unknown");
    assert.equal(p.architecture, "qwen3");
    assert.equal(p.parameterCount, undefined);
  });

  test("records the runtime, not just the model", () => {
    const p = qwen();
    assert.equal(p.runtime.name, "ollama");
    assert.equal(p.runtime.version, "0.18.0");
  });
});

describe("describeProvenance / slugFor", () => {
  test("names model, quantization and runtime together", () => {
    assert.equal(describeProvenance(qwen()), "qwen3.5:9b@Q4_K_M/ollama-0.18.0");
  });

  test("produces a filename-safe slug that carries the quantization", () => {
    // Two quantizations of one model must not overwrite each other's results.
    assert.equal(slugFor(qwen()), "qwen3-5-9b-Q4-K-M");
  });
});

describe("assertComparable", () => {
  test("allows two models at matched quantization and runtime", () => {
    const a = qwen();
    const b = { ...qwen(), model: "olmo-3.1:32b-instruct" };
    assert.doesNotThrow(() => assertComparable(a, b));
  });

  test("refuses a q4-vs-q8 comparison", () => {
    const a = qwen();
    const b = { ...qwen(), quantization: "Q8_0" };
    assert.throws(() => assertComparable(a, b), /quantization differs/);
  });

  test("refuses across runtime versions", () => {
    const a = qwen();
    const b = { ...qwen(), runtime: { ...a.runtime, version: "0.17.1" } };
    assert.throws(() => assertComparable(a, b), /runtime version differs/);
  });
});

describe("assertThinkDecided", () => {
  test("refuses a thinking-capable model with no explicit decision", () => {
    // The failure this exists to prevent: reasoning left on by default, whole
    // budget spent thinking, empty response, scored as a format failure.
    assert.throws(() => assertThinkDecided(qwen(), false), /thinking/);
  });

  test("allows a thinking-capable model once the decision is stated", () => {
    assert.doesNotThrow(() => assertThinkDecided(qwen(), true));
  });

  test("does not require a decision for a model without the capability", () => {
    const plain = { ...qwen(), capabilities: ["completion"] };
    assert.doesNotThrow(() => assertThinkDecided(plain, false));
  });
});
