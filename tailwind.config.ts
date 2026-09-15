import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F8F7F3",
        panel: "#FFFFFF",
        ink: "#1B1A18",
        muted: "#8A8578",
        line: "#E4E1D8",
        accent: "#2F4B9A",
        accentSoft: "#EDF0F9",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
      },
      borderRadius: {
        sm: "3px",
      },
    },
  },
  plugins: [],
};
export default config;
