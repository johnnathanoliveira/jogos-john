import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'spin-slow': 'spin 1.5s linear infinite',
        'spin-fast': 'spin 0.4s linear infinite',
        'bounce-in': 'bounceIn 0.5s ease-out',
        'pulse-glow': 'pulseGlow 1.5s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'confetti': 'confettiFall 3s ease-in forwards',
        'shake': 'shake 0.5s ease-in-out',
        'winner-glow': 'winnerGlow 1s ease-in-out infinite',
        'number-reveal': 'numberReveal 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },
      keyframes: {
        bounceIn: {
          '0%': { transform: 'scale(0) rotate(-10deg)', opacity: '0' },
          '60%': { transform: 'scale(1.15) rotate(5deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(250, 204, 21, 0.4)' },
          '50%': { boxShadow: '0 0 60px rgba(250, 204, 21, 0.9)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        confettiFall: {
          '0%': { transform: 'translateY(-100vh) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(100vh) rotate(720deg)', opacity: '0' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-8px)' },
          '40%': { transform: 'translateX(8px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
        winnerGlow: {
          '0%, 100%': { textShadow: '0 0 20px rgba(250, 204, 21, 0.8), 0 0 40px rgba(250, 204, 21, 0.5)' },
          '50%': { textShadow: '0 0 40px rgba(250, 204, 21, 1), 0 0 80px rgba(250, 204, 21, 0.8), 0 0 120px rgba(250, 204, 21, 0.4)' },
        },
        numberReveal: {
          '0%': { transform: 'scale(0.3) rotateY(90deg)', opacity: '0' },
          '100%': { transform: 'scale(1) rotateY(0deg)', opacity: '1' },
        },
      },
      backgroundImage: {
        'bingo-gradient': 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 50%, #1e1b4b 100%)',
        'card-gradient': 'linear-gradient(145deg, #312e81 0%, #1e1b4b 100%)',
        'globe-gradient': 'radial-gradient(circle at 30% 30%, #fde68a, #f59e0b 50%, #b45309)',
      },
    },
  },
  plugins: [],
}

export default config
