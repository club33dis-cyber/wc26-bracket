import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b1220',
        panel: '#131c2e',
        panel2: '#1b2640',
        line: '#2a3553',
        ink: '#e8ecf4',
        inkdim: '#9aa5bf',
        accent: '#ffcc00',
        accent2: '#2fbf71',
        pick: '#1f6feb',
        correct: '#2fbf71',
        wrong: '#e5484d',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
