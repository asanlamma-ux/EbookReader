import * as SecureStore from 'expo-secure-store';
import { FastStorage } from '@/utils/fast-storage';
import type {
  AiProviderId,
  AiProviderModel,
  AiProviderPreset,
  ReaderAiBookContext,
  ReaderAiMessage,
  ReaderAiProviderConfig,
  ReaderAiRunOptions,
  ReaderAiSession,
  ReaderAiToolRun,
  ReaderAiWorkflowMode,
} from '@/types/reader-ai';
import {
  buildChapterLocatorSkillInput,
  buildChapterSummarySkillInput,
  inferNovelSourceProfile,
  buildNovelOutlineSkillInput,
  buildWorkflowInterpretationSkillInput,
  stripHtmlForAi,
} from '@/utils/reader-ai-skills';

const AI_LEGACY_CONFIGS_KEY = '@miyo/ai/provider-configs';
const AI_CONFIG_METADATA_KEY = 'miyo.ai.provider-configs.meta';
const AI_CONFIG_API_KEY_PREFIX = 'miyo.ai.provider-configs.api-key.';
const AI_SESSIONS_PREFIX = '@miyo/ai/sessions/';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    family: 'openai-compatible',
    accentColor: '#111827',
    iconGlyph: 'O',
    docsUrl: 'https://platform.openai.com/docs/models',
    apiBaseUrl: 'https://api.openai.com/v1',
    connectDescription: 'GPT models for fast, capable general AI tasks.',
    featured: true,
    supportsEndpointOverride: true,
    searchTokens: ['openai', 'gpt', 'chatgpt'],
    modelDiscovery: 'openai-compatible',
    recommendedModelId: '',
    models: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    family: 'openai-compatible',
    accentColor: '#7C3AED',
    iconGlyph: 'R',
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    connectDescription: 'Access many supported models through one compatible endpoint.',
    featured: true,
    supportsEndpointOverride: true,
    searchTokens: ['openrouter', 'router'],
    modelDiscovery: 'openai-compatible',
    recommendedModelId: '',
    models: [],
  },
  {
    id: 'google',
    label: 'Google AI Studio',
    shortLabel: 'Google',
    family: 'google',
    accentColor: '#4285F4',
    iconGlyph: 'G',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    connectDescription: 'Gemini models for fast, structured responses.',
    featured: true,
    supportsEndpointOverride: true,
    searchTokens: ['google', 'gemini', 'ai studio'],
    modelDiscovery: 'google',
    recommendedModelId: 'gemini-2.5-flash',
    models: [
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Fast default for chapter summaries and chat.',
        recommendedFor: ['chapter-summary', 'chat'],
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Best for long-context whole-book synthesis.',
        recommendedFor: ['novel-summary', 'chat'],
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    shortLabel: 'Anthropic',
    family: 'anthropic',
    accentColor: '#D4A373',
    iconGlyph: 'A',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/all-models',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    connectDescription: 'Direct access to Claude models for longer-form reasoning.',
    featured: true,
    supportsEndpointOverride: true,
    searchTokens: ['anthropic', 'claude'],
    modelDiscovery: 'anthropic',
    recommendedModelId: 'claude-sonnet-4-0',
    models: [
      {
        id: 'claude-sonnet-4-0',
        label: 'Claude Sonnet 4',
        description: 'Balanced reasoning and writing quality.',
        recommendedFor: ['chapter-summary', 'novel-summary', 'chat'],
      },
      {
        id: 'claude-opus-4-1',
        label: 'Claude Opus 4.1',
        description: 'High-end long-form synthesis.',
        recommendedFor: ['novel-summary', 'chat'],
      },
      {
        id: 'claude-haiku-3-5',
        label: 'Claude Haiku 3.5',
        description: 'Lower-latency fallback for short prompts.',
        recommendedFor: ['chapter-summary', 'chat'],
      },
    ],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    shortLabel: 'NVIDIA',
    family: 'openai-compatible',
    accentColor: '#76B900',
    iconGlyph: 'N',
    docsUrl: 'https://docs.api.nvidia.com/nim/docs/model-cards',
    apiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    connectDescription: 'Use NVIDIA-hosted models through an OpenAI-compatible API.',
    featured: true,
    supportsEndpointOverride: true,
    searchTokens: ['nvidia', 'nim'],
    modelDiscovery: 'openai-compatible',
    recommendedModelId: '',
    models: [],
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    shortLabel: 'Moonshot',
    family: 'openai-compatible',
    accentColor: '#7C83FD',
    iconGlyph: 'K',
    docsUrl: 'https://platform.moonshot.ai/docs/guide/overview',
    apiBaseUrl: 'https://api.moonshot.ai/v1',
    connectDescription: 'Kimi and Moonshot models through a compatible endpoint.',
    featured: false,
    supportsEndpointOverride: true,
    searchTokens: ['moonshot', 'kimi'],
    modelDiscovery: 'openai-compatible',
    recommendedModelId: '',
    models: [],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    shortLabel: 'MiniMax',
    family: 'openai-compatible',
    accentColor: '#FF6B6B',
    iconGlyph: 'M',
    docsUrl: 'https://www.minimax.io/platform/document/ChatCompletion_v2',
    apiBaseUrl: 'https://api.minimax.io/v1',
    connectDescription: 'MiniMax models through a compatible endpoint.',
    featured: false,
    supportsEndpointOverride: true,
    searchTokens: ['minimax'],
    modelDiscovery: 'openai-compatible',
    recommendedModelId: '',
    models: [],
  },
  {
    id: 'custom-openai',
    label: 'Custom Provider',
    shortLabel: 'Custom',
    family: 'openai-compatible',
    accentColor: '#9CA3AF',
    iconGlyph: '>',
    docsUrl: 'https://platform.openai.com/docs/api-reference/models/list',
    apiBaseUrl: 'https://api.openai.com/v1',
    connectDescription: 'Add any OpenAI-compatible provider by base URL.',
    featured: true,
    supportsEndpointOverride: true,
    searchTokens: ['custom', 'endpoint', 'openai compatible'],
    modelDiscovery: 'openai-compatible',
    recommendedModelId: '',
    models: [],
  },
];

function providerPreset(providerId: AiProviderId): AiProviderPreset {
  return (
    AI_PROVIDER_PRESETS.find(provider => provider.id === providerId) ||
    AI_PROVIDER_PRESETS[0]
  );
}

function normaliseBaseUrl(value: string, fallback: string): string {
  const next = value.trim() || fallback;
  return next.replace(/\/+$/, '');
}

function defaultConfigForProvider(providerId: AiProviderId): ReaderAiProviderConfig {
  const preset = providerPreset(providerId);
  return {
    providerId,
    label: preset.label,
    apiKey: '',
    endpointUrl: preset.apiBaseUrl,
    activeModelId: preset.recommendedModelId,
    enabledModelIds: preset.recommendedModelId ? [preset.recommendedModelId] : [],
    userSuppliedEndpoint: providerId === 'custom-openai',
    updatedAt: new Date().toISOString(),
  };
}

export function getDefaultReaderAiConfigs(): ReaderAiProviderConfig[] {
  return AI_PROVIDER_PRESETS.map(provider => defaultConfigForProvider(provider.id));
}

function configApiKeyStorageKey(providerId: AiProviderId): string {
  return `${AI_CONFIG_API_KEY_PREFIX}${providerId}`;
}

type ReaderAiConfigMetadata = Omit<ReaderAiProviderConfig, 'apiKey'>;

function configToMetadata(config: ReaderAiProviderConfig): ReaderAiConfigMetadata {
  const { apiKey, ...metadata } = config;
  return metadata;
}

async function readLegacyConfigs(): Promise<ReaderAiProviderConfig[] | null> {
  // Android SecureStore rejects the old `@.../...` key format. Skip migration there.
  if (!/^[A-Za-z0-9._-]+$/.test(AI_LEGACY_CONFIGS_KEY)) {
    return null;
  }
  try {
    const raw = await SecureStore.getItemAsync(AI_LEGACY_CONFIGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReaderAiProviderConfig[];
  } catch {
    return null;
  }
}

async function writeAiConfigState(configs: ReaderAiProviderConfig[]): Promise<void> {
  await SecureStore.setItemAsync(
    AI_CONFIG_METADATA_KEY,
    JSON.stringify(configs.map(configToMetadata))
  );
  await Promise.all(
    configs.map(async config => {
      const trimmed = config.apiKey.trim();
      const key = configApiKeyStorageKey(config.providerId);
      if (trimmed) {
        await SecureStore.setItemAsync(key, trimmed);
      } else {
        await SecureStore.deleteItemAsync(key).catch(() => null);
      }
    })
  );
}

export async function listReaderAiConfigs(): Promise<ReaderAiProviderConfig[]> {
  const defaults = getDefaultReaderAiConfigs();
  let metadata: ReaderAiConfigMetadata[] | null = null;

  try {
    const raw = await SecureStore.getItemAsync(AI_CONFIG_METADATA_KEY);
    metadata = raw ? (JSON.parse(raw) as ReaderAiConfigMetadata[]) : null;
  } catch {
    metadata = null;
  }

  if (!metadata) {
    const legacy = await readLegacyConfigs();
    if (legacy?.length) {
      await writeAiConfigState(legacy);
      metadata = legacy.map(configToMetadata);
      if (/^[A-Za-z0-9._-]+$/.test(AI_LEGACY_CONFIGS_KEY)) {
        await SecureStore.deleteItemAsync(AI_LEGACY_CONFIGS_KEY).catch(() => null);
      }
    }
  }

  const byId = new Map((metadata || []).map(item => [item.providerId, item]));
  const apiKeys = await Promise.all(
    AI_PROVIDER_PRESETS.map(async provider => {
      try {
        const value = await SecureStore.getItemAsync(configApiKeyStorageKey(provider.id));
        return [provider.id, value || ''] as const;
      } catch {
        return [provider.id, ''] as const;
      }
    })
  );
  const apiKeysById = new Map(apiKeys);

  return defaults.map(defaultConfig => {
    const stored = byId.get(defaultConfig.providerId);
    return {
      ...defaultConfig,
      ...stored,
      apiKey: apiKeysById.get(defaultConfig.providerId) || '',
    };
  });
}

export async function getReaderAiConfig(providerId: AiProviderId): Promise<ReaderAiProviderConfig> {
  const configs = await listReaderAiConfigs();
  return configs.find(item => item.providerId === providerId) || defaultConfigForProvider(providerId);
}

export async function saveReaderAiConfig(config: ReaderAiProviderConfig): Promise<void> {
  const configs = await listReaderAiConfigs();
  const next = configs.map(item =>
    item.providerId === config.providerId
      ? { ...config, updatedAt: new Date().toISOString() }
      : item
  );
  await writeAiConfigState(next);
}

export async function saveReaderAiConfigs(configs: ReaderAiProviderConfig[]): Promise<void> {
  await writeAiConfigState(
    configs.map(config => ({
      ...config,
      updatedAt: config.updatedAt || new Date().toISOString(),
    }))
  );
}

export async function clearReaderAiProvider(providerId: AiProviderId): Promise<void> {
  const configs = await listReaderAiConfigs();
  const fallback = defaultConfigForProvider(providerId);
  const next = configs.map(config =>
    config.providerId === providerId ? fallback : config
  );
  await writeAiConfigState(next);
}

export function pickPreferredProviderId(configs: ReaderAiProviderConfig[]): AiProviderId {
  return configs.find(config => config.apiKey.trim())?.providerId || 'google';
}

export async function getGoogleAiApiKey(): Promise<string> {
  const config = await getReaderAiConfig('google');
  return config.apiKey;
}

export async function setGoogleAiApiKey(value: string): Promise<void> {
  const current = await getReaderAiConfig('google');
  await saveReaderAiConfig({
    ...current,
    apiKey: value.trim(),
  });
}

export async function discoverModelsForConfig(
  config: ReaderAiProviderConfig
): Promise<AiProviderModel[]> {
  const preset = providerPreset(config.providerId);
  const staticModels = preset.models;
  if (preset.modelDiscovery !== 'openai-compatible' || !config.apiKey.trim()) {
    return staticModels;
  }

  const baseUrl = normaliseBaseUrl(config.endpointUrl || preset.apiBaseUrl, preset.apiBaseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey.trim()}`,
  };
  if (preset.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/asanlamma-ux/EbookReader';
    headers['X-Title'] = 'MIYO Ebook Reader';
  }
  const response = await fetch(`${baseUrl}/models`, {
    headers,
  });

  if (!response.ok) {
    return staticModels;
  }

  const payload = (await response.json()) as { data?: { id?: string }[] };
  const discovered = (payload.data || [])
    .map(item => item?.id?.trim())
    .filter((id): id is string => Boolean(id))
    .map(id => ({
      id,
      label: id,
      description: 'Discovered from the provider endpoint.',
    }));

  const seen = new Set<string>();
  return [...staticModels, ...discovered].filter(model => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function getEnabledModelIds(config: ReaderAiProviderConfig, models: AiProviderModel[]): string[] {
  const valid = config.enabledModelIds.filter(id => models.some(model => model.id === id));
  if (valid.length) return valid;
  const active = models.find(model => model.id === config.activeModelId);
  return active ? [active.id] : models.slice(0, 1).map(model => model.id);
}

function isSimpleSocialPrompt(input: string): boolean {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return true;
  if (normalized.length <= 18 && ['hi', 'hello', 'hey', 'yo', 'thanks', 'thank you', 'sup'].includes(normalized)) {
    return true;
  }

  return [
    'hi there',
    'hello there',
    'how are you',
    'good morning',
    'good afternoon',
    'good evening',
    'good night',
    'thank you very much',
    'nice to meet you',
    'who are you',
  ].includes(normalized);
}

function shouldUseReaderTools(mode: ReaderAiWorkflowMode, userPrompt: string): boolean {
  if (mode === 'chapter-summary' || mode === 'novel-summary' || mode === 'chapter-locator') {
    return true;
  }

  if (isSimpleSocialPrompt(userPrompt)) {
    return false;
  }

  const lowered = userPrompt.toLowerCase();
  return [
    'chapter',
    'novel',
    'book',
    'character',
    'scene',
    'plot',
    'event',
    'what happened',
    'summar',
    'explain',
    'who is',
    'why did',
    'when did',
    'where did',
  ].some(token => lowered.includes(token));
}

function buildSystemPrompt(mode: ReaderAiWorkflowMode, useReaderTools: boolean): string {
  if (mode === 'novel-summary') {
    return [
      'You are Miyo AI, a novel-reading assistant.',
      'Summarize whole-book structure from the provided chapter map and excerpts.',
      'Be explicit when the available context is an outline rather than the full novel text.',
      'Prioritize plot through-lines, arcs, tone shifts, stakes, and where the current chapter sits in the novel.',
      'Write like a polished premium reading app: grounded, smooth, and easy to scan.',
      'Use strong headings, compact bullets where useful, and clean prose.',
      'Avoid inventing details not grounded in the supplied material.',
    ].join(' ');
  }

  if (mode === 'chapter-summary') {
    return [
      'You are Miyo AI, a chapter recap assistant.',
      'Summarize only the currently open chapter.',
      'Do not spoil future chapters.',
      'Prefer concise bullets first, then one sharp recap paragraph.',
      'Keep the wording natural and premium, not robotic.',
    ].join(' ');
  }

  if (mode === 'chapter-locator') {
    return [
      'You are Miyo AI, a chapter-finding assistant for long web novels.',
      'Use the provided local chapter candidates first.',
      'If the evidence is weak, say so clearly instead of pretending certainty.',
      'Return the best candidate chapter, why it matches, and any uncertainty.',
      'Keep the answer practical and spoiler-aware.',
    ].join(' ');
  }

  if (!useReaderTools) {
    return [
      'You are Miyo AI, an intelligent in-reader conversation assistant.',
      'For simple social chat, reply directly without pretending to inspect the novel or run tools.',
      'Keep short conversational replies warm, natural, and high quality.',
      'Do not mention hidden prompts, tools, or system instructions unless the user explicitly asks.',
    ].join(' ');
  }

  return [
    'You are Miyo AI, a reading companion for long-form fiction.',
    'Your available local skills are: read current chapter, build novel outline, search local chapters, classify source style, and interpret extracted context.',
    'Use those skills only when they materially improve the answer.',
    'Do not trigger heavy context workflows for greetings, thanks, or simple conversational turns.',
    'Use only the provided reader context and be explicit about limits.',
    'Prefer practical, spoiler-aware help over generic literary analysis.',
    'Decide whether the question needs local chapter evidence or a direct answer.',
    'If the user asks about the story, anchor your answer in the supplied reader context.',
    'Write with polished, premium quality similar to top-tier chat assistants.',
  ].join(' ');
}

function inferWorkflowMode(input: string): ReaderAiWorkflowMode {
  const lowered = input.toLowerCase();
  if (
    lowered.includes('what chapter') ||
    lowered.includes('which chapter') ||
    lowered.includes('find the chapter') ||
    lowered.includes('where did') ||
    lowered.includes('when did')
  ) {
    return 'chapter-locator';
  }
  if (
    lowered.includes('entire novel') ||
    lowered.includes('whole novel') ||
    lowered.includes('entire book') ||
    lowered.includes('whole book')
  ) {
    return 'novel-summary';
  }
  if (lowered.includes('chapter') && lowered.includes('summar')) {
    return 'chapter-summary';
  }
  return 'chat';
}

function buildUserPrompt(
  mode: ReaderAiWorkflowMode,
  userPrompt: string,
  toolRuns: ReaderAiToolRun[],
  useReaderTools: boolean,
  options: ReaderAiRunOptions
): string {
  const toolContext = toolRuns
    .map(run => `### ${run.title}\n${run.outputPreview || ''}`)
    .join('\n\n');
  const optionLines = [
    options.deepResearch ? '- Deep research is enabled. Be more exhaustive and careful.' : '',
    options.thinking ? '- Thinking mode is enabled. Show stronger step-by-step internal decision notes in the trace summary.' : '',
    options.webSearch ? '- Web search is enabled, but only mention external search when supported context is actually available.' : '',
  ].filter(Boolean);

  if (mode === 'novel-summary') {
    return [
      userPrompt || 'Summarize the entire novel using the supplied metadata, chapter list, and excerpts.',
      '',
      'Return:',
      '- A concise overview',
      '- The main arcs or phases',
      '- Where the current chapter fits',
      '- A note about any uncertainty due to limited context',
      '',
      ...optionLines,
      '',
      toolContext,
    ].join('\n');
  }

  if (mode === 'chapter-summary') {
    return [
      userPrompt || 'Summarize the current chapter for a reader returning after a break.',
      '',
      'Return:',
      '- 3 to 6 concise bullet points',
      '- One short recap sentence',
      '- No spoilers beyond this chapter',
      '',
      ...optionLines,
      '',
      toolContext,
    ].join('\n');
  }

  if (mode === 'chapter-locator') {
    return [
      userPrompt || 'Find the most likely chapter for this event.',
      '',
      'Return:',
      '- The strongest chapter candidate',
      '- Why it matches',
      '- A confidence note if the evidence is incomplete',
      '',
      ...optionLines,
      '',
      toolContext,
    ].join('\n');
  }

  if (!useReaderTools) {
    return [
      userPrompt,
      '',
      ...optionLines,
      '',
      'Reply naturally and directly. Do not fabricate workflow steps, chapter evidence, or tool usage.',
    ].join('\n');
  }

  return [
    userPrompt,
    '',
    ...optionLines,
    '',
    'Use the supplied reader context only if it improves the answer.',
    toolContext,
  ]
    .filter(Boolean)
    .join('\n');
}

async function callGoogleModel(params: {
  config: ReaderAiProviderConfig;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const response = await fetch(
    `${normaliseBaseUrl(params.config.endpointUrl || '', providerPreset('google').apiBaseUrl)}/models/${params.modelId}:generateContent?key=${encodeURIComponent(params.config.apiKey.trim())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: params.userPrompt }],
          },
        ],
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await extractProviderError(response, `Google AI request failed (${response.status}).`));
  }

  const data = (await response.json()) as any;
  return data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('\n').trim();
}

async function callAnthropicModel(params: {
  config: ReaderAiProviderConfig;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const response = await fetch(
    `${normaliseBaseUrl(params.config.endpointUrl || '', providerPreset('anthropic').apiBaseUrl)}/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': params.config.apiKey.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.modelId,
        max_tokens: params.maxTokens,
        temperature: params.temperature,
        system: params.systemPrompt,
        messages: [{ role: 'user', content: params.userPrompt }],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await extractProviderError(response, `Anthropic request failed (${response.status}).`));
  }

  const data = (await response.json()) as any;
  return data?.content?.map((part: any) => part?.text || '').join('\n').trim();
}

async function callOpenAiCompatibleModel(params: {
  config: ReaderAiProviderConfig;
  preset: AiProviderPreset;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const baseUrl = normaliseBaseUrl(params.config.endpointUrl || '', params.preset.apiBaseUrl);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    Authorization: `Bearer ${params.config.apiKey.trim()}`,
  };

  if (params.preset.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/asanlamma-ux/EbookReader';
    headers['X-Title'] = 'MIYO Ebook Reader';
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.modelId,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(await extractProviderError(response, `Provider request failed (${response.status}).`));
  }

  const data = (await response.json()) as any;
  return extractOpenAiCompatibleText(data);
}

async function extractProviderError(response: Response, fallback: string): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as any;
    const detail =
      parsed?.error?.message ||
      parsed?.detail ||
      parsed?.message ||
      parsed?.title ||
      parsed?.error ||
      '';
    if (typeof detail === 'string' && detail.trim()) {
      const normalized = detail.trim();
      if (/function .*not found for account/i.test(normalized)) {
        return `${normalized} Try refreshing NVIDIA models or switching to a different model.`;
      }
      return normalized;
    }
  } catch {
    // Fall back to the raw body below.
  }
  return raw || fallback;
}

function buildToolRuns(
  bookContext: ReaderAiBookContext,
  mode: ReaderAiWorkflowMode,
  userPrompt: string
): ReaderAiToolRun[] {
  const skillResults =
    mode === 'novel-summary'
      ? (() => {
          const outline = buildNovelOutlineSkillInput(bookContext);
          const sourceProfile = inferNovelSourceProfile(bookContext);
          return [
            outline,
            sourceProfile,
            buildWorkflowInterpretationSkillInput([outline, sourceProfile]),
          ];
        })()
      : mode === 'chapter-locator'
        ? (() => {
            const chapterLookup = buildChapterLocatorSkillInput(bookContext, userPrompt);
            const sourceProfile = inferNovelSourceProfile(bookContext);
            return [
              chapterLookup,
              sourceProfile,
              buildWorkflowInterpretationSkillInput([chapterLookup, sourceProfile]),
            ];
          })()
        : (() => {
            const chapter = buildChapterSummarySkillInput(bookContext);
            const sourceProfile = inferNovelSourceProfile(bookContext);
            return [
              chapter,
              sourceProfile,
              buildWorkflowInterpretationSkillInput([chapter, sourceProfile]),
            ];
          })();

  return skillResults.map(result => ({
    id: makeId('tool'),
    title: result.title,
    subtitle: result.subtitle,
    status: 'done',
    inputPreview: result.subtitle || '',
    outputPreview: result.output,
  }));
}

function buildThinkingSummary(
  mode: ReaderAiWorkflowMode,
  modelId: string,
  useReaderTools: boolean,
  options: ReaderAiRunOptions
): string {
  const suffix = [
    options.deepResearch ? 'Deep research was enabled.' : '',
    options.thinking ? 'Thinking mode was enabled.' : '',
    options.webSearch ? 'Web-search preference was noted for supported flows.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!useReaderTools) {
    return `Detected a lightweight conversational turn, skipped reader tools to save tokens, and asked ${modelId} for a direct reply.${suffix ? ` ${suffix}` : ''}`;
  }
  if (mode === 'novel-summary') {
    return `Mapped the novel into a chapter-aware outline, then asked ${modelId} to synthesize arcs and current placement.${suffix ? ` ${suffix}` : ''}`;
  }
  if (mode === 'chapter-summary') {
    return `Read the active chapter text, constrained spoilers to the current chapter, then asked ${modelId} for a compact recap.${suffix ? ` ${suffix}` : ''}`;
  }
  if (mode === 'chapter-locator') {
    return `Scored local chapter candidates, compared scene clues, then asked ${modelId} to choose the strongest match and explain the confidence level.${suffix ? ` ${suffix}` : ''}`;
  }
  return `Prepared grounded reader context and asked ${modelId} to respond within the current reading session.${suffix ? ` ${suffix}` : ''}`;
}

function generationParamsForMode(mode: ReaderAiWorkflowMode, useReaderTools: boolean): {
  temperature: number;
  maxTokens: number;
} {
  if (!useReaderTools) {
    return { temperature: 0.55, maxTokens: 220 };
  }
  if (mode === 'chapter-locator') {
    return { temperature: 0.25, maxTokens: 420 };
  }
  if (mode === 'chapter-summary') {
    return { temperature: 0.35, maxTokens: 720 };
  }
  if (mode === 'novel-summary') {
    return { temperature: 0.3, maxTokens: 980 };
  }
  return { temperature: 0.4, maxTokens: 520 };
}

function isRetryableOpenAiCompatibleError(error: unknown): boolean {
  const message =
    (error instanceof Error ? error.message : typeof error === 'string' ? error : '')
      .toLowerCase()
      .trim();

  if (!message) return false;
  if (
    message.includes('401') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('invalid api key')
  ) {
    return false;
  }

  return (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('empty response') ||
    message.includes('function') ||
    message.includes('model')
  );
}

function orderedCandidateModels(
  models: AiProviderModel[],
  preferredModel: AiProviderModel,
  enabledModelIds: string[],
  limit = 4
): AiProviderModel[] {
  const enabledSet = new Set(enabledModelIds);
  const ordered = [
    preferredModel,
    ...models.filter(model => enabledSet.has(model.id)),
    ...models,
  ];
  const seen = new Set<string>();
  return ordered.filter(model => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  }).slice(0, limit);
}

function extractOpenAiCompatibleText(data: any): string {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('\n')
      .trim();
    if (joined) return joined;
  }
  if (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.trim()) {
    return choice.message.reasoning_content.trim();
  }
  if (typeof choice?.text === 'string' && choice.text.trim()) {
    return choice.text.trim();
  }
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  return '';
}

export async function runReaderAiWorkflow(params: {
  config: ReaderAiProviderConfig;
  bookContext: ReaderAiBookContext;
  userPrompt: string;
  requestedMode?: ReaderAiWorkflowMode;
  options?: ReaderAiRunOptions;
}): Promise<{
  mode: ReaderAiWorkflowMode;
  responseText: string;
  toolRuns: ReaderAiToolRun[];
  thinkingSummary: string;
  activeModelId: string;
}> {
  const preset = providerPreset(params.config.providerId);
  const options: ReaderAiRunOptions = params.options || {
    thinking: false,
    deepResearch: false,
    webSearch: false,
  };
  const cachedModels: AiProviderModel[] = params.config.enabledModelIds.length
    ? params.config.enabledModelIds.map(modelId => ({
        id: modelId,
        label: modelId,
        description: 'Saved from the last provider sync.',
      }))
    : params.config.activeModelId
      ? [
          {
            id: params.config.activeModelId,
            label: params.config.activeModelId,
            description: 'Saved active model.',
          },
        ]
      : [];
  const models = cachedModels.length ? cachedModels : await discoverModelsForConfig(params.config);
  const enabledModelIds = getEnabledModelIds(params.config, models);
  const resolvedMode = params.requestedMode || inferWorkflowMode(params.userPrompt);
  const useReaderTools =
    options.deepResearch || shouldUseReaderTools(resolvedMode, params.userPrompt);
  const preferredModel =
    models.find(model => model.id === params.config.activeModelId && enabledModelIds.includes(model.id)) ||
    models.find(model => enabledModelIds.includes(model.id)) ||
    models.find(model => model.recommendedFor?.includes(resolvedMode)) ||
    models[0];

  if (!params.config.apiKey.trim()) {
    throw new Error('Add an API key in AI configuration before running the workflow.');
  }
  if (!preferredModel) {
    throw new Error('No active AI model is enabled for this provider.');
  }

  const toolRuns = useReaderTools
    ? buildToolRuns(params.bookContext, resolvedMode, params.userPrompt)
    : [];
  const systemPrompt = buildSystemPrompt(resolvedMode, useReaderTools);
  const userPrompt = buildUserPrompt(
    resolvedMode,
    params.userPrompt.trim(),
    toolRuns,
    useReaderTools,
    options
  );
  const generationParams = generationParamsForMode(resolvedMode, useReaderTools);

  let responseText = '';
  let resolvedModel = preferredModel;
  if (preset.family === 'google') {
    responseText = await callGoogleModel({
      config: params.config,
      modelId: preferredModel.id,
      systemPrompt,
      userPrompt,
      ...generationParams,
    });
  } else if (preset.family === 'anthropic') {
    responseText = await callAnthropicModel({
      config: params.config,
      modelId: preferredModel.id,
      systemPrompt,
      userPrompt,
      ...generationParams,
    });
  } else {
    const candidates = orderedCandidateModels(
      models,
      preferredModel,
      enabledModelIds,
      preset.id === 'nvidia' ? 6 : 4
    );
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const nextResponse = await callOpenAiCompatibleModel({
          config: params.config,
          preset,
          modelId: candidate.id,
          systemPrompt,
          userPrompt,
          ...generationParams,
        });
        if (!nextResponse.trim()) {
          lastError = new Error('The provider returned an empty response.');
          if (candidate !== candidates[candidates.length - 1]) {
            continue;
          }
          break;
        }
        responseText = nextResponse;
        resolvedModel = candidate;
        lastError = null;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (
          candidate === candidates[candidates.length - 1] ||
          !isRetryableOpenAiCompatibleError(lastError)
        ) {
          throw lastError;
        }
      }
    }
    if (!responseText.trim() && lastError) {
      throw lastError;
    }
  }

  if (!responseText.trim()) {
    throw new Error('The provider returned an empty response.');
  }

  return {
    mode: resolvedMode,
    responseText: responseText.trim(),
    toolRuns,
    thinkingSummary: buildThinkingSummary(resolvedMode, resolvedModel.label, useReaderTools, options),
    activeModelId: resolvedModel.id,
  };
}

export function extractSummaryTextFromHtml(html: string, maxChars = 10000): string {
  return stripHtmlForAi(html).slice(0, maxChars);
}

export async function summarizeChapterWithGoogleAi(params: {
  apiKey: string;
  bookTitle: string;
  chapterTitle: string;
  chapterHtml: string;
}): Promise<string> {
  const config = defaultConfigForProvider('google');
  config.apiKey = params.apiKey.trim();
  const result = await runReaderAiWorkflow({
    config,
    requestedMode: 'chapter-summary',
    userPrompt: 'Summarize the current chapter.',
    bookContext: {
      bookId: 'adhoc',
      bookTitle: params.bookTitle,
      author: '',
      currentChapterIndex: 0,
      currentChapterTitle: params.chapterTitle,
      currentChapterHtml: params.chapterHtml,
      totalChapters: 1,
      chapters: [{ title: params.chapterTitle, html: params.chapterHtml }],
    },
  });
  return result.responseText;
}

export function loadReaderAiSessions(bookId: string): ReaderAiSession[] {
  return FastStorage.getJSON<ReaderAiSession[]>(`${AI_SESSIONS_PREFIX}${bookId}`) || [];
}

export function saveReaderAiSessions(bookId: string, sessions: ReaderAiSession[]): void {
  FastStorage.setJSON(`${AI_SESSIONS_PREFIX}${bookId}`, sessions);
}

export function createReaderAiSession(params: {
  bookId: string;
  title: string;
  providerId: AiProviderId;
  activeModelId: string;
  currentChapterIndex: number;
}): ReaderAiSession {
  const now = new Date().toISOString();
  return {
    id: makeId('session'),
    bookId: params.bookId,
    title: params.title,
    createdAt: now,
    updatedAt: now,
    currentChapterIndex: params.currentChapterIndex,
    providerId: params.providerId,
    activeModelId: params.activeModelId,
    messages: [],
  };
}

export function appendReaderAiMessages(
  session: ReaderAiSession,
  messages: ReaderAiMessage[]
): ReaderAiSession {
  const updatedAt = new Date().toISOString();
  return {
    ...session,
    updatedAt,
    messages: [...session.messages, ...messages],
  };
}
