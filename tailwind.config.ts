import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        koopje: {
          orange: "#F7941D",
          black: "#000000",
          "orange-light": "#FDE8CC",
          "orange-dark": "#E08510",
        },
      },
    },
  },
  plugins: [],
};
export default config;
