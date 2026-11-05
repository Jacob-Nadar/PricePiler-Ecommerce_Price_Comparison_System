/** @type {import('tailwindcss').Config} */
const jade = {
  50: '#eaf9f3',
  100: '#c9f2e3',
  200: '#98e6cb',
  300: '#5fd3ae',
  400: '#2cbf92',
  500: '#12a57c',
  600: '#0a8566',
  700: '#0a6a54',
  800: '#0a5444',
  900: '#093f35',
  950: '#03241e',
};

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Cool graphite scale: crisp stationery on light, near-black panels in dark.
        slate: {
          50: '#f5f6f8',
          100: '#eceef2',
          200: '#dee2e8',
          300: '#c5cbd5',
          400: '#8b94a3',
          500: '#626b7a',
          600: '#48505c',
          700: '#323945',
          800: '#1c2129',
          900: '#11151b',
          950: '#07090c',
        },
        // One signal colour for money, active states and focus. Used sparingly.
        brand: jade,
        deal: jade,
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgb(7 9 12 / 0.04)',
        lift: '0 1px 2px rgb(7 9 12 / 0.05), 0 16px 32px -20px rgb(7 9 12 / 0.22)',
        glow: '0 0 0 1px rgb(18 165 124 / 0.14), 0 18px 44px -28px rgb(18 165 124 / 0.35)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: 0, transform: 'translateX(16px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out backwards',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) backwards',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) backwards',
        shimmer: 'shimmer 1.6s infinite',
        'progress-indeterminate': 'progress-indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
