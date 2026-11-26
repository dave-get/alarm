import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  text: '#14161A',
  muted: '#6B7280',
  border: '#E5E7EB',
  primary: '#C99400',
  primaryText: '#14161A',
  accent: '#F0B90B',
  up: '#0E9F6E',
  down: '#E02424',
  warn: '#B45309',
  warnBg: '#FEF3C7',
  danger: '#E02424',
  inputBg: '#FFFFFF',
};

const dark: typeof light = {
  bg: '#0B0E11',
  card: '#181A20',
  text: '#EAECEF',
  muted: '#848E9C',
  border: '#2B3139',
  primary: '#F0B90B',
  primaryText: '#0B0E11',
  accent: '#F0B90B',
  up: '#0ECB81',
  down: '#F6465D',
  warn: '#F0B90B',
  warnBg: '#2B2410',
  danger: '#F6465D',
  inputBg: '#0B0E11',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
