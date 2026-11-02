import {
  extractHtmlSkeleton,
  computeStructureHash,
} from "../src/analysis/structure-hasher";

describe("extractHtmlSkeleton", () => {
  it("should strip text content but keep tag structure", () => {
    const html = `
      <html><body>
        <div class="content">
          <h1>Hello World</h1>
          <p>Some text here</p>
        </div>
      </body></html>
    `;

    const skeleton = extractHtmlSkeleton(html);

    expect(skeleton).toContain('<div class="content">');
    expect(skeleton).toContain("<h1>");
    expect(skeleton).toContain("<p>");
    expect(skeleton).not.toContain("Hello World");
    expect(skeleton).not.toContain("Some text here");
  });

  it("should preserve class, id, and role attributes", () => {
    const html = `
      <html><body>
        <div class="main" id="app" role="main">
          <span class="tag">content</span>
        </div>
      </body></html>
    `;

    const skeleton = extractHtmlSkeleton(html);

    expect(skeleton).toContain('class="main"');
    expect(skeleton).toContain('id="app"');
    expect(skeleton).toContain('role="main"');
    expect(skeleton).toContain('class="tag"');
  });

  it("should strip href, src, and other non-structural attributes", () => {
    const html = `
      <html><body>
        <a href="https://example.com" class="link">Click</a>
        <img src="photo.jpg" alt="Photo" class="avatar" />
      </body></html>
    `;

    const skeleton = extractHtmlSkeleton(html);

    expect(skeleton).not.toContain("https://example.com");
    expect(skeleton).not.toContain("photo.jpg");
    expect(skeleton).not.toContain("Photo");
    expect(skeleton).toContain('class="link"');
    expect(skeleton).toContain('class="avatar"');
  });

  it("should remove script, style, and svg elements", () => {
    const html = `
      <html><body>
        <div class="wrapper">
          <script>alert('hi')</script>
          <style>.foo { color: red; }</style>
          <svg><circle r="10"/></svg>
          <p class="real">Content</p>
        </div>
      </body></html>
    `;

    const skeleton = extractHtmlSkeleton(html);

    expect(skeleton).not.toContain("<script>");
    expect(skeleton).not.toContain("<style>");
    expect(skeleton).not.toContain("<svg>");
    expect(skeleton).toContain('class="real"');
  });

  it("should return body tag for empty body", () => {
    const html = "<html><head><title>Test</title></head><body></body></html>";
    const skeleton = extractHtmlSkeleton(html);
    // Body is a tag element, so its skeleton is <body></body>
    expect(skeleton).toBe("<body></body>");
  });

  it("should handle nested structures", () => {
    const html = `
      <html><body>
        <div class="outer">
          <div class="inner">
            <ul class="list">
              <li class="item">One</li>
              <li class="item">Two</li>
            </ul>
          </div>
        </div>
      </body></html>
    `;

    const skeleton = extractHtmlSkeleton(html);

    expect(skeleton).toContain('class="outer"');
    expect(skeleton).toContain('class="inner"');
    expect(skeleton).toContain('class="list"');
    expect(skeleton).toContain('class="item"');
    // Identical siblings collapse to one (repetition is not structure)
    const liCount = (skeleton.match(/<li/g) || []).length;
    expect(liCount).toBe(1);
  });

  it("keeps each distinct sibling once, in first-seen order", () => {
    const skeleton = extractHtmlSkeleton(`
      <html><body><div class="day">
        <div class="hearing"></div>
        <div class="holiday"></div>
        <div class="hearing"></div>
      </div></body></html>
    `);

    expect(skeleton).toBe(
      '<body><div class="day"><div class="hearing"></div><div class="holiday"></div></div></body>',
    );
  });
});

describe("computeStructureHash", () => {
  it("should return the same hash for same structure with different content", () => {
    const html1 = `
      <html><body>
        <div class="member-card">
          <h3><a>John Smith</a></h3>
          <p>District 1</p>
          <p>Democrat</p>
        </div>
      </body></html>
    `;

    const html2 = `
      <html><body>
        <div class="member-card">
          <h3><a>Jane Doe</a></h3>
          <p>District 42</p>
          <p>Republican</p>
        </div>
      </body></html>
    `;

    expect(computeStructureHash(html1)).toBe(computeStructureHash(html2));
  });

  it("should return different hash when structure changes", () => {
    const html1 = `
      <html><body>
        <div class="member-card">
          <h3><a>Name</a></h3>
        </div>
      </body></html>
    `;

    const html2 = `
      <html><body>
        <div class="legislator-card">
          <h3><a>Name</a></h3>
        </div>
      </body></html>
    `;

    expect(computeStructureHash(html1)).not.toBe(computeStructureHash(html2));
  });

  it("should return different hash when new elements are added", () => {
    const html1 = `
      <html><body>
        <div class="card"><h3>Name</h3></div>
      </body></html>
    `;

    const html2 = `
      <html><body>
        <div class="card"><h3>Name</h3><p>Extra</p></div>
      </body></html>
    `;

    expect(computeStructureHash(html1)).not.toBe(computeStructureHash(html2));
  });

  it("returns the same hash when only the number of repeated rows changes", () => {
    // A calendar on a moving window: one more day, one more hearing.
    const day = (hearings: number) =>
      `<div class="day"><h2></h2>${'<div class="hearing"><a></a></div>'.repeat(hearings)}</div>`;
    const html1 = `<html><body>${day(2)}${day(1)}</body></html>`;
    const html2 = `<html><body>${day(1)}${day(3)}${day(2)}</body></html>`;

    expect(computeStructureHash(html1)).toBe(computeStructureHash(html2));
  });

  it("returns a different hash when a new kind of row appears", () => {
    const html1 = `<html><body><div class="hearing"></div><div class="hearing"></div></body></html>`;
    const html2 = `<html><body><div class="hearing"></div><div class="holiday"></div></body></html>`;

    expect(computeStructureHash(html1)).not.toBe(computeStructureHash(html2));
  });

  it("returns a different hash when distinct kinds of row swap order", () => {
    // First-seen order is kept, deliberately (meetings-phase-b.md, as built
    // step 4): a reorder can break a sibling selector. The cost is that a
    // window starting on a different kind of row re-derives; 15 Senate
    // windows on 2026-11-01 never did.
    const html1 = `<html><body><div class="hearing"></div><div class="holiday"></div></body></html>`;
    const html2 = `<html><body><div class="holiday"></div><div class="hearing"></div></body></html>`;

    expect(computeStructureHash(html1)).not.toBe(computeStructureHash(html2));
  });

  it("should return a 64-char hex string (SHA-256)", () => {
    const hash = computeStructureHash("<html><body><p>test</p></body></html>");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should ignore script changes", () => {
    const html1 = `
      <html><body>
        <script>var x = 1;</script>
        <div class="content"><p>Text</p></div>
      </body></html>
    `;

    const html2 = `
      <html><body>
        <script>var x = 999;</script>
        <div class="content"><p>Text</p></div>
      </body></html>
    `;

    expect(computeStructureHash(html1)).toBe(computeStructureHash(html2));
  });
});
