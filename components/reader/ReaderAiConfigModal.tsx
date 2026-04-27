import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Check,
  ChevronLeft,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react-native';
import { useTheme } from '@/context/ThemeContext';
import { ThemedText } from '@/components/ui/ThemedText';
import { PressableScale } from '@/components/ui/PressableScale';
import { ReaderAiProviderIcon } from '@/components/reader/ReaderAiProviderIcon';
import {
  AI_PROVIDER_PRESETS,
  clearReaderAiProvider,
  discoverModelsForConfig,
  getDefaultReaderAiConfigs,
  listReaderAiConfigs,
  saveReaderAiConfigs,
} from '@/utils/reader-ai';
import type { AiProviderId, AiProviderModel, ReaderAiProviderConfig } from '@/types/reader-ai';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: (configs: ReaderAiProviderConfig[]) => void;
  initialProviderId?: AiProviderId;
}

type Screen = 'providers' | 'picker' | 'detail';

const PROVIDER_ORDER: AiProviderId[] = [
  'openai',
  'google',
  'anthropic',
  'openrouter',
  'nvidia',
  'moonshot',
  'minimax',
  'custom-openai',
];

function defaultDetailProviderId(initialProviderId: AiProviderId): AiProviderId {
  return PROVIDER_ORDER.includes(initialProviderId) ? initialProviderId : 'openai';
}

export function ReaderAiConfigModal({
  visible,
  onClose,
  onSaved,
  initialProviderId = 'google',
}: Props) {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>('providers');
  const [configs, setConfigs] = useState<ReaderAiProviderConfig[]>(getDefaultReaderAiConfigs());
  const [selectedProviderId, setSelectedProviderId] = useState<AiProviderId>(defaultDetailProviderId(initialProviderId));
  const [discoveredModels, setDiscoveredModels] = useState<Record<string, AiProviderModel[]>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!visible) return;
    setScreen('providers');
    setSearchQuery('');
    setModelSearchQuery('');
    setMessage('');
    setToast('');
    setSelectedProviderId(defaultDetailProviderId(initialProviderId));
    setConfigs(getDefaultReaderAiConfigs());
    listReaderAiConfigs().then(next => setConfigs(next));
  }, [initialProviderId, visible]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(timeout);
  }, [toast]);

  const providerPresets = useMemo(
    () =>
      PROVIDER_ORDER.map(id => AI_PROVIDER_PRESETS.find(provider => provider.id === id)).filter(
        (provider): provider is NonNullable<(typeof AI_PROVIDER_PRESETS)[number]> => Boolean(provider)
      ),
    []
  );

  const connectedProviders = useMemo(
    () =>
      providerPresets.filter(provider =>
        configs.some(config => config.providerId === provider.id && config.apiKey.trim())
      ),
    [configs, providerPresets]
  );

  const popularProviders = useMemo(
    () => providerPresets.filter(provider => provider.featured),
    [providerPresets]
  );

  const availablePopularProviders = useMemo(
    () =>
      popularProviders.filter(
        provider => !configs.some(config => config.providerId === provider.id && config.apiKey.trim())
      ),
    [configs, popularProviders]
  );

  const filteredProviders = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const unconnectedProviders = providerPresets.filter(
      provider => !configs.some(config => config.providerId === provider.id && config.apiKey.trim())
    );
    if (!needle) return unconnectedProviders;
    return unconnectedProviders.filter(provider =>
      [provider.label, provider.shortLabel, ...provider.searchTokens].some(token =>
        token.toLowerCase().includes(needle)
      )
    );
  }, [configs, providerPresets, searchQuery]);

  const activePreset = useMemo(
    () => AI_PROVIDER_PRESETS.find(provider => provider.id === selectedProviderId) || AI_PROVIDER_PRESETS[0],
    [selectedProviderId]
  );

  const activeConfig = useMemo(
    () =>
      configs.find(config => config.providerId === selectedProviderId) ||
      getDefaultReaderAiConfigs().find(config => config.providerId === selectedProviderId) ||
      null,
    [configs, selectedProviderId]
  );

  const activeModels = useMemo(
    () => discoveredModels[selectedProviderId] || [],
    [discoveredModels, selectedProviderId]
  );

  const filteredActiveModels = useMemo(() => {
    const needle = modelSearchQuery.trim().toLowerCase();
    if (!needle) return activeModels;
    return activeModels.filter(model =>
      [model.id, model.label, model.description].some(value =>
        value.toLowerCase().includes(needle)
      )
    );
  }, [activeModels, modelSearchQuery]);

  useEffect(() => {
    if (!visible || screen !== 'detail' || !activeConfig?.apiKey.trim() || activeModels.length || busy) {
      return;
    }
    void refreshModels();
  }, [activeConfig?.apiKey, activeModels.length, busy, screen, selectedProviderId, visible]);

  const patchActiveConfig = (patch: Partial<ReaderAiProviderConfig>) => {
    const invalidatesModels = patch.apiKey !== undefined || patch.endpointUrl !== undefined;
    if (invalidatesModels) {
      setDiscoveredModels(prev => ({ ...prev, [selectedProviderId]: [] }));
    }
    setConfigs(prev =>
      prev.map(config =>
        config.providerId === selectedProviderId
          ? {
              ...config,
              ...(invalidatesModels
                ? {
                    activeModelId: '',
                    enabledModelIds: [],
                  }
                : {}),
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : config
      )
    );
  };

  const persistConfigs = async (nextConfigs: ReaderAiProviderConfig[], successMessage: string) => {
    setSaving(true);
    setMessage('');
    try {
      await saveReaderAiConfigs(nextConfigs);
      const latest = await listReaderAiConfigs();
      setConfigs(latest);
      onSaved?.(latest);
      setToast(successMessage);
      return latest;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save AI provider settings.');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const refreshModels = async () => {
    if (!activeConfig) return;
    setBusy(true);
    setMessage('');
    try {
      const models = await discoverModelsForConfig(activeConfig);
      setDiscoveredModels(prev => ({ ...prev, [selectedProviderId]: models }));
      if (models.length) {
        patchActiveConfig({
          activeModelId: models.some(model => model.id === activeConfig.activeModelId)
            ? activeConfig.activeModelId
            : models[0].id,
          enabledModelIds: models.map(model => model.id),
        });
        setMessage(`Loaded ${models.length} models for ${activePreset.shortLabel}.`);
      } else {
        setMessage(`No models were returned for ${activePreset.shortLabel}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh models.');
    } finally {
      setBusy(false);
    }
  };

  const openProviderDetail = (providerId: AiProviderId) => {
    setSelectedProviderId(providerId);
    setModelSearchQuery('');
    setMessage('');
    setScreen('detail');
  };

  const saveProvider = async () => {
    if (!activeConfig) return;
    if (!activeConfig.apiKey.trim()) {
      setMessage('Paste a valid API key before saving this provider.');
      return;
    }

    let models = activeModels;
    let nextConfig = activeConfig;

    if (!models.length) {
      setBusy(true);
      try {
        models = await discoverModelsForConfig(activeConfig);
        setDiscoveredModels(prev => ({ ...prev, [selectedProviderId]: models }));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not discover models for this provider.');
      } finally {
        setBusy(false);
      }
    }

    if (models.length) {
      nextConfig = {
        ...nextConfig,
        activeModelId: nextConfig.activeModelId || models[0].id,
        enabledModelIds: models.map(model => model.id),
        updatedAt: new Date().toISOString(),
      };
    }

    const nextConfigs = configs.map(config =>
      config.providerId === selectedProviderId ? nextConfig : config
    );
    const saved = await persistConfigs(nextConfigs, `${activePreset.shortLabel} connected.`);
    if (saved) {
      setScreen('providers');
    }
  };

  const disconnectProvider = async (providerId: AiProviderId) => {
    setSaving(true);
    setMessage('');
    try {
      await clearReaderAiProvider(providerId);
      const latest = await listReaderAiConfigs();
      setConfigs(latest);
      setDiscoveredModels(prev => ({ ...prev, [providerId]: [] }));
      onSaved?.(latest);
      const provider = AI_PROVIDER_PRESETS.find(item => item.id === providerId);
      setToast(`${provider?.shortLabel || 'Provider'} disconnected.`);
      if (selectedProviderId === providerId && screen === 'detail') {
        setScreen('providers');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not disconnect this provider.');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: currentTheme.background, paddingTop: insets.top + 8 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <PressableScale
            onPress={() => {
              if (screen === 'providers') {
                onClose();
                return;
              }
              if (screen === 'detail') {
                setScreen('providers');
                setMessage('');
                return;
              }
              setScreen('providers');
            }}
            style={styles.headerButton}
          >
            {screen === 'providers' ? (
              <X size={22} color={currentTheme.text} />
            ) : (
              <ChevronLeft size={22} color={currentTheme.text} />
            )}
          </PressableScale>

          <View style={{ flex: 1 }}>
            <ThemedText variant="primary" size="header" weight="bold">
              {screen === 'providers'
                ? 'AI Providers'
                : screen === 'picker'
                  ? 'Connect Provider'
                  : `Connect ${activePreset.shortLabel}`}
            </ThemedText>
            <ThemedText variant="secondary" size="caption" numberOfLines={1}>
              {screen === 'providers'
                ? 'Connected providers, active models, and searchable connect flow.'
                : screen === 'picker'
                  ? 'Find a provider, then open its connection screen.'
                  : activePreset.connectDescription}
            </ThemedText>
          </View>

        </View>

        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {screen === 'providers' ? (
            <>
              <View style={[styles.sectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
                <View style={styles.sectionHeader}>
                  <ThemedText variant="primary" size="body" weight="semibold">
                    Connected providers
                  </ThemedText>
                  <ThemedText variant="secondary" size="caption">
                    {connectedProviders.length}
                  </ThemedText>
                </View>

                {connectedProviders.length ? (
                  connectedProviders.map(provider => {
                    const config = configs.find(item => item.providerId === provider.id);
                    return (
                      <View
                        key={provider.id}
                        style={[
                          styles.providerCard,
                          {
                            backgroundColor: currentTheme.background,
                            borderColor: currentTheme.secondaryText + '16',
                          },
                        ]}
                      >
                        <Pressable
                          onPress={() => openProviderDetail(provider.id)}
                          style={styles.providerCardPressable}
                        >
                          <ReaderAiProviderIcon glyph={provider.iconGlyph} accentColor={provider.accentColor} size={36} />
                          <View style={{ flex: 1, gap: 4 }}>
                            <ThemedText variant="primary" size="body" weight="semibold">
                              {provider.label}
                            </ThemedText>
                            <ThemedText variant="secondary" size="caption" numberOfLines={1}>
                              {config?.activeModelId || 'Model not selected yet'}
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.apiBadge,
                              { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' },
                            ]}
                          >
                            <ThemedText variant="secondary" size="caption" weight="semibold">
                              API key
                            </ThemedText>
                          </View>
                        </Pressable>

                        <View style={styles.providerCardActions}>
                          <PressableScale
                            onPress={() => openProviderDetail(provider.id)}
                            style={[styles.secondaryButton, { borderColor: currentTheme.secondaryText + '18' }]}
                          >
                            <Link2 size={15} color={currentTheme.text} />
                            <ThemedText variant="primary" size="caption" weight="semibold">
                              Manage
                            </ThemedText>
                          </PressableScale>
                          <PressableScale
                            onPress={() => void disconnectProvider(provider.id)}
                            style={[styles.secondaryButton, { borderColor: '#EF444455', backgroundColor: '#EF444412' }]}
                          >
                            <Trash2 size={15} color="#EF4444" />
                            <ThemedText style={{ color: '#EF4444', fontSize: 12, fontWeight: '700' }}>
                              Disconnect
                            </ThemedText>
                          </PressableScale>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <View style={[styles.emptyCard, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '16' }]}>
                    <Sparkles size={18} color={currentTheme.accent} />
                    <ThemedText variant="secondary" size="caption" style={{ flex: 1, lineHeight: 18 }}>
                      Connect a provider here once. The reader and AI panel will use the same saved provider state.
                    </ThemedText>
                  </View>
                )}
              </View>

              <View style={[styles.sectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
                <View style={styles.sectionHeader}>
                  <ThemedText variant="primary" size="body" weight="semibold">
                    Popular providers
                  </ThemedText>
                </View>

                {availablePopularProviders.map(provider => {
                  const connected = configs.some(config => config.providerId === provider.id && config.apiKey.trim());
                  return (
                    <View
                      key={provider.id}
                      style={[
                        styles.providerListRow,
                        {
                          borderBottomColor: currentTheme.secondaryText + '12',
                        },
                      ]}
                    >
                      <View style={styles.providerListMeta}>
                        <ReaderAiProviderIcon glyph={provider.iconGlyph} accentColor={provider.accentColor} size={34} />
                        <View style={{ flex: 1, gap: 4 }}>
                          <ThemedText variant="primary" size="body" weight="semibold">
                            {provider.label}
                          </ThemedText>
                          <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                            {provider.connectDescription}
                          </ThemedText>
                        </View>
                      </View>
                      <PressableScale
                        onPress={() => openProviderDetail(provider.id)}
                        style={[styles.connectButton, { borderColor: currentTheme.secondaryText + '18' }]}
                      >
                        <Plus size={15} color={currentTheme.text} />
                        <ThemedText variant="primary" size="caption" weight="semibold">
                          {connected ? 'Manage' : 'Connect'}
                        </ThemedText>
                      </PressableScale>
                    </View>
                  );
                })}

                {!availablePopularProviders.length ? (
                  <View style={[styles.emptyCard, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '16' }]}>
                    <Sparkles size={18} color={currentTheme.accent} />
                    <ThemedText variant="secondary" size="caption" style={{ flex: 1, lineHeight: 18 }}>
                      All featured providers are already connected. Use Manage on a connected card to edit or disconnect them.
                    </ThemedText>
                  </View>
                ) : null}

                <PressableScale onPress={() => setScreen('picker')} style={styles.showMoreButton}>
                  <ThemedText variant="accent" size="body" weight="semibold">
                    Show more providers
                  </ThemedText>
                </PressableScale>
              </View>
            </>
          ) : null}

          {screen === 'picker' ? (
            <View style={[styles.sectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
              <View
                style={[
                  styles.searchShell,
                  {
                    backgroundColor: currentTheme.background,
                    borderColor: currentTheme.secondaryText + '16',
                  },
                ]}
              >
                <Search size={18} color={currentTheme.secondaryText} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search providers"
                  placeholderTextColor={currentTheme.secondaryText + '88'}
                  style={[styles.searchInput, { color: currentTheme.text }]}
                />
              </View>

              <ThemedText variant="secondary" size="caption" weight="semibold" style={{ marginTop: 6 }}>
                Other
              </ThemedText>

              {filteredProviders.map(provider => (
                <Pressable
                  key={provider.id}
                  onPress={() => openProviderDetail(provider.id)}
                  style={[
                    styles.providerSearchRow,
                    { borderBottomColor: currentTheme.secondaryText + '12' },
                  ]}
                >
                  <ReaderAiProviderIcon glyph={provider.iconGlyph} accentColor={provider.accentColor} size={32} />
                  <ThemedText variant="primary" size="body" weight="semibold">
                    {provider.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {screen === 'detail' && activeConfig ? (
            <>
              <View style={[styles.sectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
                <View style={styles.detailHeader}>
                  <ReaderAiProviderIcon glyph={activePreset.iconGlyph} accentColor={activePreset.accentColor} size={38} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText variant="primary" size="title" weight="bold">
                      Connect {activePreset.shortLabel}
                    </ThemedText>
                    <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                      Enter your {activePreset.shortLabel} API key, load the available models, and pick the default model Miyo should activate.
                    </ThemedText>
                  </View>
                </View>

                <View style={{ gap: 8 }}>
                  <ThemedText variant="secondary" size="caption" weight="semibold">
                    {activePreset.shortLabel} API key
                  </ThemedText>
                  <TextInput
                    value={activeConfig.apiKey}
                    onChangeText={value => patchActiveConfig({ apiKey: value })}
                    placeholder="API key"
                    placeholderTextColor={currentTheme.secondaryText + '88'}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      {
                        backgroundColor: currentTheme.background,
                        borderColor: currentTheme.secondaryText + '16',
                        color: currentTheme.text,
                      },
                    ]}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  <ThemedText variant="secondary" size="caption" weight="semibold">
                    Endpoint
                  </ThemedText>
                  <TextInput
                    value={activeConfig.endpointUrl || activePreset.apiBaseUrl}
                    onChangeText={value =>
                      patchActiveConfig({
                        endpointUrl: value,
                        userSuppliedEndpoint: true,
                      })
                    }
                    placeholder={activePreset.apiBaseUrl}
                    placeholderTextColor={currentTheme.secondaryText + '88'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      {
                        backgroundColor: currentTheme.background,
                        borderColor: currentTheme.secondaryText + '16',
                        color: currentTheme.text,
                      },
                    ]}
                  />
                </View>

                <PressableScale
                  onPress={refreshModels}
                  style={[
                    styles.refreshButton,
                    {
                      borderColor: currentTheme.secondaryText + '16',
                      backgroundColor: currentTheme.background,
                      opacity: activeConfig.apiKey.trim() ? 1 : 0.55,
                    },
                  ]}
                  disabled={!activeConfig.apiKey.trim() || busy}
                >
                  {busy ? <ActivityIndicator size="small" color={currentTheme.accent} /> : <RefreshCw size={16} color={currentTheme.accent} />}
                  <ThemedText variant="accent" size="caption" weight="semibold">
                    Refresh models
                  </ThemedText>
                </PressableScale>
              </View>

              <View style={[styles.sectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
                <View style={styles.sectionHeader}>
                  <ThemedText variant="primary" size="body" weight="semibold">
                    Active model
                  </ThemedText>
                  <Sparkles size={18} color={currentTheme.accent} />
                </View>
                <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                  Miyo discovers the provider models first, then you choose which model becomes the default inside the reader.
                </ThemedText>

                <View
                  style={[
                    styles.searchShell,
                    {
                      backgroundColor: currentTheme.background,
                      borderColor: currentTheme.secondaryText + '16',
                    },
                  ]}
                >
                  <Search size={18} color={currentTheme.secondaryText} />
                  <TextInput
                    value={modelSearchQuery}
                    onChangeText={setModelSearchQuery}
                    placeholder="Search models"
                    placeholderTextColor={currentTheme.secondaryText + '88'}
                    style={[styles.searchInput, { color: currentTheme.text }]}
                  />
                </View>

                {filteredActiveModels.length ? (
                  filteredActiveModels.map(model => {
                    const active = activeConfig.activeModelId === model.id;
                    return (
                      <Pressable
                        key={model.id}
                        onPress={() =>
                          patchActiveConfig({
                            activeModelId: model.id,
                            enabledModelIds: activeModels.map(item => item.id),
                          })
                        }
                        style={[
                          styles.modelRow,
                          {
                            backgroundColor: active ? `${activePreset.accentColor}14` : currentTheme.background,
                            borderColor: active ? activePreset.accentColor : currentTheme.secondaryText + '16',
                          },
                        ]}
                      >
                        <View style={styles.modelRowMeta}>
                          <ReaderAiProviderIcon glyph={activePreset.iconGlyph} accentColor={activePreset.accentColor} size={28} />
                          <View style={{ flex: 1, gap: 4 }}>
                            <ThemedText variant="primary" size="body" weight="semibold" numberOfLines={1}>
                              {model.label}
                            </ThemedText>
                            <ThemedText variant="secondary" size="caption" numberOfLines={2}>
                              {model.description}
                            </ThemedText>
                          </View>
                        </View>
                        {active ? <Check size={18} color={activePreset.accentColor} /> : null}
                      </Pressable>
                    );
                  })
                ) : activeModels.length ? (
                  <View style={[styles.emptyCard, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '16' }]}>
                    <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                      No models matched that search.
                    </ThemedText>
                  </View>
                ) : (
                  <View style={[styles.emptyCard, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '16' }]}>
                    <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                      Add a working API key, then refresh models. The app no longer relies on hard-coded model presets.
                    </ThemedText>
                  </View>
                )}
              </View>

              <View style={[styles.sectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
                <PressableScale
                  onPress={saveProvider}
                  disabled={saving || !activeConfig.apiKey.trim()}
                  style={[
                    styles.connectCta,
                    {
                      backgroundColor: currentTheme.accent,
                      opacity: saving || !activeConfig.apiKey.trim() ? 0.65 : 1,
                    },
                  ]}
                >
                  {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Check size={18} color="#FFF" />}
                  <ThemedText style={{ color: '#FFF', fontSize: 15, fontWeight: '800' }}>
                    Continue
                  </ThemedText>
                </PressableScale>

                <PressableScale
                  onPress={() => void disconnectProvider(selectedProviderId)}
                  disabled={saving}
                  style={[
                    styles.disconnectButton,
                    {
                      borderColor: '#EF444455',
                      backgroundColor: '#EF444412',
                      opacity: saving ? 0.6 : 1,
                    },
                  ]}
                >
                  <Trash2 size={16} color="#EF4444" />
                  <ThemedText style={{ color: '#EF4444', fontSize: 13, fontWeight: '700' }}>
                    Disconnect provider
                  </ThemedText>
                </PressableScale>
              </View>
            </>
          ) : null}

          {!!message ? (
            <View style={[styles.messageBox, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
              <ThemedText variant="secondary" size="caption">
                {message}
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>

        {toast ? (
          <View
            pointerEvents="none"
            style={[
              styles.toast,
              {
                bottom: Math.max(insets.bottom, 16),
                backgroundColor: currentTheme.cardBackground,
                borderColor: currentTheme.secondaryText + '16',
              },
            ]}
          >
            <View style={[styles.toastIcon, { backgroundColor: `${currentTheme.accent}18` }]}>
              <Check size={16} color={currentTheme.accent} />
            </View>
            <ThemedText variant="primary" size="body" weight="semibold" style={{ flex: 1 }}>
              {toast}
            </ThemedText>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
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
  content: {
    paddingHorizontal: 16,
    gap: 14,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    gap: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  providerCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    gap: 10,
  },
  providerCardPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  providerCardActions: {
    flexDirection: 'row',
    gap: 10,
  },
  apiBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryButton: {
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 1,
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  providerListRow: {
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  providerListMeta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  connectButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  showMoreButton: {
    paddingVertical: 6,
  },
  searchShell: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  providerSearchRow: {
    minHeight: 56,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  input: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  refreshButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  connectCta: {
    minHeight: 50,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disconnectButton: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modelRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modelRowMeta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  messageBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toastIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
