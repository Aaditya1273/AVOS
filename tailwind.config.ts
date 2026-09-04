import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        verdict: {
          verified: 'hsl(var(--verdict-verified))',
          uncertain: 'hsl(var(--verdict-uncertain))',
          failed: 'hsl(var(--verdict-failed))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      /**
       * A five-step type ramp, replacing ten ad-hoc sizes that ranged over
       * half-pixel increments — 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 15.
       *
       * Half-pixel sizes are the tell that each component was nudged by eye
       * rather than drawn from a system. The eye cannot resolve 11 from 11.5px;
       * what it does resolve is the *inconsistency* between two labels that were
       * meant to match and do not. A ramp with visible steps reads as more
       * deliberate than a continuum with invisible ones.
       *
       * Line heights are fixed per step so vertical rhythm survives a size change.
       */
      fontSize: {
        micro: ['10px', { lineHeight: '14px', letterSpacing: '0.09em' }],
        mini: ['11.5px', { lineHeight: '16px' }],
        compact: ['12.5px', { lineHeight: '18px' }],
        body: ['13.5px', { lineHeight: '20px' }],
        figure: ['15px', { lineHeight: '20px', letterSpacing: '-0.01em' }],
      },

      /**
       * One tracking value per role. There were three — 0.08em, 0.09em and
       * 0.1em — which are indistinguishable on screen and so represent three
       * decisions where the design needed one.
       */
      letterSpacing: {
        label: '0.09em',
        tight: '-0.01em',
      },

      /**
       * Motion, made deliberate. Nine `transition-*` classes existed with zero
       * `duration-*` and zero `ease-*`, so every one ran on the framework
       * default. Setting the defaults makes all nine intentional without
       * touching a single call site.
       *
       * 160ms is under the ~200ms threshold where a UI stops feeling immediate;
       * the curve decelerates hard so state changes land rather than drift.
       */
      transitionDuration: { DEFAULT: '160ms' },
      transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)' },
    },
  },
  plugins: [],
}

export default config
