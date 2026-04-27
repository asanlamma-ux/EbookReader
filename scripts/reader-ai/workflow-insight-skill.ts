import { readFileSync } from 'node:fs';
import { buildWorkflowInterpretationSkillInput } from '@/utils/reader-ai-skills';
import type { ReaderAiSkillResult } from '@/types/reader-ai';

function readInput(): ReaderAiSkillResult[] {
  const filePath = process.argv[2];
  const raw = filePath ? readFileSync(filePath, 'utf8') : readFileSync(0, 'utf8');
  return JSON.parse(raw) as ReaderAiSkillResult[];
}

const inputs = readInput();
const result = buildWorkflowInterpretationSkillInput(inputs);
process.stdout.write(`${result.title}\n${result.subtitle || ''}\n\n${result.output}\n`);
