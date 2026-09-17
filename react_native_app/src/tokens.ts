import type { TextStyle } from 'react-native';

export const color = {
  ink: '#14181B',
  ink2: '#5A6467',
  ink3: '#8A9497',
  paper: '#F6F7F6',
  surface: '#FFFFFF',
  rule: '#E1E6E1',
  accent: '#0B5049',
  accentInk: '#FFFFFF',
  accentSoft: '#E0ECE9',
  positive: '#2C6136',
  warning: '#8A5B06',
  critical: '#8A2E2E',
  criticalSoft: '#F7E7E5',
} as const;

export const space = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 24,
  s6: 32,
  s7: 48,
} as const;

export const radius = 12;

// Mirrors design/tokens.json. The production app uses a licensed typeface
// that is not included in the take-home, so these use the platform default.
export const type = {
  display: {
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '600',
    color: color.ink,
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    color: color.ink,
    letterSpacing: -0.2,
  },
  heading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: color.ink,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: color.ink,
  },
  bodyMuted: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: color.ink2,
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: color.ink2,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: color.ink3,
    letterSpacing: 0.8,
  },
  numeric: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400',
    color: color.ink,
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TextStyle>;
