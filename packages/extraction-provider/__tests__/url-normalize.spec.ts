import { normalizeUrl } from "../src/utils/url-normalize.js";

describe("normalizeUrl", () => {
  it("appends a trailing slash to bare-domain URLs", () => {
    expect(normalizeUrl("https://sr04.senate.ca.gov")).toBe(
      "https://sr04.senate.ca.gov/",
    );
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
  });

  it("leaves URLs with paths unchanged", () => {
    expect(normalizeUrl("https://example.com/foo")).toBe(
      "https://example.com/foo",
    );
    expect(normalizeUrl("https://example.com/foo/bar")).toBe(
      "https://example.com/foo/bar",
    );
  });

  it("treats bare-domain and trailing-slash inputs as equivalent", () => {
    expect(normalizeUrl("https://example.com")).toBe(
      normalizeUrl("https://example.com/"),
    );
  });

  it("lowercases hostnames", () => {
    expect(normalizeUrl("https://EXAMPLE.com/path")).toBe(
      "https://example.com/path",
    );
  });

  it("elides default ports", () => {
    expect(normalizeUrl("https://example.com:443/path")).toBe(
      "https://example.com/path",
    );
    expect(normalizeUrl("http://example.com:80/")).toBe("http://example.com/");
  });

  it("preserves query strings and fragments", () => {
    expect(normalizeUrl("https://example.com?q=1")).toBe(
      "https://example.com/?q=1",
    );
    expect(normalizeUrl("https://example.com/x#frag")).toBe(
      "https://example.com/x#frag",
    );
  });

  it("returns the input unchanged when it can't be parsed", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
    expect(normalizeUrl("")).toBe("");
  });
});
