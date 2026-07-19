import { cn } from "@/lib/ui/cn";

/*
 * Democracy made beautiful. Every civic action plants a flower; over time
 * participation becomes a field — thousands of independent citizens, one shared
 * orientation. Each flower sways on its own phase, like wind through a crop.
 *
 * Flowers are generated with a seeded PRNG (deterministic → stable SSR/CSR
 * output, no hydration mismatch). Sway is pure CSS and respects
 * prefers-reduced-motion. Strokes use currentColor (inherit text-content).
 */
const HEAD =
  "M 50 40 C 50 36, 49 30, 50 26 C 51 22, 53 20, 50 18 C 47 20, 47 26, 48 31 C 46 27, 43 22, 40 21 C 36 20, 34 24, 35 28 C 36 32, 40 34, 44 33 C 40 35, 35 37, 34 41 C 33 45, 35 49, 38 50 C 41 51, 45 49, 46 46 C 44 50, 43 56, 45 60 C 47 64, 51 65, 54 63 C 57 61, 57 57, 55 53 C 58 57, 62 60, 66 59 C 70 58, 71 54, 69 50 C 67 46, 63 44, 59 45 C 63 43, 67 39, 66 35 C 65 31, 61 29, 57 31 C 54 33, 53 37, 54 40";

interface FieldProps {
  count?: number;
  seed?: number;
  region?: string;
  current?: number;
  total?: number;
  /** Trailing phrase after the count, e.g. "toward the 3.5%". */
  note?: string;
  caption?: string;
  className?: string;
}

interface Flower {
  size: number;
  duration: string;
  delay: string;
  isSprout: boolean;
  margin: string;
}

function buildFlowers(count: number, seed: number): Flower[] {
  // Seeded LCG — repeatable-feeling variety, identical every render.
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: count }, () => {
    const size = 44 + Math.round(rand() * 46); // 44–90px
    return {
      size,
      duration: (6 + rand() * 5).toFixed(2), // 6–11s sway
      delay: (-rand() * 11).toFixed(2), // phase offset
      isSprout: rand() < 0.12, // some still growing
      margin: (-size * 0.22).toFixed(1),
    };
  });
}

export function Field({
  count = 26,
  seed = 42,
  region = "Sonoma County",
  current = 4218,
  total = 26000,
  note = "toward the 3.5%",
  caption = "Every flower, a citizen doing the work",
  className,
}: FieldProps) {
  const flowers = buildFlowers(count, seed);
  const currentLabel = current.toLocaleString("en-US");
  const totalLabel = total.toLocaleString("en-US");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-line bg-surface-alt px-8 pt-12",
        className,
      )}
    >
      <div
        className="flex flex-nowrap items-end justify-center"
        aria-hidden="true"
      >
        {flowers.map((f, i) => (
          <svg
            key={i}
            width={f.size}
            height={f.size}
            viewBox="0 0 100 100"
            fill="none"
            aria-hidden="true"
            className="text-content"
            style={{
              marginLeft: `${f.margin}px`,
              marginRight: `${f.margin}px`,
              flexShrink: 0,
            }}
          >
            {f.isSprout ? (
              <>
                <path
                  d="M 44 78 C 40 81, 38 85, 40 88 C 43 91, 49 91, 52 88 C 55 85, 55 81, 52 78"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M 48 78 C 48 70, 49 64, 50 58 C 46 56, 42 52, 43 47 C 48 48, 51 53, 50 58 C 54 55, 58 54, 61 50 C 56 48, 52 52, 50 56"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </>
            ) : (
              <>
                <line
                  x1="50"
                  y1="95"
                  x2="50"
                  y2="40"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <g
                  className="field-flower"
                  style={{
                    animationDuration: `${f.duration}s`,
                    animationDelay: `${f.delay}s`,
                  }}
                >
                  <path
                    d={HEAD}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <circle cx="50" cy="40" r="10" fill="#E8C000" />
                </g>
              </>
            )}
          </svg>
        ))}
      </div>

      <div className="-mx-8 h-px bg-content/20"></div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-1 py-4">
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 100 100"
            fill="none"
            aria-hidden="true"
            className="text-content"
          >
            <path
              d="M 46 30 C 40 35, 36 44, 36 52 C 36 61, 42 68, 50 68 C 58 68, 64 61, 64 52 C 64 44, 60 35, 54 30 C 52 28.5, 48 28.5, 46 30 Z"
              fill="#E8C000"
            />
            <path
              d="M 46 26 C 38 32, 32 42, 32 52 C 32 64, 40 72, 50 72 C 60 72, 68 64, 68 52 C 68 42, 62 32, 54 26"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span className="text-xs text-content-dim">
            {region} ·{" "}
            <span className="font-semibold text-content">{currentLabel}</span>{" "}
            of {totalLabel} {note}
          </span>
        </div>
        <span className="font-display text-xs italic text-content-dim">
          {caption}
        </span>
      </div>
    </div>
  );
}
