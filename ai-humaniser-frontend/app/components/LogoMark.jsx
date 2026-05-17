"use client";

export default function LogoMark({ size = 34 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        background: "rgba(124,92,255,0.14)",
        border: "1px solid rgba(124,92,255,0.35)",
        boxShadow: "0 10px 26px rgba(124,92,255,0.25)",
      }}
      aria-label="AI Humaniser"
      title="AI Humaniser"
    >
      <svg width={Math.floor(size * 0.62)} height={Math.floor(size * 0.62)} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id="lg" x1="2" y1="2" x2="22" y2="22">
            <stop stopColor="#9b84ff" />
            <stop offset="1" stopColor="#7c5cff" />
          </linearGradient>

          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feColorMatrix
              in="b"
              type="matrix"
              values="
                1 0 0 0 0.48
                0 1 0 0 0.36
                0 0 1 0 1.00
                0 0 0 1 0"
              result="c"
            />
            <feMerge>
              <feMergeNode in="c" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 4-point spark/star */}
        <path
          filter="url(#glow)"
          d="M12 2.8l1.35 6.35L19.7 12l-6.35 1.35L12 19.7l-1.35-6.35L4.3 12l6.35-2.85L12 2.8z"
          fill="url(#lg)"
        />
      </svg>
    </div>
  );
}