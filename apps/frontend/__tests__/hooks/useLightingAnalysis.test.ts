import { renderHook, act } from "@testing-library/react";
import { useLightingAnalysis } from "@/lib/hooks/useLightingAnalysis";

function createImageData(r: number, g: number, b: number, size = 4): ImageData {
  const data = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { data, width: 2, height: 2, colorSpace: "srgb" } as ImageData;
}

describe("useLightingAnalysis", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("initializes with good lighting state", () => {
    const { result } = renderHook(() => useLightingAnalysis());

    expect(result.current.analysis.level).toBe("good");
    expect(result.current.analysis.luminance).toBe(128);
  });

  it("detects dark lighting", () => {
    const { result } = renderHook(() => useLightingAnalysis());

    // Very dark image (all pixels near 0)
    const darkImage = createImageData(10, 10, 10);

    let analysis;
    act(() => {
      analysis = result.current.analyze(darkImage);
    });

    expect(analysis!.level).toBe("dark");
    expect(result.current.analysis.level).toBe("dark");
  });

  it("detects good lighting", () => {
    const { result } = renderHook(() => useLightingAnalysis());

    // Medium brightness
    const goodImage = createImageData(120, 130, 110);

    let analysis;
    act(() => {
      analysis = result.current.analyze(goodImage);
    });

    expect(analysis!.level).toBe("good");
  });

  it("detects bright lighting", () => {
    const { result } = renderHook(() => useLightingAnalysis());

    // Very bright image
    const brightImage = createImageData(240, 240, 240);

    let analysis;
    act(() => {
      analysis = result.current.analyze(brightImage);
    });

    expect(analysis!.level).toBe("bright");
  });

  it("respects custom thresholds", () => {
    const { result } = renderHook(() =>
      useLightingAnalysis({ darkThreshold: 100, brightThreshold: 150 }),
    );

    // This would be "good" with default thresholds but "dark" with custom
    const image = createImageData(60, 60, 60);

    act(() => {
      result.current.analyze(image);
    });

    expect(result.current.analysis.level).toBe("dark");
  });

  it("starts and stops continuous analysis", () => {
    const { result } = renderHook(() =>
      useLightingAnalysis({ sampleInterval: 500 }),
    );

    const darkImage = createImageData(10, 10, 10);
    const mockCaptureFrame = jest.fn(() => darkImage);

    act(() => {
      result.current.startContinuousAnalysis(mockCaptureFrame);
    });

    // Advance timer past one interval
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(mockCaptureFrame).toHaveBeenCalled();
    expect(result.current.analysis.level).toBe("dark");

    // Stop analysis
    act(() => {
      result.current.stopContinuousAnalysis();
    });

    mockCaptureFrame.mockClear();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockCaptureFrame).not.toHaveBeenCalled();
  });

  it("handles null frames from captureFrame gracefully", () => {
    const { result } = renderHook(() => useLightingAnalysis());

    const mockCaptureFrame = jest.fn(() => null);

    act(() => {
      result.current.startContinuousAnalysis(mockCaptureFrame);
    });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Should still have initial state
    expect(result.current.analysis.level).toBe("good");

    act(() => {
      result.current.stopContinuousAnalysis();
    });
  });
});
