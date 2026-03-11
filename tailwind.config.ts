import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  safelist: [
    { pattern: /^(bg|border|text)-(surface|accent)-(card|elevated|border|cyan|green|red|amber)(\/\d+)?$/ },
  ],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#E0E7FF",
          elevated: "#DEE2FF",
          card: "#FFFFFF",
          border: "#E2E8F0",
        },
        accent: {
          cyan: "#4F46E5",
          primary: "#4F46E5",
          green: "#22c55e",
          red: "#ef4444",
          amber: "#f59e0b",
        },
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        "card-hover": "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "monospace"],
      },
      ringOffsetColor: {
        surface: "#E0E7FF",
      },
    },
  },
  plugins: [],
};

export default config;
