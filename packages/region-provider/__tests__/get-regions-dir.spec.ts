import { getRegionsDir } from "../src/index";

describe("getRegionsDir", () => {
  it("returns a path ending in /regions", () => {
    const dir = getRegionsDir();
    expect(dir).toMatch(/regions$/);
  });

  it("returns an absolute path", () => {
    const dir = getRegionsDir();
    expect(dir.startsWith("/")).toBe(true);
  });

  it("returns a consistent result on repeated calls", () => {
    const dir1 = getRegionsDir();
    const dir2 = getRegionsDir();
    expect(dir1).toBe(dir2);
  });
});
