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
          DEFAULT: "#0a0a0b",
          elevated: "#121214",
          card: "#18181b",
          border: "#27272a",
        },
        accent: {
          cyan: "#22d3ee",
          green: "#22c55e",
          red: "#ef4444",
          amber: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "monospace"],
      },
      ringOffsetColor: {
        surface: "#0a0a0b",
      },
    },
  },
  plugins: [],
};

export default config;
