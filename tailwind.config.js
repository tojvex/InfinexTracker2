/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular"]
      },
      colors: {
        ink: "#0b1320",
        mist: "#e7f0f7",
        sand: "#f4f1ea",
        tide: "#0f766e",
        flare: "#f59e0b"
      },
      boxShadow: {
        soft: "0 16px 40px rgba(15, 23, 42, 0.12)",
        glow: "0 10px 30px rgba(15, 118, 110, 0.18)"
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        rise: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "100% 50%" }
        }
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out",
        rise: "rise 0.7s ease-out",
        shimmer: "shimmer 6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
