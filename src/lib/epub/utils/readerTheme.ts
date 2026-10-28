import type { ReaderSettings } from '../types';

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  flow: 'paginated',
  twoPageSpread: false,
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 0.8,
  textAlign: 'publisher',
  hyphenation: true,
  marginPercent: 10,
  animatePageTurn: true,
  theme: 'app',
  invertImagesInDark: false,
  brightness: 100,
  keepScreenAwake: true,
};

const STORAGE_KEY = 'mynotes_epub_reader_settings';

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_READER_SETTINGS, ...parsed };
    }
  } catch (e) {
    console.warn('[ReaderTheme] Failed to load reader settings from localStorage:', e);
  }
  return { ...DEFAULT_READER_SETTINGS };
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[ReaderTheme] Failed to save reader settings:', e);
  }
}

export function getThemeColors(theme: ReaderSettings['theme']): { bg: string; text: string; isDark: boolean } {
  if (theme === 'paper') {
    return { bg: '#f7f4ec', text: '#2c2b29', isDark: false };
  }
  if (theme === 'sepia') {
    return { bg: '#f4ecd8', text: '#5b4636', isDark: false };
  }
  if (theme === 'dark') {
    return { bg: '#1c1c1e', text: '#e0e0e0', isDark: true };
  }
  if (theme === 'black') {
    return { bg: '#000000', text: '#a0a0a0', isDark: true };
  }

  // 'app' theme: read active CSS variables from root
  if (typeof window !== 'undefined') {
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue('--bg-base')?.trim() || '#ffffff';
    const text = style.getPropertyValue('--text-primary')?.trim() || '#111827';
    // Check if background is dark by relative luminance or computed value
    const isDark = document.documentElement.classList.contains('dark') || 
                   document.documentElement.className.includes('dark') ||
                   bg.startsWith('#0') || bg.startsWith('#1') || bg.startsWith('#2');
    return { bg, text, isDark };
  }

  return { bg: '#ffffff', text: '#111827', isDark: false };
}

export function generateReaderCSS(settings: ReaderSettings): string {
  const { bg, text, isDark } = getThemeColors(settings.theme);

  let fontStack = 'inherit';
  if (settings.fontFamily === 'serif') {
    fontStack = 'Georgia, "Times New Roman", Cambria, serif';
  } else if (settings.fontFamily === 'sans') {
    fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  } else if (settings.fontFamily === 'mono') {
    fontStack = '"SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace';
  } else if (settings.fontFamily === 'dyslexic') {
    fontStack = '"OpenDyslexic", "Comic Sans MS", sans-serif';
  }

  const textAlignRule = settings.textAlign === 'publisher'
    ? ''
    : `text-align: ${settings.textAlign} !important;`;

  const hyphenRule = settings.hyphenation
    ? 'hyphens: auto; -webkit-hyphens: auto;'
    : 'hyphens: none; -webkit-hyphens: none;';

  const imageFilterRule = (isDark && settings.invertImagesInDark)
    ? 'filter: brightness(0.8) contrast(1.05);'
    : '';

  return `
    :root, html, body {
      background-color: ${bg} !important;
      color: ${text} !important;
      ${settings.fontFamily !== 'publisher' ? `font-family: ${fontStack} !important;` : ''}
      font-size: ${settings.fontSize}px !important;
      line-height: ${settings.lineHeight} !important;
      ${hyphenRule}
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    body {
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box;
      user-select: text !important;
      -webkit-user-select: text !important;
    }

    p, li, blockquote, dd, dt {
      ${textAlignRule}
      line-height: ${settings.lineHeight} !important;
    }

    p {
      margin-top: 0 !important;
      margin-bottom: ${settings.paragraphSpacing}em !important;
    }

    h1, h2, h3, h4, h5, h6 {
      color: ${text} !important;
      line-height: 1.3 !important;
      break-after: avoid;
      page-break-after: avoid;
    }

    a {
      color: inherit;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      cursor: pointer;
    }

    img, image, svg {
      max-width: 100% !important;
      height: auto !important;
      ${imageFilterRule}
    }

    table {
      max-width: 100% !important;
      overflow-x: auto;
    }

    pre, code {
      font-family: "SF Mono", Menlo, Monaco, Consolas, monospace !important;
      font-size: 0.9em !important;
    }
  `;
}
