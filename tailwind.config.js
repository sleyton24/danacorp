export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'toast-shrink': {
          '0%': { width: '100%' },
          '100%': { width: '0%' },
        },
      },
      animation: {
        'toast-shrink': 'toast-shrink 3s linear forwards',
      },
    },
  },
  plugins: [],
};
