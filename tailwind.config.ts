import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      keyframes: {
        gemFlash: {
          "0%, 100%": {
            boxShadow: "0 0 0px rgba(16, 185, 129, 0)",
          },
          "50%": {
            boxShadow: "0 0 28px rgba(16, 185, 129, 0.55)",
          },
        },
        floatUp: {
          "0%": { opacity: "1", transform: "translateY(0) scale(0.95)" },
          "100%": { opacity: "0", transform: "translateY(-18px) scale(1.05)" },
        },
      },
      animation: {
        "gem-flash": "gemFlash 1.4s ease-in-out 2",
        "float-up": "floatUp 2.2s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
