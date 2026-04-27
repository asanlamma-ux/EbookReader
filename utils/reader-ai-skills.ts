import type {
  ReaderAiBookContext,
  ReaderAiChapterSource,
  ReaderAiSkillResult,
} from '@/types/reader-ai';

function clampString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function stripHtmlForAi(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function chapterPreview(chapter: ReaderAiChapterSource, maxChars: number): string {
  return clampString(stripHtmlForAi(chapter.html), maxChars);
}

function keywordTokens(value: string): string[] {
  return Array.from(
    new Set(
      String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length >= 3)
        .filter(token => !['what', 'which', 'when', 'where', 'about', 'again', 'chapter', 'novel', 'story', 'book', 'please', 'would', 'could', 'should', 'from', 'with', 'into', 'that', 'this', 'have', 'been', 'their'].includes(token))
    )
  );
}

function scoreChapterMatch(chapter: ReaderAiChapterSource, tokens: string[]): number {
  if (!tokens.length) return 0;
  const title = stripHtmlForAi(chapter.title).toLowerCase();
  const text = stripHtmlForAi(chapter.html).toLowerCase();
  return tokens.reduce((score, token) => {
    let next = score;
    if (title.includes(token)) next += 5;
    if (text.includes(token)) next += 2;
    return next;
  }, 0);
}

export function inferNovelSourceProfile(context: ReaderAiBookContext): ReaderAiSkillResult {
  const sample = stripHtmlForAi(context.currentChapterHtml).slice(0, 2400);
  const title = stripHtmlForAi(context.bookTitle).toLowerCase();
  const description = stripHtmlForAi(context.description || '').toLowerCase();
  let originalScore = 0;
  let mtlScore = 0;

  if (/(machine translation|mtl|webnovel|fan translation)/i.test(description)) {
    mtlScore += 3;
  }
  if (/(young master|courting death|heaven defying|jade beauty|this seat|senior brother)/i.test(sample)) {
    mtlScore += 2;
  }
  if (/[“”]/.test(sample) || /\b(mr\.|mrs\.|miss|sir)\b/i.test(sample)) {
    originalScore += 1;
  }
  if (/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(sample)) {
    originalScore += 1;
  }
  if (/\b(system|reborn|immortal|cultivation)\b/i.test(title)) {
    mtlScore += 1;
  }

  let verdict = 'Mixed or unclear.';
  if (mtlScore >= originalScore + 2) {
    verdict = 'Likely MTL or translation-heavy text.';
  } else if (originalScore >= mtlScore + 2) {
    verdict = 'Likely original-language or cleaner localized text.';
  }

  return {
    title: 'Classify source style',
    subtitle: `Original signals ${originalScore} · MTL signals ${mtlScore}`,
    output: [
      `Book: ${context.bookTitle}`,
      `Current chapter: ${context.currentChapterTitle}`,
      `Verdict: ${verdict}`,
      '',
      'Use this only as a heuristic. Prefer chapter evidence over style assumptions.',
    ].join('\n'),
  };
}

export function buildChapterSummarySkillInput(context: ReaderAiBookContext): ReaderAiSkillResult {
  const text = stripHtmlForAi(context.currentChapterHtml);
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  return {
    title: 'Read current chapter',
    subtitle: `Chapter ${context.currentChapterIndex + 1} of ${context.totalChapters}`,
    output: [
      `Book: ${context.bookTitle}`,
      `Author: ${context.author}`,
      `Chapter: ${context.currentChapterTitle}`,
      `Approx words: ${wordCount}`,
      '',
      clampString(text, 18000),
    ].join('\n'),
  };
}

export function buildNovelOutlineSkillInput(
  context: ReaderAiBookContext,
  options?: { excerptChars?: number; maxTotalChars?: number }
): ReaderAiSkillResult {
  const excerptChars = options?.excerptChars ?? 180;
  const maxTotalChars = options?.maxTotalChars ?? 22000;
  const lines: string[] = [
    `Book: ${context.bookTitle}`,
    `Author: ${context.author}`,
    `Total chapters: ${context.totalChapters}`,
  ];

  if (context.description?.trim()) {
    lines.push(`Description: ${stripHtmlForAi(context.description).slice(0, 1200)}`);
  }

  lines.push('', 'Chapter map:');

  for (let index = 0; index < context.chapters.length; index += 1) {
    const chapter = context.chapters[index];
    lines.push(
      `${index + 1}. ${chapter.title || `Chapter ${index + 1}`}`,
      `   Excerpt: ${chapterPreview(chapter, excerptChars)}`
    );
    if (lines.join('\n').length >= maxTotalChars) {
      lines.push(`... truncated after chapter ${index + 1} to stay within context budget.`);
      break;
    }
  }

  return {
    title: 'Build novel outline',
    subtitle: `${context.totalChapters} chapters mapped`,
    output: clampString(lines.join('\n'), maxTotalChars),
  };
}

export function buildChapterLocatorSkillInput(
  context: ReaderAiBookContext,
  userPrompt: string,
  options?: { excerptChars?: number; maxMatches?: number }
): ReaderAiSkillResult {
  const tokens = keywordTokens(userPrompt);
  const excerptChars = options?.excerptChars ?? 220;
  const maxMatches = options?.maxMatches ?? 8;

  const matches = context.chapters
    .map((chapter, index) => ({
      index,
      chapter,
      score: scoreChapterMatch(chapter, tokens),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxMatches);

  const lines = [
    `Question: ${userPrompt}`,
    `Current chapter: ${context.currentChapterIndex + 1} / ${context.totalChapters}`,
    `Keyword tokens: ${tokens.length ? tokens.join(', ') : 'none'}`,
    '',
  ];

  if (!matches.length) {
    lines.push('No strong chapter matches were found in the locally available chapter titles and excerpts.');
  } else {
    lines.push('Top local chapter candidates:');
    matches.forEach(match => {
      lines.push(
        `${match.index + 1}. ${match.chapter.title || `Chapter ${match.index + 1}`} (score ${match.score})`,
        `   Excerpt: ${chapterPreview(match.chapter, excerptChars)}`
      );
    });
  }

  return {
    title: 'Search local chapters',
    subtitle: matches.length ? `${matches.length} likely matches` : 'No local match',
    output: lines.join('\n'),
  };
}

export function buildWorkflowInterpretationSkillInput(parts: ReaderAiSkillResult[]): ReaderAiSkillResult {
  const lines = [
    'Workflow notes:',
    ...parts.map(part => {
      const outputLength = stripHtmlForAi(part.output).length;
      return `- ${part.title}: prepared ${outputLength.toLocaleString()} chars of grounded reader context`;
    }),
    '- Use chapter-only context for spoilers when the request targets the active chapter.',
    '- Use chapter map plus metadata when the request targets the whole novel.',
    '- Use chapter-match candidates when the user asks where or when something happened.',
    '- Prefer concise recaps first, then optional broader interpretation if the user explicitly asks.',
  ];

  return {
    title: 'Interpret extracted context',
    subtitle: 'Explain what the AI should trust',
    output: lines.join('\n'),
  };
}
