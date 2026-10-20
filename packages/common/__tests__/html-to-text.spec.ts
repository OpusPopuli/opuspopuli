import { htmlToReadableText } from "../src/utils/html-to-text";

/**
 * This function decides what the model sees, so its behaviour is worth pinning
 * rather than assumed. The cases below are the ones that matter for civic pages,
 * plus the one deliberate change made when the two byte-identical copies were
 * merged into this one.
 */
describe("htmlToReadableText", () => {
  it("drops script, style and chrome containers with their contents", () => {
    const out = htmlToReadableText(
      "<nav>Home About</nav><script>var x=1</script><style>.a{}</style>" +
        "<p>Assembly Bill 1830</p><footer>Contact us</footer>",
    );

    expect(out).toContain("Assembly Bill 1830");
    expect(out).not.toContain("Home About");
    expect(out).not.toContain("var x=1");
    expect(out).not.toContain(".a{}");
    expect(out).not.toContain("Contact us");
  });

  /**
   * #1382. `<aside>` was stripped as chrome. The California Senate caucus
   * template puts the member's BIOGRAPHY in one, so a 43 KB page reduced to 96
   * characters — the title and a skip link — while the bio sat in the fetched
   * bytes. Re-add the strip and this fails.
   *
   * The markup is the real shape from `sd08.senate.ca.gov`
   * (content hash `14385905b972`), not an invented one.
   */
  it("keeps aside content, which is where a Senate bio lives", () => {
    const out = htmlToReadableText(
      '<aside class="container-fluid clearfix" role="complementary">' +
        '<section class="row region region-featured-bottom-first">' +
        "<p>Senator Ashby was elected in 2022 to represent Sacramento and " +
        "Elk Grove.</p>" +
        "<p>The only woman on the Sacramento City Council for over six " +
        "years.</p>" +
        "</section></aside>",
    );

    expect(out).toContain("elected in 2022");
    expect(out).toContain("Sacramento City Council for over six years");
  });

  // The other half: keeping aside must not become "keep everything". These
  // four are still chrome and still go, contents included.
  it("still drops nav, header, footer, script and style wholesale", () => {
    const out = htmlToReadableText(
      "<nav>Home About</nav>" +
        "<header>Senator Example</header>" +
        "<script>var x=1</script>" +
        "<style>.a{color:red}</style>" +
        "<aside><p>Biography text</p></aside>" +
        "<footer>Contact us</footer>",
    );

    expect(out).toBe("Biography text");
  });

  it("keeps table cell text, having lost the table structure", () => {
    // Recorded as a known limitation, not an aspiration: the ballot-measure
    // status pages are tabular, and this is what survives of them.
    const out = htmlToReadableText(
      "<table><tr><th>Measure</th><th>Signatures</th></tr>" +
        "<tr><td>25-0001</td><td>546,651</td></tr></table>",
    );

    expect(out).toContain("25-0001");
    expect(out).toContain("546,651");
    expect(out).toContain("Signatures");
    // The pairing of header to cell is gone — nothing says 546,651 is a
    // signature count. That is the limitation.
    expect(out).not.toMatch(/<t[dhr]/);
  });

  it("decodes the entities civic pages actually use", () => {
    const out = htmlToReadableText(
      "<p>Ways &amp; Means &nbsp;&mdash;&nbsp; &quot;the People&#39;s&quot; " +
        "&lt;chamber&gt;</p>",
    );

    expect(out).toContain("Ways & Means");
    expect(out).toContain('"the People\'s"');
    expect(out).toContain("<chamber>");
  });

  it("collapses whitespace without gluing words together", () => {
    const out = htmlToReadableText(
      "<p>Second</p>\n\n   <p>Reading</p>\t<span>Third</span>",
    );

    expect(out).toMatch(/Second\s+Reading\s+Third/);
    expect(out).not.toContain("SecondReading");
  });

  /**
   * The one deliberate behaviour change from the copies this replaced.
   *
   * Both originals did `String.fromCharCode(Number(n))` unguarded, so a
   * malformed numeric entity produced `String.fromCharCode(NaN)` — a NUL byte
   * (U+0000) embedded in the prompt. A stray NUL is exactly the kind of byte
   * that makes a model's JSON output unparseable for reasons invisible in a log,
   * and civics extraction hit two unexplained `JSON.parse` failures on
   * 2026-09-24 whose cause was a bad escape in a string.
   *
   * Not claiming that was the cause. Claiming this should not be a candidate.
   */
  describe("numeric entities", () => {
    it("decodes valid ones, including above the BMP", () => {
      expect(htmlToReadableText("<p>&#8212;</p>")).toBe("—");
      // fromCharCode would have truncated this; fromCodePoint does not.
      expect(htmlToReadableText("<p>&#128077;</p>")).toBe("👍");
    });

    it("never emits a NUL byte for a malformed entity", () => {
      const out = htmlToReadableText("<p>&#0; &#99999999999;</p>");

      expect(out).not.toContain("\u0000");
      // The literal text survives instead, which is inspectable.
      expect(out).toContain("&#0;");
    });
  });

  /**
   * The four that measurably reached the prompt across the six California
   * civics pages on 2026-09-26: &rsquo; (16), &ldquo; (12), &rdquo; (12),
   * &mdash; (2). Before this they arrived as literal "&rsquo;" — a page about
   * the "State&rsquo;s Rainy Day Fund" handed the model exactly that.
   */
  describe("named entities", () => {
    it("decodes the ones that actually occur in civic pages", () => {
      const out = htmlToReadableText(
        "<p>State&rsquo;s Fund &mdash; &ldquo;the People&rdquo; &sect;1798</p>",
      );

      expect(out).toBe(
        "State\u2019s Fund \u2014 \u201cthe People\u201d \u00a71798",
      );
      expect(out).not.toContain("&");
    });

    it("leaves an unknown entity literal rather than guessing or dropping it", () => {
      // Visible beats silent: an unhandled name shows up as itself and can be
      // added to the map, instead of vanishing from the prompt.
      const out = htmlToReadableText("<p>a &zzz; b</p>");

      expect(out).toBe("a &zzz; b");
    });

    it("keeps the explicitly handled cases working", () => {
      expect(htmlToReadableText("<p>&amp; &lt; &gt; &quot; &#39;</p>")).toBe(
        "& < > \" '",
      );
    });
  });

  it("returns an empty string for empty input rather than throwing", () => {
    expect(htmlToReadableText("")).toBe("");
  });
});
