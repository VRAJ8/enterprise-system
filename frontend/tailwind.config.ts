import animate from 'tailwindcss-animate'
import type { Config } from 'tailwindcss'

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1.5rem' },
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      colors: {
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
        background: hsl('background'),
        foreground: hsl('foreground'),
        canvas: hsl('canvas'),
        surface: { DEFAULT: hsl('surface'), raised: hsl('surface-raised'), sunken: hsl('surface-sunken') },
        primary: { DEFAULT: hsl('primary'), foreground: hsl('primary-foreground'), soft: hsl('primary-soft') },
        secondary: { DEFAULT: hsl('secondary'), foreground: hsl('secondary-foreground') },
        muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
        subtle: hsl('subtle'),
        accent: { DEFAULT: hsl('accent'), foreground: hsl('accent-foreground') },
        popover: { DEFAULT: hsl('popover'), foreground: hsl('popover-foreground') },
        card: { DEFAULT: hsl('card'), foreground: hsl('card-foreground') },
        destructive: { DEFAULT: hsl('destructive'), foreground: hsl('destructive-foreground') },
        success: hsl('success'),
        warning: hsl('warning'),
        danger: hsl('danger'),
        info: hsl('info'),
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        'elev-1': '0 1px 2px 0 hsl(var(--shadow) / 0.06), 0 1px 3px 0 hsl(var(--shadow) / 0.08)',
        'elev-2': '0 4px 12px -2px hsl(var(--shadow) / 0.12), 0 2px 4px -2px hsl(var(--shadow) / 0.08)',
        'elev-3': '0 16px 40px -8px hsl(var(--shadow) / 0.28), 0 4px 12px -4px hsl(var(--shadow) / 0.12)',
        'glow': '0 0 0 1px hsl(var(--primary) / 0.35), 0 8px 24px -6px hsl(var(--primary) / 0.45)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
      transitionTimingFunction: { 'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [animate],
} satisfies Config
