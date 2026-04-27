export type AiProviderId =
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'anthropic'
  | 'nvidia'
  | 'moonshot'
  | 'minimax'
  | 'custom-openai';

export type AiProviderFamily = 'google' | 'anthropic' | 'openai-compatible';

export type ReaderAiWorkflowMode = 'chapter-summary' | 'novel-summary' | 'chapter-locator' | 'chat';
export type ReaderAiToolOptionId = 'thinking' | 'deep-research' | 'web-search';

export type ReaderAiToolStatus = 'pending' | 'running' | 'done' | 'error';

export interface AiProviderModel {
  id: string;
  label: string;
  description: string;
  contextWindow?: number;
  recommendedFor?: ReaderAiWorkflowMode[];
}

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  family: AiProviderFamily;
  accentColor: string;
  iconGlyph: string;
  docsUrl: string;
  apiBaseUrl: string;
  connectDescription: string;
  featured: boolean;
  supportsEndpointOverride: boolean;
  searchTokens: string[];
  modelDiscovery: 'google' | 'anthropic' | 'openai-compatible';
  recommendedModelId: string;
  models: AiProviderModel[];
}

export interface ReaderAiProviderConfig {
  providerId: AiProviderId;
  label: string;
  apiKey: string;
  endpointUrl?: string;
  activeModelId: string;
  enabledModelIds: string[];
  userSuppliedEndpoint: boolean;
  updatedAt: string;
}

export interface ReaderAiToolRun {
  id: string;
  title: string;
  subtitle?: string;
  status: ReaderAiToolStatus;
  inputPreview?: string;
  outputPreview?: string;
}

export interface ReaderAiRunOptions {
  thinking: boolean;
  deepResearch: boolean;
  webSearch: boolean;
}

export interface ReaderAiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  workflowMode?: ReaderAiWorkflowMode;
  providerId?: AiProviderId;
  modelId?: string;
  thinkingSummary?: string;
  toolRuns?: ReaderAiToolRun[];
}

export interface ReaderAiSession {
  id: string;
  bookId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentChapterIndex: number;
  providerId: AiProviderId;
  activeModelId: string;
  messages: ReaderAiMessage[];
}

export interface ReaderAiChapterSource {
  title: string;
  html: string;
}

export interface ReaderAiBookContext {
  bookId: string;
  bookTitle: string;
  author: string;
  description?: string;
  currentChapterIndex: number;
  currentChapterTitle: string;
  currentChapterHtml: string;
  totalChapters: number;
  chapters: ReaderAiChapterSource[];
}

export interface ReaderAiSkillResult {
  title: string;
  subtitle?: string;
  output: string;
}
