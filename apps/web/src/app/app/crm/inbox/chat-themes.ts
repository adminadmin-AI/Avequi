'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * Temas de conversa do Inbox WhatsApp — a experiência do vendedor deve ser
 * a do WhatsApp de verdade: papel de parede com rabiscos atrás das mensagens
 * (fixo, não rola com o chat), balões verdes de enviado, e o usuário escolhe
 * o tema (persistido por dispositivo em localStorage, igual papel de parede
 * do WhatsApp).
 *
 * O padrão de rabiscos é NOSSO (ícones industriais: engrenagem, caixa,
 * caminhão, documento, gráfico, raio) — mesma vibe do doodle do WhatsApp,
 * sem copiar o asset deles.
 */

export interface ChatTheme {
  key: string;
  label: string;
  /** cor de fundo da área de conversa */
  bg: string;
  /** tile do papel de parede (data-URI) ou null para fundo liso */
  doodle: string | null;
  /** opacidade da camada de rabiscos */
  doodleOpacity: number;
  /** balão de saída (mensagens do vendedor) */
  bubbleOut: { background: string; color: string };
  /** balão de entrada (mensagens do lead) */
  bubbleIn: { background: string; color: string };
  /** cor do horário/ticks dentro dos balões */
  timeOut: string;
  timeIn: string;
  /** swatch mostrado no seletor de tema */
  swatch: string;
}

/** Tile 180×180 com os rabiscos industriais. `stroke` em hex sem '#'. */
function doodleTile(stroke: string): string {
  const s = `%23${stroke}`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' fill='none' stroke='${s}' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'>` +
    // engrenagem
    `<circle cx='30' cy='28' r='8'/><circle cx='30' cy='28' r='3'/><path d='M30 17v-4M30 43v-4M41 28h4M15 28h4M38 20l3-3M19 39l3-3M38 36l3 3M19 17l3 3'/>` +
    // caixa
    `<path d='M120 20l16 8v18l-16 8-16-8V28z'/><path d='M104 28l16 8 16-8M120 36v18'/>` +
    // documento
    `<path d='M60 96h20l6 6v22H60z'/><path d='M80 96v6h6M65 110h14M65 116h14'/>` +
    // caminhão
    `<path d='M18 130h26v16H18zM44 134h10l6 6v6h-16z'/><circle cx='26' cy='150' r='4'/><circle cx='52' cy='150' r='4'/>` +
    // gráfico de barras
    `<path d='M118 150v-12M126 150v-20M134 150v-8M112 154h28'/>` +
    // raio
    `<path d='M158 84l-8 12h7l-6 12'/>` +
    // balão de conversa
    `<path d='M148 22a10 8 0 1 0-4 6l6 2z'/>` +
    // chave inglesa
    `<path d='M86 46a6 6 0 1 1-6-8l10 10a6 6 0 1 1 8 6L88 44'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
}

const DOODLE_LIGHT_STROKE = doodleTile('ffffff');
const DOODLE_DARK_STROKE = doodleTile('54463a');
const DOODLE_INDIGO_STROKE = doodleTile('818cf8');

export const CHAT_THEMES: ChatTheme[] = [
  {
    key: 'wa-dark',
    label: 'WhatsApp escuro',
    bg: '#0b141a',
    doodle: DOODLE_LIGHT_STROKE,
    doodleOpacity: 0.045,
    bubbleOut: { background: '#005c4b', color: '#e9edef' },
    bubbleIn: { background: '#202c33', color: '#e9edef' },
    timeOut: 'rgba(233,237,239,0.6)',
    timeIn: '#8696a0',
    swatch: 'linear-gradient(135deg, #0b141a 50%, #005c4b 50%)',
  },
  {
    key: 'wa-light',
    label: 'WhatsApp claro',
    bg: '#efeae2',
    doodle: DOODLE_DARK_STROKE,
    doodleOpacity: 0.06,
    bubbleOut: { background: '#d9fdd3', color: '#111b21' },
    bubbleIn: { background: '#ffffff', color: '#111b21' },
    timeOut: 'rgba(17,27,33,0.45)',
    timeIn: 'rgba(17,27,33,0.45)',
    swatch: 'linear-gradient(135deg, #efeae2 50%, #d9fdd3 50%)',
  },
  {
    key: 'avecchi',
    label: 'Avecchi',
    bg: '#07080f',
    doodle: DOODLE_INDIGO_STROKE,
    doodleOpacity: 0.05,
    bubbleOut: { background: 'linear-gradient(135deg, #3d2ce6 0%, #4938d1 100%)', color: '#ffffff' },
    bubbleIn: { background: '#181b2c', color: '#e2e5f0' },
    timeOut: 'rgba(255,255,255,0.65)',
    timeIn: 'rgba(226,229,240,0.5)',
    swatch: 'linear-gradient(135deg, #07080f 50%, #3d2ce6 50%)',
  },
];

/** Opção "automático" do seletor — segue o tema claro/escuro do app. */
export const AUTO_THEME_OPTION = {
  key: 'auto',
  label: 'Automático (segue o app)',
  swatch: 'linear-gradient(135deg, #efeae2 50%, #0b141a 50%)',
} as const;

const STORAGE_KEY = 'avequi:crm:chat-theme';
const DEFAULT_KEY = 'auto';

/**
 * Tema atual + chave escolhida + setter persistido. SSR-safe.
 * 'auto' (default) resolve para WhatsApp claro/escuro conforme o tema do
 * app (next-themes) — papel de parede preto em app claro causa estranheza.
 */
export function useChatTheme(): {
  theme: ChatTheme;
  activeKey: string;
  setTheme: (key: string) => void;
} {
  const { resolvedTheme } = useTheme();
  const [key, setKey] = useState<string>(DEFAULT_KEY);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (saved === 'auto' || CHAT_THEMES.some((t) => t.key === saved))) setKey(saved);
  }, []);

  const set = useCallback((next: string) => {
    setKey(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const resolvedKey = key === 'auto' ? (resolvedTheme === 'light' ? 'wa-light' : 'wa-dark') : key;
  const theme = CHAT_THEMES.find((t) => t.key === resolvedKey) ?? CHAT_THEMES[0];
  return { theme, activeKey: key, setTheme: set };
}
