/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#15251f',
        moss: '#315d4f',
        mint: '#cce7d8',
        paper: '#f7f8f4',
        coral: '#ec785d',
        line: '#e9ece7'
      },
      boxShadow: { soft: '0 8px 30px rgba(23,47,37,.07)' },
      fontFamily: { sans: ['var(--font-inter)', 'Arial', 'sans-serif'] }
    }
  },
  plugins: []
};
