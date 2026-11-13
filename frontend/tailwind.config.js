/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        moss: 'var(--moss)',
        mint: 'var(--mint)',
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        coral: 'var(--coral)',
        line: 'var(--line)'
      },
      boxShadow: { soft: 'var(--shadow-soft)', float: 'var(--shadow-float)' },
      fontFamily: { sans: ['Inter', 'Avenir Next', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '1.25rem', panel: '1.75rem' },
      transitionTimingFunction: { ui: 'cubic-bezier(.2, .75, .25, 1)' }
    }
  },
  plugins: []
};
