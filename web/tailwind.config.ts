import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#0d1220",
        surface: "#141b2e",
        border: "#1f2940",
        primary: "#e7ebf5",
        secondary: "#8992a5",
        accent: "#7b61ff",
        "status-ok": "#34b56b",
        "status-warn": "#ffb020",
        "status-error": "#e5484d",
      },
    },
  },
  plugins: [],
} satisfies Config;
