/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // <-- Add this line to enable the 'dark:' prefix!
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /*
         * Jaipur palette — sandstone + indigo, readable on both themes.
         *
         * Both ramps are complete on purpose. Tailwind resolves `@apply` and
         * `dark:` variants at build time against exactly these keys, so a shade
         * that is merely *plausible* (`sand-200`, `ink-950`) fails the PostCSS
         * pass with "class does not exist" rather than falling back to a
         * neighbour. A gap here is a build break, not a visual wobble, so the
         * intermediate steps are filled in even where nothing uses them yet.
         */
        sand: {
          50: '#fdf8f3',
          100: '#f7ebdd',
          200: '#efdac2', // card borders on light
          300: '#e2bd94',
          400: '#d3a06d',
          500: '#c1854b', // lightest sand that clears AA on white for body text
          600: '#a56f3a',
          700: '#8a5a2b',
          800: '#6b4520',
          900: '#4a2f16',
        },
        // 600 is the dark-mode border, 950 the dark-mode page background. Both
        // were picked so sand-50 text on them clears WCAG AA at 14px.
        ink: {
          500: '#4b5478',
          600: '#3e4663',
          700: '#2a2f45',
          800: '#1d2135',
          900: '#12141f',
          950: '#0a0b12',
        },
        glow: '#ff7a45',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.35)' },
        },
      },
      animation: {
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};