// Display-font picker options for future text-mask work.
// Font files are bundled through @fontsource imports in main.tsx.

export type FontOption = {
  id: string;
  name: string;
  family: string;
  weight: number;
  sample: string;
};

export const FONT_LIBRARY: FontOption[] = [
  { id: 'instrument-serif', name: 'Instrument Serif', family: '"Instrument Serif", serif',     weight: 400, sample: 'Aa' },
  { id: 'fraunces-display', name: 'Fraunces',         family: '"Fraunces", serif',             weight: 900, sample: 'Aa' },
  { id: 'playfair',         name: 'Playfair',         family: '"Playfair Display", serif',     weight: 900, sample: 'Aa' },
  { id: 'inter-black',      name: 'Inter Black',      family: '"Inter", sans-serif',           weight: 900, sample: 'Aa' },
  { id: 'space-grotesk',    name: 'Space Grotesk',    family: '"Space Grotesk", sans-serif',   weight: 700, sample: 'Aa' },
  { id: 'archivo-black',    name: 'Archivo Black',    family: '"Archivo Black", sans-serif',   weight: 400, sample: 'Aa' },
  { id: 'caveat',           name: 'Caveat',           family: '"Caveat", cursive',             weight: 700, sample: 'Aa' },
  { id: 'dm-mono',          name: 'DM Mono',          family: '"DM Mono", monospace',          weight: 500, sample: 'Aa' },
  { id: 'abril-fatface',    name: 'Abril Fatface',    family: '"Abril Fatface", serif',        weight: 400, sample: 'Aa' },
  { id: 'rubik-mono',       name: 'Rubik Mono One',   family: '"Rubik Mono One", sans-serif',  weight: 400, sample: 'Aa' },
];

export const FONT_BY_ID: Record<string, FontOption> = Object.fromEntries(
  FONT_LIBRARY.map((f) => [f.id, f])
);
