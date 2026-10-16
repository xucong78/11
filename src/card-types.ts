export type ThemeId = 'butter' | 'ink' | 'lavender' | 'mint';

export type CardFormat = 'portrait' | 'square';

export interface Card {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  kind: 'cover' | 'content' | 'outro';
}

export interface CardProject {
  title: string;
  cards: Card[];
  caption?: string;
  tags?: string[];
}

export interface CardAppearance {
  theme: ThemeId;
  brand: string;
  format?: CardFormat;
}
