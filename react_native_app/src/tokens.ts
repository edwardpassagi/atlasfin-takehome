import type { TextStyle, ViewStyle } from 'react-native';

export const color = {
  ink: '#16161D',
  ink2: '#6B6B76',
  ink3: '#9A9AA8',
  paper: '#F3F3F8',
  surface: '#FFFFFF',
  rule: '#ECECF2',
  accent: '#5B4CFF',
  accentInk: '#FFFFFF',
  accentSoft: '#EEEAFF',
  navy: '#1A1464',
  positive: '#1F8A4C',
  warning: '#8A5B06',
  critical: '#C0392B',
  criticalSoft: '#F8E8E6',
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

export const radius = 20;
export const radiusButton = 24;

export const shadow = {
  shadowColor: '#16161D',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
} satisfies ViewStyle;

// Mirrors design/tokens.json. The production app uses a licensed typeface
// that is not included in the take-home, so these use the platform default.
export const type = {
  display: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '700',
    color: color.ink,
    letterSpacing: -0.6,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: color.ink,
    letterSpacing: -0.4,
  },
  heading: {
    fontSize: 16,
    lineHeight: 21,
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
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: color.ink2,
  },
  numeric: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: color.ink,
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TextStyle>;
