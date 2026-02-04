"use client";

interface DocumentFrameOverlayProps {
  aspectRatio?: number;
  padding?: number;
  animated?: boolean;
}

export function DocumentFrameOverlay({
  aspectRatio = 8.5 / 11,
  padding = 32,
  animated = true,
}: DocumentFrameOverlayProps) {
  // The overlay uses an SVG with a cutout rectangle for the document frame.
  // Corner brackets are drawn at each corner of the cutout.
  const cornerLength = 30;
  const cornerWidth = 3;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <svg
        className="w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* Dark overlay with cutout */}
        <defs>
          <mask id="frame-mask">
            <rect width="100" height="100" fill="white" />
            <rect
              x={`${padding / 4}`}
              y={`${(100 - (100 - padding / 2) * (1 / aspectRatio) * (100 / 100)) / 2}`}
              width={`${100 - padding / 2}`}
              height={`${(100 - padding / 2) / aspectRatio}`}
              fill="black"
              rx="1"
            />
          </mask>
        </defs>
        <rect
          width="100"
          height="100"
          fill="black"
          fillOpacity="0.5"
          mask="url(#frame-mask)"
        />
      </svg>

      {/* Corner brackets positioned via CSS for pixel-perfect rendering */}
      <div
        className="absolute"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: `calc(100% - ${padding * 2}px)`,
          aspectRatio: `${aspectRatio}`,
          maxHeight: `calc(100% - ${padding * 2}px)`,
        }}
      >
        {/* Top-left corner */}
        <div
          className={`absolute top-0 left-0 ${animated ? "animate-pulse" : ""}`}
        >
          <div
            className="absolute top-0 left-0 bg-white rounded-full"
            style={{
              width: `${cornerLength}px`,
              height: `${cornerWidth}px`,
            }}
          />
          <div
            className="absolute top-0 left-0 bg-white rounded-full"
            style={{
              width: `${cornerWidth}px`,
              height: `${cornerLength}px`,
            }}
          />
        </div>

        {/* Top-right corner */}
        <div
          className={`absolute top-0 right-0 ${animated ? "animate-pulse" : ""}`}
        >
          <div
            className="absolute top-0 right-0 bg-white rounded-full"
            style={{
              width: `${cornerLength}px`,
              height: `${cornerWidth}px`,
            }}
          />
          <div
            className="absolute top-0 right-0 bg-white rounded-full"
            style={{
              width: `${cornerWidth}px`,
              height: `${cornerLength}px`,
            }}
          />
        </div>

        {/* Bottom-left corner */}
        <div
          className={`absolute bottom-0 left-0 ${animated ? "animate-pulse" : ""}`}
        >
          <div
            className="absolute bottom-0 left-0 bg-white rounded-full"
            style={{
              width: `${cornerLength}px`,
              height: `${cornerWidth}px`,
            }}
          />
          <div
            className="absolute bottom-0 left-0 bg-white rounded-full"
            style={{
              width: `${cornerWidth}px`,
              height: `${cornerLength}px`,
            }}
          />
        </div>

        {/* Bottom-right corner */}
        <div
          className={`absolute bottom-0 right-0 ${animated ? "animate-pulse" : ""}`}
        >
          <div
            className="absolute bottom-0 right-0 bg-white rounded-full"
            style={{
              width: `${cornerLength}px`,
              height: `${cornerWidth}px`,
            }}
          />
          <div
            className="absolute bottom-0 right-0 bg-white rounded-full"
            style={{
              width: `${cornerWidth}px`,
              height: `${cornerLength}px`,
            }}
          />
        </div>

        {/* Guide text */}
        <div className="absolute -bottom-8 left-0 right-0 text-center">
          <span className="text-white text-sm font-medium drop-shadow-lg">
            Align petition within the frame
          </span>
        </div>
      </div>
    </div>
  );
}
