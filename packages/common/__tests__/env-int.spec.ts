import { envInt } from "../src/utils/env-int";

describe("envInt", () => {
  afterEach(() => {
    delete process.env.TEST_ENV_INT;
  });

  it.each([
    [undefined, 7],
    ["", 7],
    ["  ", 7],
    ["4", 4],
    ["2.5", 7],
    ["lots", 7],
    ["0", 7],
    ["-3", 7],
  ])("reads %p as %p", (value, expected) => {
    if (value !== undefined) process.env.TEST_ENV_INT = value;
    expect(envInt("TEST_ENV_INT", 7)).toBe(expected);
  });

  it("accepts 0 when 0 means off", () => {
    process.env.TEST_ENV_INT = "0";
    expect(envInt("TEST_ENV_INT", 30_000, 0)).toBe(0);
  });
});
