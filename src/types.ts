import type { Card, CardFormat, ThemeId } from './card-types';

export interface Project {
  id: string;
  topic: string;
  title: string;
  caption: string;
  tags: string[];
  cards: Card[];
  mode: 'ai' | 'template';
  createdAt: string;
  updatedAt?: string;
  theme: ThemeId;
  brand: string;
  format: CardFormat;
}

export interface ModelSettings {
  configured: boolean;
  baseUrl: string;
  model: string;
  mode: 'ai' | 'template';
}
