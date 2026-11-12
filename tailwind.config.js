/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1f2937', soft: '#6b7280', faint: '#9ca3af' },
        accent: '#2f5bd8',
        paper: '#f7f7f8',
      },
    },
  },
  plugins: [],
}