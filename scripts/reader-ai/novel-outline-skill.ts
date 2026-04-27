import { readFileSync } from 'node:fs';
import { buildNovelOutlineSkillInput } from '@/utils/reader-ai-skills';
import type { ReaderAiBookContext } from '@/types/reader-ai';

function readInput(): ReaderAiBookContext {
  const filePath = process.argv[2];
  const raw = filePath ? readFileSync(filePath, 'utf8') : readFileSync(0, 'utf8');
  return JSON.parse(raw) as ReaderAiBookContext;
}

const context = readInput();
const result = buildNovelOutlineSkillInput(context);
process.stdout.write(`${result.title}\n${result.subtitle || ''}\n\n${result.output}\n`);
