import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        ink: '#0f172a',
        muted: '#5b6472',
        line: '#d7dce3',
        accent: '#0f766e',
        accentStrong: '#115e59',
        accentSoft: '#dff5f2',
        gold: '#b45309',
      },
    },
  },
  plugins: [],
} satisfies Config;
