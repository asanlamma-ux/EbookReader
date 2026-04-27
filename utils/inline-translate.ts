/**
 * Client-side translation without leaving the app (MyMemory free tier).
 * Rate-limited; suitable for short selections and full chapter translation.
 * Falls back gracefully on error.
 */

import { logger } from '@/utils/logger';
import { TranslationCacheStorage } from '@/utils/fast-storage';

const MAX_CHARS = 440;
const CHAPTER_CACHE_PREFIX = '@miyo/chapter-translation/';

export interface InlineTranslateResult {
  translatedText: string;
  detectedLang?: string;
}

export interface ChapterTranslationResult {
  translatedHtml: string;
  targetLang: string;
  translatedAt: string;
}

export const TRANSLATION_LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
];

function sanitizeForRequest(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
}

/**
 * Translate a single chunk of text to a target language (ISO code, e.g. "en", "es").
 * Uses MyMemory public API — no API key; do not send sensitive content.
 */
export async function translateTextFree(
  text: string,
  targetLang: string = 'en'
): Promise<InlineTranslateResult> {
  const q = sanitizeForRequest(text);
  if (!q) {
    return { translatedText: '' };
  }

  const pair = `Autodetect|${targetLang}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(pair)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };
    const out = json.responseData?.translatedText?.trim();
    if (!out) {
      throw new Error('Empty translation');
    }
    return { translatedText: out };
  } catch (error) {
    logger.warn('Inline translate failed', { error });
    throw error;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Strip HTML tags from content and return plain text segments with their
 * surrounding HTML structure preserved so we can re-insert translated text.
 */
function splitHtmlToSegments(html: string): { type: 'tag' | 'text'; value: string }[] {
  const segments: { type: 'tag' | 'text'; value: string }[] = [];
  const tagRegex = /(<[^>]+>)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      const text = html.slice(lastIndex, match.index);
      if (text) segments.push({ type: 'text', value: text });
    }
    segments.push({ type: 'tag', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    const text = html.slice(lastIndex);
    if (text) segments.push({ type: 'text', value: text });
  }

  return segments;
}

/**
 * Chunk text segments into batches under the MAX_CHARS limit.
 * Returns arrays of segment indices that should be translated together.
 */
function chunkTextSegments(
  segments: { type: 'tag' | 'text'; value: string }[]
): number[][] {
  const chunks: number[][] = [];
  let currentChunk: number[] = [];
  let currentLength = 0;

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].type !== 'text') continue;
    const text = segments[i].value.trim();
    if (!text || text.length < 3) continue;

    if (currentLength + text.length > MAX_CHARS && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLength = 0;
    }

    currentChunk.push(i);
    currentLength += text.length + 1;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Translate a full chapter's HTML content.
 * Preserves HTML structure, only translates visible text.
 * Progress callback receives 0–1 as translation proceeds.
 */
export async function translateChapterHtml(
  html: string,
  targetLang: string = 'en',
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!html) return html;

  const segments = splitHtmlToSegments(html);
  const textIndices = segments
    .map((s, i) => (s.type === 'text' && s.value.trim().length > 2 ? i : -1))
    .filter(i => i >= 0);

  if (textIndices.length === 0) return html;

  const chunks = chunkTextSegments(segments);
  const translations = new Map<number, string>();
  let completed = 0;

  for (const chunk of chunks) {
    const combined = chunk.map(idx => segments[idx].value.trim()).join('\n||||\n');
    try {
      const { translatedText } = await translateTextFree(combined, targetLang);
      const parts = translatedText.split(/\n?\|\|\|\|\n?/);
      for (let k = 0; k < chunk.length; k++) {
        translations.set(chunk[k], parts[k]?.trim() || segments[chunk[k]].value);
      }
    } catch {
      for (const idx of chunk) {
        translations.set(idx, segments[idx].value);
      }
    }

    completed += chunk.length;
    onProgress?.(Math.min(0.99, completed / Math.max(1, textIndices.length)));

    // Small delay between chunks to respect rate limits
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  const resultParts = segments.map((seg, i) => {
    if (seg.type === 'tag') return seg.value;
    return translations.has(i) ? (translations.get(i) ?? seg.value) : seg.value;
  });

  onProgress?.(1);
  return resultParts.join('');
}

// ─── AsyncStorage caching for translated chapters ─────────────────────────────

function cacheKey(bookId: string, chapterIndex: number, targetLang: string): string {
  return `${CHAPTER_CACHE_PREFIX}${bookId}/${chapterIndex}/${targetLang}`;
}

export async function getCachedChapterTranslation(
  bookId: string,
  chapterIndex: number,
  targetLang: string
): Promise<ChapterTranslationResult | null> {
  try {
    const json = TranslationCacheStorage.get(cacheKey(bookId, chapterIndex, targetLang));
    if (!json) return null;
    return JSON.parse(json) as ChapterTranslationResult;
  } catch {
    return null;
  }
}

export async function saveChapterTranslation(
  bookId: string,
  chapterIndex: number,
  targetLang: string,
  translatedHtml: string
): Promise<void> {
  try {
    const data: ChapterTranslationResult = {
      translatedHtml,
      targetLang,
      translatedAt: new Date().toISOString(),
    };
    TranslationCacheStorage.set(cacheKey(bookId, chapterIndex, targetLang), JSON.stringify(data));
  } catch (error) {
    logger.warn('Failed to save chapter translation', { error });
  }
}

export async function clearChapterTranslations(bookId: string): Promise<void> {
  try {
    const prefix = `${CHAPTER_CACHE_PREFIX}${bookId}/`;
    const toRemove = TranslationCacheStorage.getAllKeys().filter(k => k.startsWith(prefix));
    for (const key of toRemove) {
      TranslationCacheStorage.delete(key);
    }
  } catch (error) {
    logger.warn('Failed to clear chapter translations', { error });
  }
}
