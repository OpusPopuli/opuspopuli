import { createHash } from "node:crypto";
import { decodeUtf8, hashContentBytes } from "../src/utils/content-bytes.js";

describe("decodeUtf8", () => {
  // The contract is "identical to Response.text()", so the guard compares
  // against Response.text() itself rather than against hand-written
  // expectations. Hard-coded strings would only ever re-assert what the
  // author believed the decode did.
  const bodies: Array<[string, Buffer]> = [
    ["plain ascii", Buffer.from("hello", "utf8")],
    ["empty body", Buffer.alloc(0)],
    ["valid multibyte", Buffer.from("café — 日本", "utf8")],
    ["latin1 high bytes", Buffer.from([0x63, 0x61, 0x66, 0xe9])],
    ["lone continuation byte", Buffer.from([0x41, 0x80, 0x42])],
    ["truncated 3-byte sequence", Buffer.from([0x41, 0xe6, 0x97])],
    [
      "utf-8 BOM then text",
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("hello", "utf8"),
      ]),
    ],
    ["BOM alone", Buffer.from([0xef, 0xbb, 0xbf])],
    ["truncated BOM prefix", Buffer.from([0xef, 0xbb])],
  ];

  it.each(bodies)("matches Response.text() for %s", async (_name, bytes) => {
    await expect(decodeUtf8(bytes)).toEqual(await new Response(bytes).text());
  });

  it("strips the BOM rather than preserving it as U+FEFF", () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("Proposition 12", "utf8"),
    ]);

    // The regression this guards: a preserved BOM shifts every character
    // offset derived from the text by one, silently breaking claim anchoring.
    expect(decodeUtf8(withBom)).toBe("Proposition 12");
    expect(decodeUtf8(withBom).charCodeAt(0)).not.toBe(0xfeff);
  });

  it("only strips a BOM at the start, not one appearing mid-body", () => {
    const midBom = Buffer.concat([
      Buffer.from("a", "utf8"),
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("b", "utf8"),
    ]);

    expect(decodeUtf8(midBom)).toBe("a﻿b");
  });
});

describe("hashContentBytes", () => {
  it("hashes the bytes as received", () => {
    const bytes = Buffer.from("<html>Measure A</html>", "utf8");

    expect(hashContentBytes(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("is stable across calls — an unchanged re-fetch dedups", () => {
    const first = Buffer.from("<html>Measure A</html>", "utf8");
    const refetched = Buffer.from("<html>Measure A</html>", "utf8");

    expect(hashContentBytes(refetched)).toBe(hashContentBytes(first));
  });

  it("distinguishes bodies that decode to the same string", () => {
    // A BOM-prefixed body and a bare one decode identically, so a hash taken
    // over decoded text would call these the same source. Over raw bytes they
    // are distinct versions — which is the point of hashing before decoding.
    const bare = Buffer.from("hello", "utf8");
    const bommed = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bare]);

    expect(decodeUtf8(bommed)).toBe(decodeUtf8(bare));
    expect(hashContentBytes(bommed)).not.toBe(hashContentBytes(bare));
  });

  it("changes when a single byte changes", () => {
    expect(hashContentBytes(Buffer.from("Measure A", "utf8"))).not.toBe(
      hashContentBytes(Buffer.from("Measure B", "utf8")),
    );
  });
});
