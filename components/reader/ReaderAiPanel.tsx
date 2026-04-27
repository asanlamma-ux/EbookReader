import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { ThemedText } from '@/components/ui/ThemedText';
import { PressableScale } from '@/components/ui/PressableScale';
import { AppDialog } from '@/components/ui/AppDialog';
import { ReaderAiConfigModal } from '@/components/reader/ReaderAiConfigModal';
import { ReaderAiProviderIcon } from '@/components/reader/ReaderAiProviderIcon';
import {
  AI_PROVIDER_PRESETS,
  appendReaderAiMessages,
  createReaderAiSession,
  discoverModelsForConfig,
  getReaderAiConfig,
  listReaderAiConfigs,
  loadReaderAiSessions,
  pickPreferredProviderId,
  runReaderAiWorkflow,
  saveReaderAiConfigs,
  saveReaderAiSessions,
} from '@/utils/reader-ai';
import type {
  AiProviderId,
  ReaderAiBookContext,
  ReaderAiChapterSource,
  ReaderAiMessage,
  ReaderAiProviderConfig,
  ReaderAiRunOptions,
  ReaderAiSession,
  ReaderAiWorkflowMode,
} from '@/types/reader-ai';

interface Props {
  visible: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  author: string;
  description?: string;
  chapterTitle: string;
  chapterHtml: string;
  currentChapterIndex: number;
  totalChapters: number;
  chapters: ReaderAiChapterSource[];
  initialPrompt?: string;
}

interface RunningStep {
  id: string;
  title: string;
  detail: string;
}

function TypewriterText({
  text,
  animate,
  onDone,
  style,
}: {
  text: string;
  animate: boolean;
  onDone?: () => void;
  style?: any;
}) {
  const [displayText, setDisplayText] = useState(animate ? '' : text);

  useEffect(() => {
    if (!animate) {
      setDisplayText(text);
      return;
    }
    setDisplayText('');
    let cancelled = false;
    let index = 0;
    const chunkSize = Math.max(1, Math.ceil(text.length / 180));
    const timer = setInterval(() => {
      index += chunkSize;
      if (cancelled) return;
      if (index >= text.length) {
        setDisplayText(text);
        clearInterval(timer);
        onDone?.();
        return;
      }
      setDisplayText(text.slice(0, index));
    }, 16);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [animate, onDone, text]);

  return (
    <ThemedText variant="primary" size="body" style={style}>
      {displayText}
    </ThemedText>
  );
}

function inferComposerMode(prompt: string): ReaderAiWorkflowMode {
  const lowered = prompt.toLowerCase();
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

function makeSessionTitle(prompt: string, mode: ReaderAiWorkflowMode, chapterTitle: string, bookTitle: string): string {
  if (mode === 'novel-summary') return 'Whole novel research';
  if (mode === 'chapter-summary') return chapterTitle || 'Chapter recap';
  if (mode === 'chapter-locator') return 'Find a chapter';
  const cleaned = prompt.replace(/\s+/g, ' ').trim().slice(0, 42).trim();
  return cleaned || chapterTitle || bookTitle;
}

function makeRunningSteps(
  mode: ReaderAiWorkflowMode,
  providerLabel: string,
  modelId: string,
  useReaderTools: boolean
): RunningStep[] {
  if (!useReaderTools) {
    return [
      {
        id: 'decide',
        title: 'Choosing reply path',
        detail: 'Detected a lightweight conversational turn, so the heavy reader workflow was skipped.',
      },
      {
        id: 'provider',
        title: 'Waiting on model',
        detail: `${providerLabel} · ${modelId || 'model sync pending'}`,
      },
      {
        id: 'final',
        title: 'Writing reply',
        detail: 'Composing a direct in-session response.',
      },
    ];
  }

  return [
    {
      id: 'decide',
      title: 'Choosing workflow',
      detail:
        mode === 'chapter-locator'
          ? 'This question needs chapter evidence, so local chapter search was enabled.'
          : mode === 'novel-summary'
            ? 'This request needs broad novel context, so the whole-book workflow was enabled.'
            : 'This request needs active reader context, so the chapter workflow was enabled.',
    },
    {
      id: 'reader',
      title: 'Reading local context',
      detail:
        mode === 'novel-summary'
          ? 'Mapping chapter evidence from the local novel content.'
          : 'Extracting the current chapter context and nearby reading clues.',
    },
    {
      id: 'workflow',
      title: 'Building workflow',
      detail:
        mode === 'chapter-locator'
          ? 'Preparing the chapter-finder workflow and local search hints.'
          : 'Formatting the prompt, trace, and model instructions.',
    },
    {
      id: 'provider',
      title: 'Waiting on model',
      detail: `${providerLabel} · ${modelId || 'model sync pending'}`,
    },
    {
      id: 'final',
      title: 'Finishing response',
      detail: 'Streaming the final answer back into this session.',
    },
  ];
}

export function ReaderAiPanel({
  visible,
  onClose,
  bookId,
  bookTitle,
  author,
  description,
  chapterTitle,
  chapterHtml,
  currentChapterIndex,
  totalChapters,
  chapters,
  initialPrompt,
}: Props) {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [providerConfigs, setProviderConfigs] = useState<ReaderAiProviderConfig[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<AiProviderId>('google');
  const [draftModelId, setDraftModelId] = useState('');
  const [sessions, setSessions] = useState<ReaderAiSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [configVisible, setConfigVisible] = useState(false);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Record<string, boolean>>({});
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [toolMenuVisible, setToolMenuVisible] = useState(false);
  const [providerMenuVisible, setProviderMenuVisible] = useState(false);
  const [modelMenuVisible, setModelMenuVisible] = useState(false);
  const [providerSearchQuery, setProviderSearchQuery] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [syncingModels, setSyncingModels] = useState(false);
  const [runningTraceExpanded, setRunningTraceExpanded] = useState(false);
  const [runningSteps, setRunningSteps] = useState<RunningStep[]>([]);
  const [runningStepIndex, setRunningStepIndex] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [runOptions, setRunOptions] = useState<ReaderAiRunOptions>({
    thinking: false,
    deepResearch: false,
    webSearch: false,
  });

  const bookContext = useMemo<ReaderAiBookContext>(
    () => ({
      bookId,
      bookTitle,
      author,
      description,
      currentChapterIndex,
      currentChapterTitle: chapterTitle,
      currentChapterHtml: chapterHtml,
      totalChapters,
      chapters,
    }),
    [author, bookId, bookTitle, chapterHtml, chapterTitle, chapters, currentChapterIndex, description, totalChapters]
  );

  const refreshProviderConfigs = async () => {
    const configs = await listReaderAiConfigs();
    setProviderConfigs(configs);
    return configs;
  };

  useEffect(() => {
    if (!visible) return;
    setError('');
    setDrawerVisible(false);
    setToolMenuVisible(false);
    setProviderMenuVisible(false);
    setModelMenuVisible(false);
    setProviderSearchQuery('');
    setModelSearchQuery('');
    setRunningTraceExpanded(false);
    void refreshProviderConfigs().then(configs => {
      const preferred = pickPreferredProviderId(configs);
      const config = configs.find(item => item.providerId === preferred);
      setSelectedProviderId(preferred);
      setDraftModelId(config?.activeModelId || config?.enabledModelIds[0] || '');
    });
    const nextSessions = loadReaderAiSessions(bookId);
    setSessions(nextSessions);
    setActiveSessionId(nextSessions[0]?.id || null);
    setInput(initialPrompt?.trim() || '');
  }, [bookId, initialPrompt, visible]);

  useEffect(() => {
    if (!drawerVisible) return;
    setToolMenuVisible(false);
    setProviderMenuVisible(false);
    setModelMenuVisible(false);
  }, [drawerVisible]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(timeout);
  }, [sessions, visible, running, error]);

  useEffect(() => {
    if (!visible) return;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, event => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height - insets.bottom));
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, visible]);

  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) || null,
    [activeSessionId, sessions]
  );

  useEffect(() => {
    if (!activeSession) return;
    setSelectedProviderId(activeSession.providerId);
    setDraftModelId(activeSession.activeModelId);
  }, [activeSession]);

  const activeConfig = useMemo(
    () => providerConfigs.find(config => config.providerId === selectedProviderId) || null,
    [providerConfigs, selectedProviderId]
  );

  const connectedProviderConfigs = useMemo(
    () => providerConfigs.filter(config => config.apiKey.trim()),
    [providerConfigs]
  );

  const activePreset = useMemo(
    () => AI_PROVIDER_PRESETS.find(provider => provider.id === selectedProviderId) || AI_PROVIDER_PRESETS[0],
    [selectedProviderId]
  );

  const currentModelId =
    (activeSession?.providerId === selectedProviderId ? activeSession.activeModelId : '') ||
    draftModelId ||
    activeConfig?.activeModelId ||
    activeConfig?.enabledModelIds[0] ||
    '';

  const filteredProviders = useMemo(() => {
    const needle = providerSearchQuery.trim().toLowerCase();
    if (!needle) return connectedProviderConfigs;
    return connectedProviderConfigs.filter(config => {
      const preset = AI_PROVIDER_PRESETS.find(provider => provider.id === config.providerId);
      return [
        config.label,
        config.providerId,
        config.activeModelId,
        ...(preset?.searchTokens || []),
      ]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(needle));
    });
  }, [connectedProviderConfigs, providerSearchQuery]);

  const filteredModelIds = useMemo(() => {
    const needle = modelSearchQuery.trim().toLowerCase();
    const enabledModelIds = activeConfig?.enabledModelIds || [];
    if (!needle) return enabledModelIds;
    return enabledModelIds.filter(modelId => modelId.toLowerCase().includes(needle));
  }, [activeConfig?.enabledModelIds, modelSearchQuery]);

  const updateSessions = (nextSessions: ReaderAiSession[]) => {
    setSessions(nextSessions);
    saveReaderAiSessions(bookId, nextSessions);
  };

  const ensureActiveSession = async (mode: ReaderAiWorkflowMode, prompt: string): Promise<ReaderAiSession> => {
    if (activeSession) return activeSession;
    const config = await getReaderAiConfig(selectedProviderId);
    const nextSession = createReaderAiSession({
      bookId,
      title: makeSessionTitle(prompt, mode, chapterTitle, bookTitle),
      providerId: config.providerId,
      activeModelId: currentModelId || config.activeModelId,
      currentChapterIndex,
    });
    const nextSessions = [nextSession, ...loadReaderAiSessions(bookId)];
    updateSessions(nextSessions);
    setActiveSessionId(nextSession.id);
    return nextSession;
  };

  const handleProviderSelect = (providerId: AiProviderId) => {
    const config = providerConfigs.find(item => item.providerId === providerId);
    const nextModelId = config?.activeModelId || config?.enabledModelIds[0] || '';
    setSelectedProviderId(providerId);
    setDraftModelId(nextModelId);
    setProviderSearchQuery('');
    setProviderMenuVisible(false);
    setModelMenuVisible(false);
    if (!activeSession) return;
    const nextSessions = loadReaderAiSessions(bookId).map(session =>
      session.id === activeSession.id
        ? { ...session, providerId, activeModelId: nextModelId, updatedAt: new Date().toISOString() }
        : session
    );
    updateSessions(nextSessions);
  };

  const handleModelSelect = (modelId: string) => {
    setDraftModelId(modelId);
    setModelSearchQuery('');
    setModelMenuVisible(false);
    if (!activeSession) return;
    const nextSessions = loadReaderAiSessions(bookId).map(session =>
      session.id === activeSession.id
        ? { ...session, activeModelId: modelId, updatedAt: new Date().toISOString() }
        : session
    );
    updateSessions(nextSessions);
  };

  const toggleRunOption = (option: keyof ReaderAiRunOptions) => {
    setRunOptions(current => {
      if (option === 'deepResearch') {
        return {
          ...current,
          deepResearch: !current.deepResearch,
          thinking: !current.deepResearch ? false : current.thinking,
        };
      }
      if (option === 'thinking') {
        return {
          ...current,
          thinking: !current.thinking,
          deepResearch: !current.thinking ? false : current.deepResearch,
        };
      }
      return { ...current, webSearch: !current.webSearch };
    });
  };

  const refreshActiveProviderModels = async () => {
    if (!activeConfig?.apiKey.trim()) {
      setError('Connect and save this provider in Settings before refreshing models here.');
      return;
    }
    setSyncingModels(true);
    setError('');
    try {
      const models = await discoverModelsForConfig(activeConfig);
      if (!models.length) {
        setError(`No models were returned for ${activePreset.shortLabel}.`);
        return;
      }
      const nextConfigs = providerConfigs.map(config =>
        config.providerId === activeConfig.providerId
          ? {
              ...config,
              activeModelId: models.some(model => model.id === config.activeModelId)
                ? config.activeModelId
                : models[0].id,
              enabledModelIds: models.map(model => model.id),
              updatedAt: new Date().toISOString(),
            }
          : config
      );
      await saveReaderAiConfigs(nextConfigs);
      const latest = await refreshProviderConfigs();
      const refreshed = latest.find(config => config.providerId === activeConfig.providerId);
      const nextModelId = refreshed?.activeModelId || refreshed?.enabledModelIds[0] || '';
      setDraftModelId(nextModelId);
      setModelSearchQuery('');
      if (activeSession) {
        const nextSessions = loadReaderAiSessions(bookId).map(session =>
          session.id === activeSession.id
            ? {
                ...session,
                providerId: activeConfig.providerId,
                activeModelId: nextModelId,
                updatedAt: new Date().toISOString(),
              }
            : session
        );
        updateSessions(nextSessions);
      }
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : 'Could not refresh provider models.'
      );
    } finally {
      setSyncingModels(false);
    }
  };

  const runWorkflow = async (mode: ReaderAiWorkflowMode, userPrompt: string) => {
    const config = activeConfig || (await getReaderAiConfig(selectedProviderId));
    const activeModel = currentModelId || config.activeModelId || config.enabledModelIds[0] || '';
    const session = await ensureActiveSession(mode, userPrompt);
    const useReaderTools =
      mode !== 'chat' ||
      /chapter|novel|book|character|scene|plot|event|what happened|summar|explain|who is|why did|when did|where did/i.test(
        userPrompt
      );
    const steps = makeRunningSteps(mode, activePreset.label, activeModel, useReaderTools);
    setRunning(true);
    setRunningTraceExpanded(false);
    setRunningSteps(steps);
    setRunningStepIndex(0);
    setError('');

    const progressTimer = setInterval(() => {
      setRunningStepIndex(current => (current < steps.length - 1 ? current + 1 : current));
    }, 950);

    const userMessage: ReaderAiMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: userPrompt,
      createdAt: new Date().toISOString(),
      workflowMode: mode,
      providerId: config.providerId,
      modelId: activeModel,
    };

    const withUser = loadReaderAiSessions(bookId).map(item =>
      item.id === session.id ? appendReaderAiMessages(item, [userMessage]) : item
    );
    const nextSessions = withUser.some(item => item.id === session.id)
      ? withUser
      : [appendReaderAiMessages(session, [userMessage]), ...loadReaderAiSessions(bookId)];
    updateSessions(nextSessions);

    try {
      const result = await runReaderAiWorkflow({
        config: {
          ...config,
          activeModelId: activeModel,
        },
        bookContext,
        requestedMode: mode,
        userPrompt,
        options: runOptions,
      });
      setRunningStepIndex(steps.length - 1);

      const assistantMessage: ReaderAiMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        text: result.responseText,
        createdAt: new Date().toISOString(),
        workflowMode: result.mode,
        providerId: config.providerId,
        modelId: result.activeModelId,
        thinkingSummary: result.thinkingSummary,
        toolRuns: result.toolRuns,
      };

      const updated = loadReaderAiSessions(bookId).map(item =>
        item.id === session.id
          ? {
              ...appendReaderAiMessages(item, [assistantMessage]),
              providerId: config.providerId,
              activeModelId: result.activeModelId,
              currentChapterIndex,
              title: makeSessionTitle(userPrompt, mode, chapterTitle, bookTitle),
              updatedAt: new Date().toISOString(),
            }
          : item
      );

      updateSessions(updated);
      setTypingMessageId(assistantMessage.id);
      setDraftModelId(result.activeModelId);
    } catch (workflowError) {
      setError(
        workflowError instanceof Error ? workflowError.message : 'The AI workflow could not complete.'
      );
    } finally {
      clearInterval(progressTimer);
      setRunning(false);
    }
  };

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || running) return;
    setInput('');
    await runWorkflow(inferComposerMode(prompt), prompt);
  };

  const deleteSession = () => {
    if (!deleteSessionId) return;
    const next = sessions.filter(session => session.id !== deleteSessionId);
    updateSessions(next);
    if (activeSessionId === deleteSessionId) {
      setActiveSessionId(next[0]?.id || null);
    }
    setDeleteSessionId(null);
  };

  if (!visible) return null;

  const currentStep = runningSteps[Math.min(runningStepIndex, Math.max(0, runningSteps.length - 1))];

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
        <View
          style={[styles.container, { backgroundColor: currentTheme.background, paddingTop: insets.top + 8 }]}
        >
          <View style={styles.header}>
            <PressableScale onPress={() => setDrawerVisible(true)} style={styles.headerButton}>
              <Menu size={24} color={currentTheme.text} />
            </PressableScale>
            <View style={{ flex: 1 }}>
              <ThemedText variant="primary" size="header" weight="bold">
                AI Space
              </ThemedText>
              <ThemedText variant="secondary" size="caption" numberOfLines={1}>
                {activePreset.label}
                {currentModelId ? ` · ${currentModelId}` : ' · No model selected'}
              </ThemedText>
            </View>
            <PressableScale onPress={onClose} style={styles.headerButton}>
              <X size={24} color={currentTheme.text} />
            </PressableScale>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 340 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!activeSession?.messages.length ? (
              <View
                style={[
                  styles.emptyState,
                  {
                    backgroundColor: currentTheme.cardBackground,
                    borderColor: currentTheme.secondaryText + '16',
                  },
                ]}
              >
                <View style={[styles.emptyIcon, { backgroundColor: currentTheme.accent + '16' }]}>
                  <Sparkles size={20} color={currentTheme.accent} />
                </View>
                <ThemedText variant="primary" size="body" weight="semibold">
                  Reader-first AI workflow
                </ThemedText>
                <ThemedText variant="secondary" size="caption" style={styles.centeredText}>
                  Ask about the current chapter, search for a past scene, or summarize the whole novel from local reader context.
                </ThemedText>
              </View>
            ) : null}

            {activeSession?.messages.map(message => {
              const provider =
                AI_PROVIDER_PRESETS.find(item => item.id === message.providerId) || activePreset;
              const shouldAnimate = typingMessageId === message.id;
              const shouldShowTrace =
                message.role === 'assistant' &&
                (Boolean(message.toolRuns?.length) || Boolean(message.thinkingSummary));
              return (
                <Animated.View
                  key={message.id}
                  entering={FadeIn.duration(140)}
                  exiting={FadeOut.duration(100)}
                  style={[
                    styles.messageWrap,
                    message.role === 'user' ? styles.messageWrapUser : styles.messageWrapAssistant,
                  ]}
                >
                  {shouldShowTrace ? (
                    <View
                      style={[
                        styles.workflowCard,
                        {
                          backgroundColor: currentTheme.cardBackground,
                          borderColor: currentTheme.secondaryText + '16',
                        },
                      ]}
                    >
                      <View style={styles.workflowHeader}>
                        <View style={styles.workflowHeaderLeft}>
                          <TerminalSquare size={18} color={provider.accentColor} />
                          <ThemedText variant="primary" size="body" weight="semibold">
                            {message.toolRuns?.length ? 'Workflow trace' : 'Decision trace'}
                          </ThemedText>
                        </View>
                        <ThemedText variant="secondary" size="caption" numberOfLines={1} style={styles.workflowHeaderMeta}>
                          {message.modelId}
                        </ThemedText>
                      </View>

                      {message.toolRuns?.map(run => {
                        const expanded = !!expandedToolIds[run.id];
                        return (
                          <Pressable
                            key={run.id}
                            onPress={() =>
                              setExpandedToolIds(prev => ({ ...prev, [run.id]: !prev[run.id] }))
                            }
                            style={[
                              styles.toolRow,
                              {
                                backgroundColor: currentTheme.background,
                                borderColor: currentTheme.secondaryText + '14',
                              },
                            ]}
                          >
                            <View style={styles.toolDot} />
                            <View style={{ flex: 1, gap: 4 }}>
                              <ThemedText variant="primary" size="caption" weight="semibold">
                                {run.title}
                              </ThemedText>
                              {run.subtitle ? (
                                <ThemedText variant="secondary" size="caption" numberOfLines={expanded ? undefined : 1}>
                                  {run.subtitle}
                                </ThemedText>
                              ) : null}
                              <ThemedText variant="secondary" size="caption" numberOfLines={expanded ? undefined : 2}>
                                {run.outputPreview}
                              </ThemedText>
                            </View>
                            <ChevronDown
                              size={16}
                              color={currentTheme.secondaryText}
                              style={{ transform: [{ rotate: expanded ? '180deg' : '270deg' }] }}
                            />
                          </Pressable>
                        );
                      })}

                      {message.thinkingSummary ? (
                        <Pressable
                          onPress={() =>
                            setExpandedThoughtIds(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                          }
                          style={[
                            styles.thoughtCard,
                            {
                              backgroundColor: currentTheme.background,
                              borderColor: currentTheme.secondaryText + '14',
                            },
                          ]}
                        >
                          <View style={styles.workflowHeader}>
                            <ThemedText variant="secondary" size="caption" weight="semibold">
                              Model notes
                            </ThemedText>
                            <ChevronDown
                              size={16}
                              color={currentTheme.secondaryText}
                              style={{
                                transform: [{ rotate: expandedThoughtIds[message.id] ? '180deg' : '0deg' }],
                              }}
                            />
                          </View>
                          <ThemedText
                            variant="secondary"
                            size="caption"
                            numberOfLines={expandedThoughtIds[message.id] ? undefined : 2}
                            style={{ lineHeight: 18 }}
                          >
                            {message.thinkingSummary}
                          </ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}

                  <View
                    style={[
                      styles.messageBubble,
                      {
                        alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                        backgroundColor:
                          message.role === 'user' ? currentTheme.accent : currentTheme.cardBackground,
                        borderColor:
                          message.role === 'user'
                            ? currentTheme.accent
                            : currentTheme.secondaryText + '16',
                      },
                    ]}
                  >
                    {message.role === 'assistant' ? (
                      <TypewriterText
                        text={message.text}
                        animate={shouldAnimate}
                        onDone={() => setTypingMessageId(current => (current === message.id ? null : current))}
                        style={{ lineHeight: 22 }}
                      />
                    ) : (
                      <ThemedText style={{ color: '#FFFFFF', lineHeight: 22 }}>{message.text}</ThemedText>
                    )}
                  </View>
                </Animated.View>
              );
            })}

            {!!error ? (
              <View style={[styles.errorBox, { backgroundColor: '#EF444415', borderColor: '#EF444455' }]}>
                <ThemedText style={{ color: '#F87171', fontSize: 13 }}>{error}</ThemedText>
              </View>
            ) : null}

            {running && currentStep ? (
              <Pressable
                onPress={() => setRunningTraceExpanded(current => !current)}
                style={[
                  styles.runningCard,
                  { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' },
                ]}
              >
                <ActivityIndicator size="small" color={currentTheme.accent} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.workflowHeader}>
                    <ThemedText variant="primary" size="body" weight="semibold">
                      {currentStep.title}
                    </ThemedText>
                    <ChevronDown
                      size={16}
                      color={currentTheme.secondaryText}
                      style={{ transform: [{ rotate: runningTraceExpanded ? '180deg' : '0deg' }] }}
                    />
                  </View>
                  <ThemedText variant="secondary" size="caption">
                    {currentStep.detail}
                  </ThemedText>
                  {runningTraceExpanded ? (
                    <View style={styles.runningTrace}>
                      {runningSteps.map((step, index) => (
                        <View key={step.id} style={styles.runningTraceRow}>
                          <View
                            style={[
                              styles.runningTraceDot,
                              {
                                backgroundColor:
                                  index < runningStepIndex
                                    ? currentTheme.accent
                                    : index === runningStepIndex
                                      ? currentTheme.accent + '88'
                                      : currentTheme.secondaryText + '33',
                              },
                            ]}
                          />
                          <View style={{ flex: 1 }}>
                            <ThemedText variant="primary" size="caption" weight="semibold">
                              {step.title}
                            </ThemedText>
                            <ThemedText variant="secondary" size="caption">
                              {step.detail}
                            </ThemedText>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            ) : null}
          </ScrollView>

          {!drawerVisible ? (
            <View
              style={[
                styles.composerShell,
                {
                  backgroundColor: currentTheme.background,
                  paddingBottom: Math.max(insets.bottom, 12),
                  bottom: keyboardHeight,
                  borderTopColor: currentTheme.secondaryText + '12',
                },
              ]}
            >
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: currentTheme.secondaryText + '16',
                },
              ]}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                multiline
                placeholder="Ask about this chapter, search for an event, or analyze the whole novel..."
                placeholderTextColor={currentTheme.secondaryText + '88'}
                style={[styles.input, { color: currentTheme.text }]}
              />

              <View style={styles.composerToolbarRow}>
                <PressableScale
                  onPress={() => {
                    setToolMenuVisible(current => !current);
                    setProviderMenuVisible(false);
                    setModelMenuVisible(false);
                  }}
                  style={[
                    styles.plusButton,
                    {
                      backgroundColor: currentTheme.background,
                      borderColor: currentTheme.secondaryText + '18',
                    },
                  ]}
                >
                  <Plus size={20} color={currentTheme.text} />
                </PressableScale>

                <PressableScale
                  onPress={() => {
                    setProviderMenuVisible(current => !current);
                    setModelMenuVisible(false);
                    setToolMenuVisible(false);
                  }}
                  style={[
                    styles.selectorChip,
                    {
                      backgroundColor: currentTheme.background,
                      borderColor: currentTheme.secondaryText + '18',
                    },
                  ]}
                >
                  <ReaderAiProviderIcon glyph={activePreset.iconGlyph} accentColor={activePreset.accentColor} size={24} />
                  <ThemedText variant="primary" size="caption" weight="semibold" numberOfLines={1} style={styles.selectorText}>
                    {activePreset.shortLabel}
                  </ThemedText>
                  <ChevronDown size={16} color={currentTheme.secondaryText} />
                </PressableScale>

                <PressableScale
                  onPress={handleSend}
                  style={[styles.sendButton, { backgroundColor: currentTheme.accent, opacity: running ? 0.7 : 1 }]}
                >
                  {running ? <ActivityIndicator size="small" color="#FFF" /> : <Send size={18} color="#FFF" />}
                </PressableScale>
              </View>

              <View style={styles.composerToolbarRow}>
                <PressableScale
                  onPress={() => {
                    setModelMenuVisible(current => !current);
                    setProviderMenuVisible(false);
                    setToolMenuVisible(false);
                  }}
                  style={[
                    styles.selectorChipWide,
                    {
                      backgroundColor: currentTheme.background,
                      borderColor: currentTheme.secondaryText + '18',
                    },
                  ]}
                >
                  <ReaderAiProviderIcon glyph={activePreset.iconGlyph} accentColor={activePreset.accentColor} size={24} />
                  <ThemedText variant="primary" size="caption" weight="semibold" numberOfLines={1} ellipsizeMode="tail" style={styles.selectorText}>
                    {currentModelId || 'Select a model'}
                  </ThemedText>
                  <ChevronDown size={16} color={currentTheme.secondaryText} />
                </PressableScale>
              </View>
            </View>

            {toolMenuVisible ? (
              <View
                style={[
                  styles.floatingMenu,
                  styles.toolMenu,
                  {
                    bottom: 182,
                    backgroundColor: currentTheme.cardBackground,
                    borderColor: currentTheme.secondaryText + '18',
                  },
                ]}
              >
                <Pressable style={styles.menuToggleRow} onPress={() => toggleRunOption('thinking')}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="primary" size="caption" weight="semibold">Thinking</ThemedText>
                    <ThemedText variant="secondary" size="caption">Stronger step-by-step reasoning trace.</ThemedText>
                  </View>
                  <View style={[styles.togglePill, { backgroundColor: runOptions.thinking ? currentTheme.accent : currentTheme.background, borderColor: currentTheme.secondaryText + '18' }]}>
                    <View style={[styles.toggleThumb, { alignSelf: runOptions.thinking ? 'flex-end' : 'flex-start', backgroundColor: runOptions.thinking ? '#FFF' : currentTheme.secondaryText }]} />
                  </View>
                </Pressable>
                <Pressable style={styles.menuToggleRow} onPress={() => toggleRunOption('deepResearch')}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="primary" size="caption" weight="semibold">Deep research</ThemedText>
                    <ThemedText variant="secondary" size="caption">Use broader chapter evidence and slower, heavier synthesis.</ThemedText>
                  </View>
                  <View style={[styles.togglePill, { backgroundColor: runOptions.deepResearch ? currentTheme.accent : currentTheme.background, borderColor: currentTheme.secondaryText + '18' }]}>
                    <View style={[styles.toggleThumb, { alignSelf: runOptions.deepResearch ? 'flex-end' : 'flex-start', backgroundColor: runOptions.deepResearch ? '#FFF' : currentTheme.secondaryText }]} />
                  </View>
                </Pressable>
                <Pressable style={styles.menuToggleRow} onPress={() => toggleRunOption('webSearch')}>
                  <View style={{ flex: 1 }}>
                    <ThemedText variant="primary" size="caption" weight="semibold">Web search</ThemedText>
                    <ThemedText variant="secondary" size="caption">Allow external-search guidance in supported flows.</ThemedText>
                  </View>
                  <View style={[styles.togglePill, { backgroundColor: runOptions.webSearch ? currentTheme.accent : currentTheme.background, borderColor: currentTheme.secondaryText + '18' }]}>
                    <View style={[styles.toggleThumb, { alignSelf: runOptions.webSearch ? 'flex-end' : 'flex-start', backgroundColor: runOptions.webSearch ? '#FFF' : currentTheme.secondaryText }]} />
                  </View>
                </Pressable>
              </View>
            ) : null}

            {providerMenuVisible ? (
              <View
                style={[
                  styles.floatingMenu,
                  styles.providerMenu,
                  {
                    bottom: 182,
                    backgroundColor: currentTheme.cardBackground,
                    borderColor: currentTheme.secondaryText + '18',
                  },
                ]}
              >
                <View style={[styles.searchShell, { borderColor: currentTheme.secondaryText + '18', backgroundColor: currentTheme.background }]}>
                  <Search size={16} color={currentTheme.secondaryText} />
                  <TextInput
                    value={providerSearchQuery}
                    onChangeText={setProviderSearchQuery}
                    placeholder="Search connected providers"
                    placeholderTextColor={currentTheme.secondaryText + '88'}
                    style={[styles.searchInput, { color: currentTheme.text }]}
                  />
                </View>

                <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
                  {filteredProviders.map(config => {
                    const preset = AI_PROVIDER_PRESETS.find(provider => provider.id === config.providerId) || activePreset;
                    return (
                      <Pressable
                        key={config.providerId}
                        onPress={() => handleProviderSelect(config.providerId)}
                        style={styles.menuRow}
                      >
                        <ReaderAiProviderIcon glyph={preset.iconGlyph} accentColor={preset.accentColor} size={24} />
                        <View style={{ flex: 1 }}>
                          <ThemedText variant="primary" size="caption" weight="semibold">
                            {preset.label}
                          </ThemedText>
                          <ThemedText variant="secondary" size="caption" numberOfLines={1}>
                            {config.activeModelId || 'No active model'}
                          </ThemedText>
                        </View>
                        {selectedProviderId === config.providerId ? (
                          <Check size={16} color={currentTheme.accent} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                  {!filteredProviders.length ? (
                    <ThemedText variant="secondary" size="caption" style={styles.emptyMenuText}>
                      No connected providers match this search.
                    </ThemedText>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}

            {modelMenuVisible ? (
              <View
                style={[
                  styles.floatingMenu,
                  styles.modelMenu,
                  {
                    bottom: 182,
                    backgroundColor: currentTheme.cardBackground,
                    borderColor: currentTheme.secondaryText + '18',
                  },
                ]}
              >
                <View style={styles.menuTopRow}>
                  <View style={[styles.searchShell, styles.searchShellFlex, { borderColor: currentTheme.secondaryText + '18', backgroundColor: currentTheme.background }]}>
                    <Search size={16} color={currentTheme.secondaryText} />
                    <TextInput
                      value={modelSearchQuery}
                      onChangeText={setModelSearchQuery}
                      placeholder="Search models"
                      placeholderTextColor={currentTheme.secondaryText + '88'}
                      style={[styles.searchInput, { color: currentTheme.text }]}
                    />
                  </View>
                  <PressableScale
                    onPress={() => void refreshActiveProviderModels()}
                    style={[styles.refreshButton, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '18' }]}
                  >
                    {syncingModels ? (
                      <ActivityIndicator size="small" color={currentTheme.accent} />
                    ) : (
                      <RefreshCw size={16} color={currentTheme.text} />
                    )}
                  </PressableScale>
                </View>

                <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
                  {filteredModelIds.map(modelId => (
                    <Pressable key={modelId} onPress={() => handleModelSelect(modelId)} style={styles.menuRow}>
                      <ReaderAiProviderIcon glyph={activePreset.iconGlyph} accentColor={activePreset.accentColor} size={24} />
                      <ThemedText variant="primary" size="caption" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                        {modelId}
                      </ThemedText>
                      {currentModelId === modelId ? <Check size={16} color={currentTheme.accent} /> : null}
                    </Pressable>
                  ))}
                  {!filteredModelIds.length ? (
                    <View style={styles.emptyMenuWrap}>
                      <ThemedText variant="secondary" size="caption" style={styles.emptyMenuText}>
                        No enabled models were found for this provider yet.
                      </ThemedText>
                      <PressableScale
                        onPress={() => void refreshActiveProviderModels()}
                        style={[styles.inlineButton, { borderColor: currentTheme.secondaryText + '18', backgroundColor: currentTheme.background }]}
                      >
                        <RefreshCw size={14} color={currentTheme.text} />
                        <ThemedText variant="primary" size="caption" weight="semibold">
                          Refresh models
                        </ThemedText>
                      </PressableScale>
                    </View>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}
            </View>
          ) : null}

          {drawerVisible ? (
            <View style={styles.drawerOverlay}>
              <View
                style={[
                  styles.drawer,
                  {
                    backgroundColor: currentTheme.cardBackground,
                    borderRightColor: currentTheme.secondaryText + '18',
                  },
                ]}
              >
                <View style={styles.drawerHeader}>
                  <ThemedText variant="primary" size="body" weight="semibold">
                    Sessions
                  </ThemedText>
                  <PressableScale onPress={() => setDrawerVisible(false)} style={styles.headerButton}>
                    <X size={18} color={currentTheme.text} />
                  </PressableScale>
                </View>

                <Pressable
                  style={[styles.drawerAction, { borderColor: currentTheme.secondaryText + '16', backgroundColor: currentTheme.background }]}
                  onPress={() => {
                    setActiveSessionId(null);
                    setInput('');
                    setDrawerVisible(false);
                  }}
                >
                  <Plus size={16} color={currentTheme.text} />
                  <ThemedText variant="primary" size="caption" weight="semibold">
                    New session
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={[styles.drawerAction, { borderColor: currentTheme.secondaryText + '16', backgroundColor: currentTheme.background }]}
                  onPress={() => {
                    setConfigVisible(true);
                    setDrawerVisible(false);
                  }}
                >
                  <Settings2 size={16} color={currentTheme.text} />
                  <ThemedText variant="primary" size="caption" weight="semibold">
                    Manage providers
                  </ThemedText>
                </Pressable>

                <ScrollView contentContainerStyle={{ gap: 10, paddingTop: 12 }}>
                  {sessions.map(session => {
                    const provider = AI_PROVIDER_PRESETS.find(item => item.id === session.providerId) || activePreset;
                    const active = session.id === activeSessionId;
                    return (
                      <Pressable
                        key={session.id}
                        onPress={() => {
                          setActiveSessionId(session.id);
                          setSelectedProviderId(session.providerId);
                          setDraftModelId(session.activeModelId);
                          setDrawerVisible(false);
                        }}
                        onLongPress={() => setDeleteSessionId(session.id)}
                        style={[
                          styles.drawerSession,
                          {
                            backgroundColor: active ? provider.accentColor + '16' : currentTheme.background,
                            borderColor: active ? provider.accentColor : currentTheme.secondaryText + '16',
                          },
                        ]}
                      >
                        <ReaderAiProviderIcon glyph={provider.iconGlyph} accentColor={provider.accentColor} size={24} />
                        <View style={{ flex: 1 }}>
                          <ThemedText variant="primary" size="caption" weight="semibold" numberOfLines={1}>
                            {session.title}
                          </ThemedText>
                          <ThemedText variant="secondary" size="caption" numberOfLines={1}>
                            {session.activeModelId || provider.shortLabel}
                          </ThemedText>
                        </View>
                        <Trash2 size={14} color={currentTheme.secondaryText} />
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
              <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerVisible(false)} />
            </View>
          ) : null}
        </View>
      </Modal>

      <ReaderAiConfigModal
        visible={configVisible}
        onClose={() => setConfigVisible(false)}
        initialProviderId={selectedProviderId}
        onSaved={configs => {
          setProviderConfigs(configs);
          const stillConnected = configs.find(
            item => item.providerId === selectedProviderId && item.apiKey.trim()
          );
          const preferred = stillConnected?.providerId || pickPreferredProviderId(configs);
          const config = configs.find(item => item.providerId === preferred);
          setSelectedProviderId(preferred);
          setDraftModelId(config?.activeModelId || config?.enabledModelIds[0] || '');
        }}
      />

      <AppDialog
        visible={!!deleteSessionId}
        title="Delete AI Session?"
        message="This removes the saved reader AI conversation for this book."
        tone="danger"
        onClose={() => setDeleteSessionId(null)}
        actions={[
          { label: 'Cancel', variant: 'secondary', onPress: () => setDeleteSessionId(null) },
          { label: 'Delete', variant: 'danger', onPress: deleteSession },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  emptyState: {
    borderWidth: 1,
    borderRadius: 26,
    padding: 18,
    gap: 12,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredText: {
    lineHeight: 18,
    textAlign: 'center',
  },
  messageWrap: {
    gap: 10,
  },
  messageWrapUser: {
    alignItems: 'flex-end',
  },
  messageWrapAssistant: {
    alignItems: 'flex-start',
  },
  workflowCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    gap: 10,
  },
  workflowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  workflowHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workflowHeaderMeta: {
    flexShrink: 1,
    textAlign: 'right',
  },
  toolRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  toolDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6B7280',
    marginTop: 6,
  },
  thoughtCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  messageBubble: {
    maxWidth: '92%',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  runningCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  runningTrace: {
    gap: 10,
    paddingTop: 6,
  },
  runningTraceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  runningTraceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  composerShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  composer: {
    borderWidth: 1,
    borderRadius: 26,
    padding: 10,
    gap: 10,
  },
  input: {
    minHeight: 64,
    maxHeight: 140,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  composerToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  plusButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorChip: {
    minWidth: 124,
    maxWidth: 150,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectorChipWide: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectorText: {
    flex: 1,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingMenu: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 50,
    borderWidth: 1,
    borderRadius: 22,
    padding: 12,
    gap: 10,
  },
  toolMenu: {
    bottom: 182,
    left: 16,
    right: undefined,
    width: 292,
  },
  providerMenu: {
    bottom: 182,
  },
  modelMenu: {
    bottom: 182,
  },
  menuAction: {
    minHeight: 42,
    borderRadius: 14,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  menuToggleRow: {
    minHeight: 62,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  togglePill: {
    width: 48,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  menuRow: {
    minHeight: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  searchShell: {
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchShellFlex: {
    flex: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  menuTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyMenuWrap: {
    gap: 10,
    paddingVertical: 8,
  },
  emptyMenuText: {
    lineHeight: 18,
  },
  inlineButton: {
    minHeight: 38,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: '#00000040',
  },
  drawer: {
    width: 292,
    borderRightWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drawerAction: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  drawerSession: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
