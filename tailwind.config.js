/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./App.tsx",
    "./index.tsx",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans TC', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'xl': '16px',
        '2xl': '20px',
        '3xl': '24px',
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)',
        'card': '0 1px 2px rgba(0,0,0,0.04), 0 8px 32px rgba(15,23,42,0.06)',
        'elevated': '0 4px 6px rgba(0,0,0,0.02), 0 16px 48px rgba(15,23,42,0.08)',
      },
      colors: {
        ink: {
          900: '#0B1220',
          700: '#263044',
          500: '#556070',
          400: '#6B7280',
          300: '#9CA3AF',
        },
      },
    },
  },
  plugins: [],
}
