import { renderHook } from "@testing-library/react";
import { useHydrated } from "@/lib/hooks";

describe("useHydrated", () => {
  it("is true once rendering on the client", () => {
    // jsdom is the client; the value that matters on the server is the
    // getServerSnapshot below, which renderHook cannot exercise directly.
    const { result } = renderHook(() => useHydrated());
    expect(result.current).toBe(true);
  });

  it("reports false from the server snapshot", () => {
    // The whole point: the server must render as if it has nothing, so the
    // client's first render agrees with it. Asserted through
    // renderToString, which is the only path that uses getServerSnapshot.
    const { renderToString } =
      require("react-dom/server") as typeof import("react-dom/server");
    function Probe() {
      return <span>{String(useHydrated())}</span>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});
