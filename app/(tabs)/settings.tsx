import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Modal, Pressable, TextInput, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useLibrary } from '@/context/LibraryContext';
import { useAuth } from '@/context/AuthContext';
import { useSync, SYNC_ADAPTERS } from '@/context/SyncContext';
import { getDailyReadingGoalMinutes, setDailyReadingGoalMinutes } from '@/utils/reading-stats';
import { ThemedView } from '@/components/ui/ThemedView';
import { ThemedText } from '@/components/ui/ThemedText';
import { PressableScale } from '@/components/ui/PressableScale';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { LoggerModal } from '@/components/ui/LoggerModal';
import { PermissionModal } from '@/components/ui/PermissionModal';
import { DictionaryLibraryModal } from '@/components/dictionary/DictionaryLibraryModal';
import { ReaderAiConfigModal } from '@/components/reader/ReaderAiConfigModal';
import { AppDialog, AppDialogAction, AppDialogTone } from '@/components/ui/AppDialog';
import { fontOptions, defaultTypography, defaultReadingSettings } from '@/types/theme';
import { getNativeFontFamily, isSystemFontValue } from '@/utils/fonts';
import { isGoogleSignInDisabled } from '@/utils/beta-flags';
import { TRANSLATION_LANGUAGES } from '@/utils/inline-translate';
import { AI_PROVIDER_PRESETS, listReaderAiConfigs, pickPreferredProviderId } from '@/utils/reader-ai';
import {
  openAppSettings,
  getStorageDirectory,
  getStorageDirectoryLabel,
  requestStorageDirectory,
  markPermissionGranted,
} from '@/utils/permissions';
import { auditLibraryDuplicates } from '@/utils/book-identity';
import {
  Type,
  SlidersHorizontal,
  Volume2,
  Eye,
  Minimize2,
  Smartphone,
  Database,
  Trash2,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Check,
  X,
  AlignLeft,
  AlignJustify,
  Bug,
  Shield,
  LogIn,
  LogOut,
  Mail,
  Languages,
  Cloud,
  Timer,
  HardDrive,
  ArrowDownToLine,
  BookOpen,
  EyeOff,
  Sparkles,
} from 'lucide-react-native';

function formatStorageBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function SettingsScreen() {
  const {
    currentTheme,
    typography,
    setTypography,
    readingSettings,
    setReadingSettings,
  } = useTheme();
  const { clearCache, rescanLibrary, books, estimateLibraryStorageBytes } = useLibrary();
  const {
    user,
    isAuthenticated,
    signIn,
    signUp,
    signOut,
    signInWithGoogle,
  } = useAuth();
  const { activeAdapterId, setActiveAdapter, isSyncing, lastSyncTime, backupData, restoreData } = useSync();
  const insets = useSafeAreaInsets();
  const [showTypographyModal, setShowTypographyModal] = useState(false);
  const [showLoggerModal, setShowLoggerModal] = useState(false);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showDictionaryLibrary, setShowDictionaryLibrary] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [googleSignInBusy, setGoogleSignInBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [dailyGoalMinutes, setDailyGoalMinutesState] = useState(30);
  const [libraryBytes, setLibraryBytes] = useState<number | null>(null);
  const [storageDirectoryUri, setStorageDirectoryUri] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<{
    visible: boolean;
    title: string;
    message: string;
    tone?: AppDialogTone;
    actions: AppDialogAction[];
  } | null>(null);
  const [showWebdavModal, setShowWebdavModal] = useState(false);
  const [webdavHost, setWebdavHost] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [syncOpBusy, setSyncOpBusy] = useState(false);
  const [showAiConfigModal, setShowAiConfigModal] = useState(false);
  const [aiProviderSubtitle, setAiProviderSubtitle] = useState('No AI provider connected');

  useEffect(() => {
    getDailyReadingGoalMinutes().then(setDailyGoalMinutesState);
  }, []);

  useEffect(() => {
    getStorageDirectory().then(setStorageDirectoryUri);
  }, []);

  useEffect(() => {
    if (books.length === 0) {
      setLibraryBytes(0);
      return;
    }
    estimateLibraryStorageBytes().then(setLibraryBytes);
  }, [books, estimateLibraryStorageBytes]);

  useEffect(() => {
    const refreshAiSummary = async () => {
      try {
        const configs = await listReaderAiConfigs();
        const preferredProviderId = pickPreferredProviderId(configs);
        const config = configs.find(item => item.providerId === preferredProviderId && item.apiKey.trim());
        if (!config) {
          setAiProviderSubtitle('No AI provider connected');
          return;
        }
        const provider = AI_PROVIDER_PRESETS.find(item => item.id === config.providerId);
        setAiProviderSubtitle(
          `${provider?.shortLabel || config.label} · ${config.activeModelId || 'Model not selected'}`
        );
      } catch (_error) {
        setAiProviderSubtitle('No AI provider connected');
      }
    };

    void refreshAiSummary();
  }, [showAiConfigModal]);

  // Bottom padding for tab bar
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);

  const showDialog = (
    title: string,
    message: string,
    tone: AppDialogTone = 'default',
    actions?: AppDialogAction[]
  ) => {
    setDialogState({
      visible: true,
      title,
      message,
      tone,
      actions: actions || [{ label: 'OK', onPress: () => setDialogState(null) }],
    });
  };

  const handleClearCache = () => {
    showDialog(
      'Clear Temporary Cache',
      'This removes chapter cache and temporary downloads only. Your books, bookmarks, highlights, reading stats, and reading position stay intact.',
      'warning',
      [
        { label: 'Cancel', variant: 'secondary', onPress: () => setDialogState(null) },
        {
          label: 'Clear Cache',
          variant: 'danger',
          onPress: async () => {
            try {
              await clearCache();
              setDialogState(null);
              showDialog('Cache Cleared', 'Temporary reader cache was cleared successfully.', 'success');
            } catch {
              showDialog('Cache Error', 'Failed to clear the temporary cache.', 'danger');
            }
          },
        },
      ]
    );
  };

  const handleRescanLibrary = () => {
    showDialog(
      'Rescan Library',
      'This verifies tracked books, removes orphaned entries, and imports new EPUBs found in your watched folder.',
      'default',
      [
        { label: 'Cancel', variant: 'secondary', onPress: () => setDialogState(null) },
        {
          label: 'Rescan',
          variant: 'primary',
          onPress: async () => {
            try {
              const result = await rescanLibrary();
              setDialogState(null);
              showDialog(
                'Rescan Complete',
                `${result.valid} book(s) now tracked in library.\n` +
                  `${result.imported > 0 ? `Imported ${result.imported} new book(s).\n` : ''}` +
                  `${result.skippedDuplicates > 0 ? `Skipped ${result.skippedDuplicates} duplicate file(s).\n` : ''}` +
                  `${result.removed > 0 ? `Removed ${result.removed} orphaned entry(s).\n` : 'No orphaned entries found.\n'}` +
                  `${storageDirectoryUri ? `Watched folder items scanned: ${result.watchedFolderFiles}.` : 'No watched folder selected.'}`,
                'success'
              );
            } catch {
              showDialog('Rescan Error', 'Failed to rescan the library.', 'danger');
            }
          },
        },
      ]
    );
  };

  const handleDuplicateAudit = () => {
    const audit = auditLibraryDuplicates(books);
    if (audit.exactGroups.length === 0 && audit.probableGroups.length === 0) {
      showDialog('Library Audit', 'No duplicate book groups were found.', 'success');
      return;
    }

    const sampleGroups = [...audit.exactGroups, ...audit.probableGroups]
      .slice(0, 4)
      .map(group => group.books.map(book => book.title).join(' / '))
      .join('\n\n');

    showDialog(
      'Library Audit',
      `Exact duplicate groups: ${audit.exactGroups.length}\n` +
        `Probable duplicate groups: ${audit.probableGroups.length}\n\n` +
        `${sampleGroups ? `Examples:\n${sampleGroups}` : ''}`,
      'warning'
    );
  };

  const handleResetPreferences = () => {
    showDialog(
      'Reset Preferences',
      'This resets reading and display settings back to their defaults.',
      'warning',
      [
        { label: 'Cancel', variant: 'secondary', onPress: () => setDialogState(null) },
        {
          label: 'Reset',
          variant: 'danger',
          onPress: () => {
            setTypography({ ...defaultTypography });
            setReadingSettings({ ...defaultReadingSettings });
            setDialogState(null);
            showDialog('Preferences Reset', 'Reading and display settings were restored to default values.', 'success');
          },
        },
      ]
    );
  };

  const currentFont = fontOptions.find(f => f.value === typography.fontFamily)?.label || 'System Default';

  const handleConnectWebDAV = async () => {
    const adapter = SYNC_ADAPTERS['webdav'];
    if (!adapter || !adapter.configure) return;
    setSyncOpBusy(true);
    try {
      await adapter.configure({ host: webdavHost.trim(), username: webdavUsername.trim(), password: webdavPassword });
      const result = await adapter.authenticate();
      if (result.success) {
        await setActiveAdapter('webdav');
        setShowWebdavModal(false);
        showDialog('WebDAV Connected', 'Successfully connected to your WebDAV server.', 'success');
      } else {
        showDialog('Connection Failed', result.message || 'Could not connect to the WebDAV server.', 'danger');
      }
    } catch {
      showDialog('Connection Error', 'An error occurred while connecting. Check your server URL and credentials.', 'danger');
    } finally {
      setSyncOpBusy(false);
    }
  };

  const handleConnectGoogleDrive = async () => {
    const adapter = SYNC_ADAPTERS['gdrive'];
    if (!adapter) return;
    setSyncOpBusy(true);
    try {
      const result = await adapter.authenticate();
      if (result.success) {
        await setActiveAdapter('gdrive');
        showDialog('Google Drive Connected', 'Your Google Drive is now connected for backup.', 'success');
      } else {
        showDialog('Connection Failed', result.message || 'Could not connect to Google Drive.', 'danger');
      }
    } catch {
      showDialog('Connection Error', 'An error occurred connecting to Google Drive.', 'danger');
    } finally {
      setSyncOpBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleSignInBusy(true);
    setAuthError('');
    try {
      const result = await signInWithGoogle();
      if (!result.success) {
        setAuthError(result.error || 'Google sign-in failed.');
      }
    } catch {
      setAuthError('Google sign-in failed. Please try again.');
    } finally {
      setGoogleSignInBusy(false);
    }
  };

  const handleDisconnectSync = async () => {
    showDialog('Disconnect Sync', 'This will disconnect the current sync provider. Your local data is not affected.', 'warning', [
      { label: 'Cancel', variant: 'secondary', onPress: () => setDialogState(null) },
      {
        label: 'Disconnect',
        variant: 'danger',
        onPress: async () => {
          await setActiveAdapter(null);
          setDialogState(null);
          showDialog('Disconnected', 'Cloud sync has been disconnected.', 'default');
        },
      },
    ]);
  };

  const handleBackupNow = async () => {
    setSyncOpBusy(true);
    try {
      const success = await backupData();
      showDialog(success ? 'Backup Complete' : 'Backup Failed', success ? 'Your data has been backed up successfully.' : 'Backup could not be completed. Check your connection.', success ? 'success' : 'danger');
    } catch {
      showDialog('Backup Error', 'An unexpected error occurred during backup.', 'danger');
    } finally {
      setSyncOpBusy(false);
    }
  };

  const handleRestoreNow = async () => {
    showDialog('Restore from Backup', 'This will overwrite your current settings, highlights, and bookmarks with the cloud backup. Books on device are not affected.', 'warning', [
      { label: 'Cancel', variant: 'secondary', onPress: () => setDialogState(null) },
      {
        label: 'Restore',
        variant: 'primary',
        onPress: async () => {
          setDialogState(null);
          setSyncOpBusy(true);
          try {
            const success = await restoreData();
            showDialog(success ? 'Restored' : 'Restore Failed', success ? 'Data restored from cloud backup.' : 'No backup found or restore failed.', success ? 'success' : 'danger');
          } catch {
            showDialog('Restore Error', 'An unexpected error occurred during restore.', 'danger');
          } finally {
            setSyncOpBusy(false);
          }
        },
      },
    ]);
  };

  const openWebDAVModal = async () => {
    const adapter = SYNC_ADAPTERS['webdav'];
    if (adapter?.getConfig) {
      const config = await adapter.getConfig();
      if (config) {
        setWebdavHost(config.host || '');
        setWebdavUsername(config.username || '');
        setWebdavPassword(config.password || '');
      }
    }
    setShowWebdavModal(true);
  };

  const activeSyncName = activeAdapterId ? (SYNC_ADAPTERS[activeAdapterId]?.name ?? null) : null;
  const lastSyncLabel = lastSyncTime
    ? `Last sync: ${new Date(lastSyncTime).toLocaleDateString()} ${new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Not yet synced';

  const resetAuthForm = () => {
    setAuthEmail('');
    setAuthPassword('');
    setAuthConfirmPassword('');
    setAuthError('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: tabBarHeight + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText variant="primary" size="title" weight="bold" style={styles.title}>
          Settings
        </ThemedText>

        {/* Account Section */}
        <SettingsSection title="Account">
          {isAuthenticated ? (
            <>
              <SettingsRow
                icon={<Mail size={18} color={currentTheme.accent} />}
                title={user?.email ?? 'Signed In'}
                subtitle="Signed in with email"
              />
              <SettingsRow
                icon={<LogOut size={18} color="#EF4444" />}
                title="Sign Out"
                onPress={() => {
                  showDialog(
                    'Sign Out',
                    'Sign out of your Miyo account on this device?',
                    'warning',
                    [
                      { label: 'Cancel', variant: 'secondary', onPress: () => setDialogState(null) },
                      {
                        label: 'Sign Out',
                        variant: 'danger',
                        onPress: async () => {
                          await signOut();
                          setDialogState(null);
                        },
                      },
                    ]
                  );
                }}
                danger
              />
            </>
          ) : (
            <SettingsRow
              icon={<LogIn size={18} color={currentTheme.accent} />}
              title="Sign In / Sign Up"
              subtitle="Unlock auto-translation features"
              showChevron
              onPress={() => {
                setAuthMode('login');
                resetAuthForm();
                setShowAuthModal(true);
              }}
            />
          )}
        </SettingsSection>

        {/* Translation Settings */}
        <SettingsSection title="Translations">
          <SettingsRow
            icon={<Languages size={18} color={currentTheme.accent} />}
            title="Auto Translation Mode"
            subtitle={readingSettings.autoTranslationMode === 'off'
              ? 'Off — translate only when you tap Translate'
              : readingSettings.autoTranslationMode === 'normal'
              ? 'On — auto-translate chapters when opened'
              : 'Advanced — uses account-linked translation'}
            value={readingSettings.autoTranslationMode === 'off' ? 'Off'
              : readingSettings.autoTranslationMode === 'normal' ? 'On' : 'Advanced'}
            showChevron
            onPress={() => {
              const modes = ['off', 'normal', 'advanced'] as const;
              const currentIndex = modes.indexOf(readingSettings.autoTranslationMode);
              const nextIndex = (currentIndex + 1) % modes.length;
              setReadingSettings({ autoTranslationMode: modes[nextIndex] });
            }}
          />
          <SettingsRow
            icon={<Languages size={18} color={currentTheme.accent} />}
            title="Translation Language"
            subtitle="Target language for chapter auto-translation"
            value={TRANSLATION_LANGUAGES.find(l => l.code === readingSettings.translationLanguage)?.label ?? 'English'}
            showChevron
            onPress={() => {
              const langs = TRANSLATION_LANGUAGES;
              const current = langs.findIndex(l => l.code === readingSettings.translationLanguage);
              const next = (current + 1) % langs.length;
              setReadingSettings({ translationLanguage: langs[next].code as any });
            }}
          />
        </SettingsSection>

        {/* Reading goal (Koodo-style habit target) */}
        <SettingsSection title="Daily Goal">
          <View style={{ padding: 16, paddingBottom: 16 }}>
            <ThemedText variant="secondary" size="caption" style={{ marginBottom: 14, lineHeight: 18 }}>
              Minutes to aim for each day. Progress appears on the Home tab using logged reading time.
            </ThemedText>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[15, 30, 45].map(m => {
                const active = dailyGoalMinutes === m;
                return (
                  <PressableScale
                    key={m}
                    onPress={async () => {
                      await setDailyReadingGoalMinutes(m);
                      setDailyGoalMinutesState(m);
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      alignItems: 'center',
                      backgroundColor: active ? currentTheme.accent : currentTheme.cardBackground,
                      borderColor: active ? currentTheme.accent : currentTheme.secondaryText + '25',
                    }}
                  >
                    <ThemedText
                      style={{
                        color: active ? '#FFFFFF' : currentTheme.text,
                        fontSize: 14,
                        fontWeight: active ? '700' : '400',
                      }}
                    >
                      {m} min
                    </ThemedText>
                  </PressableScale>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              {[60, 90, 120].map(m => {
                const active = dailyGoalMinutes === m;
                return (
                  <PressableScale
                    key={m}
                    onPress={async () => {
                      await setDailyReadingGoalMinutes(m);
                      setDailyGoalMinutesState(m);
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 12,
                      borderWidth: 1.5,
                      alignItems: 'center',
                      backgroundColor: active ? currentTheme.accent : currentTheme.cardBackground,
                      borderColor: active ? currentTheme.accent : currentTheme.secondaryText + '25',
                    }}
                  >
                    <ThemedText
                      style={{
                        color: active ? '#FFFFFF' : currentTheme.text,
                        fontSize: 14,
                        fontWeight: active ? '700' : '400',
                      }}
                    >
                      {m} min
                    </ThemedText>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        </SettingsSection>

        <SettingsSection title="AI & Secrets">
          <SettingsRow
            icon={<Sparkles size={18} color={currentTheme.accent} />}
            title="AI Provider Configuration"
            subtitle={aiProviderSubtitle}
            showChevron
            onPress={() => setShowAiConfigModal(true)}
          />
        </SettingsSection>

        {/* Reading Settings */}
        <SettingsSection title="Reading">
          <SettingsRow
            icon={<Type size={18} color={currentTheme.accent} />}
            title="Typography"
            subtitle={`${currentFont}, ${typography.fontSize}px`}
            showChevron
            onPress={() => setShowTypographyModal(true)}
          />
          <SettingsRow
            icon={<SlidersHorizontal size={18} color={currentTheme.accent} />}
            title="Page Animation"
            value={readingSettings.pageAnimation.charAt(0).toUpperCase() + readingSettings.pageAnimation.slice(1)}
            showChevron
            onPress={() => {
              const options = ['slide', 'fade', 'curl'] as const;
              const currentIndex = options.indexOf(readingSettings.pageAnimation);
              const nextIndex = (currentIndex + 1) % options.length;
              setReadingSettings({ pageAnimation: options[nextIndex] });
            }}
          />
          <SettingsRow
            icon={<Smartphone size={18} color={currentTheme.accent} />}
            title="Tap Zones"
            subtitle="Enable left/right edge taps in the reader"
            toggle={{
              value: readingSettings.tapZonesEnabled,
              onToggle: value => setReadingSettings({ tapZonesEnabled: value }),
            }}
          />
          <SettingsRow
            icon={<SlidersHorizontal size={18} color={currentTheme.accent} />}
            title="Side tap & swipe"
            subtitle={
              readingSettings.tapZoneNavMode === 'scroll'
                ? 'Scroll within chapter (default)'
                : 'Jump to previous / next chapter'
            }
            showChevron
            onPress={() =>
              setReadingSettings({
                tapZoneNavMode: readingSettings.tapZoneNavMode === 'scroll' ? 'chapter' : 'scroll',
              })
            }
          />
          <SettingsRow
            icon={<Timer size={18} color={currentTheme.accent} />}
            title="Sleep timer"
            subtitle={
              readingSettings.sleepTimerMinutes <= 0
                ? 'Off'
                : `${readingSettings.sleepTimerMinutes} min (while reading)`
            }
            showChevron
            onPress={() => {
              const opts = [0, 15, 30, 45, 60] as const;
              let i = opts.indexOf(readingSettings.sleepTimerMinutes as (typeof opts)[number]);
              if (i < 0) i = 0;
              setReadingSettings({ sleepTimerMinutes: opts[(i + 1) % opts.length] });
            }}
          />
          <SettingsRow
            icon={<ArrowDownToLine size={18} color={currentTheme.accent} />}
            title="Continuous chapter loading"
            subtitle="Append the next chapter in the same reading space when you reach the end"
            toggle={{
              value: readingSettings.autoAdvanceChapter,
              onToggle: value => setReadingSettings({ autoAdvanceChapter: value }),
            }}
          />
          <SettingsRow
            icon={<Volume2 size={18} color={currentTheme.accent} />}
            title="Volume Button Navigation"
            subtitle="Use volume buttons to turn pages"
            toggle={{
              value: readingSettings.volumeButtonPageTurn,
              onToggle: value => setReadingSettings({ volumeButtonPageTurn: value }),
            }}
          />
          <SettingsRow
            icon={<SlidersHorizontal size={18} color={currentTheme.accent} />}
            title="Bionic reading"
            subtitle="Emphasize word beginnings in the reader"
            toggle={{
              value: readingSettings.bionicReading,
              onToggle: value => setReadingSettings({ bionicReading: value }),
            }}
          />
          <SettingsRow
            icon={<Smartphone size={18} color={currentTheme.accent} />}
            title="Keep screen on"
            subtitle="While a book is open in the reader"
            toggle={{
              value: readingSettings.keepScreenOn,
              onToggle: value => setReadingSettings({ keepScreenOn: value }),
            }}
          />
        </SettingsSection>

        {/* Display Settings */}
        <SettingsSection title="Display">
          <SettingsRow
            icon={<Eye size={18} color={currentTheme.accent} />}
            title="Immersive Mode"
            subtitle="Hide status and navigation bars"
            toggle={{
              value: readingSettings.immersiveMode,
              onToggle: value => setReadingSettings({ immersiveMode: value }),
            }}
          />
        </SettingsSection>

        {/* Storage */}
        <SettingsSection title="Storage">
          <SettingsRow
            icon={<Database size={18} color={currentTheme.accent} />}
            title="Storage Location"
            subtitle={
              Platform.OS === 'android'
                ? 'Select the folder used for new imports and watched-folder rescans'
                : 'Books live in app storage'
            }
            value={Platform.OS === 'android' ? getStorageDirectoryLabel(storageDirectoryUri) : 'App storage'}
            showChevron
            onPress={async () => {
              if (Platform.OS !== 'android') {
                showDialog('Storage', 'On iOS, imported books are stored inside the app sandbox.', 'default');
                return;
              }
              const uri = await requestStorageDirectory();
              if (uri) {
                await markPermissionGranted(true);
                setStorageDirectoryUri(uri);
              }
            }}
          />
          <SettingsRow
            icon={<HardDrive size={18} color={currentTheme.accent} />}
            title="Library size"
            subtitle={`${books.length} book(s) on disk`}
            value={libraryBytes == null ? '…' : formatStorageBytes(libraryBytes)}
            showChevron={false}
          />
          <SettingsRow
            icon={<FolderOpen size={18} color={currentTheme.accent} />}
            title="Watched Folder"
            subtitle={
              storageDirectoryUri
                ? 'Rescan imports new EPUBs from this folder without copying them again'
                : 'No folder selected yet'
            }
            value={storageDirectoryUri ? 'Active' : 'Off'}
            showChevron={false}
          />
          <SettingsRow
            icon={<Trash2 size={18} color="#EF4444" />}
            title="Clear Cache"
            subtitle="Remove temporary reading data"
            onPress={handleClearCache}
            danger
          />
        </SettingsSection>

        {/* Sync & Backup */}
        <SettingsSection title="Cloud Sync & Backup">
          {activeAdapterId ? (
            <>
              <SettingsRow
                icon={<Cloud size={18} color={currentTheme.accent} />}
                title={`Connected: ${activeSyncName}`}
                subtitle={lastSyncLabel}
                showChevron={false}
              />
              <SettingsRow
                icon={syncOpBusy || isSyncing ? <ActivityIndicator size="small" color={currentTheme.accent} /> : <ArrowDownToLine size={18} color={currentTheme.accent} />}
                title="Backup Now"
                subtitle="Save reading data to cloud"
                showChevron
                onPress={handleBackupNow}
              />
              <SettingsRow
                icon={<RotateCcw size={18} color={currentTheme.accent} />}
                title="Restore from Backup"
                subtitle="Overwrite local data with cloud backup"
                showChevron
                onPress={handleRestoreNow}
              />
              <SettingsRow
                icon={<X size={18} color="#EF4444" />}
                title="Disconnect"
                subtitle="Remove cloud sync provider"
                onPress={handleDisconnectSync}
                danger
              />
            </>
          ) : (
            <>
              <SettingsRow
                icon={<Cloud size={18} color={currentTheme.accent} />}
                title="Connect Google Drive"
                subtitle="Back up reading data to your Google account"
                showChevron
                onPress={handleConnectGoogleDrive}
              />
              <SettingsRow
                icon={<HardDrive size={18} color={currentTheme.accent} />}
                title="Connect WebDAV Server"
                subtitle="Use your own server (Nextcloud, ownCloud, etc.)"
                showChevron
                onPress={openWebDAVModal}
              />
            </>
          )}
        </SettingsSection>

        {/* Permissions */}
        <SettingsSection title="Permissions">
          <SettingsRow
            icon={<Shield size={18} color={currentTheme.accent} />}
            title="Storage Permission"
            subtitle="Required to import and read EPUB files"
            showChevron
            onPress={() => setShowPermissionModal(true)}
          />
          <SettingsRow
            icon={<FolderOpen size={18} color={currentTheme.accent} />}
            title="Open App Settings"
            subtitle="Manage app permissions"
            showChevron
            onPress={async () => {
              await openAppSettings();
            }}
          />
        </SettingsSection>

        <SettingsSection title="Language Tools">
          <SettingsRow
            icon={<BookOpen size={18} color={currentTheme.accent} />}
            title="Dictionary Library"
            subtitle="Download offline dictionaries and manage lookup packages"
            showChevron
            onPress={() => setShowDictionaryLibrary(true)}
          />
        </SettingsSection>

        {/* Advanced */}
        <SettingsSection title="Advanced">
          <SettingsRow
            icon={<Minimize2 size={18} color={currentTheme.accent} />}
            title="Reduced Motion"
            subtitle="Minimize animations"
            toggle={{
              value: readingSettings.reducedMotion,
              onToggle: value => setReadingSettings({ reducedMotion: value }),
            }}
          />
          <SettingsRow
            icon={<RefreshCw size={18} color={currentTheme.accent} />}
            title="Rescan Library"
            subtitle="Find missing or new books"
            showChevron
            onPress={handleRescanLibrary}
          />
          <SettingsRow
            icon={<Database size={18} color={currentTheme.accent} />}
            title="Duplicate Audit"
            subtitle="Detect exact and probable duplicate book entries"
            showChevron
            onPress={handleDuplicateAudit}
          />
          {__DEV__ && (
            <SettingsRow
              icon={<Bug size={18} color={currentTheme.accent} />}
              title="View Console Logs"
              subtitle="Debug and error information"
              showChevron
              onPress={() => setShowLoggerModal(true)}
            />
          )}
          <SettingsRow
            icon={<RotateCcw size={18} color="#EF4444" />}
            title="Reset All Preferences"
            subtitle="Restore default settings"
            onPress={handleResetPreferences}
            danger
          />
        </SettingsSection>

        {/* About */}
        <View style={styles.aboutSection}>
          <ThemedText variant="secondary" size="caption" style={styles.aboutText}>
            Miyo EPUB Reader
          </ThemedText>
          <ThemedText variant="secondary" size="caption" style={styles.aboutText}>
            Version 1.0.0
          </ThemedText>
        </View>
      </ScrollView>

      {/* Typography Modal */}
      <Modal
        visible={showTypographyModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTypographyModal(false)}
      >
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: currentTheme.background },
          ]}
        >
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <PressableScale onPress={() => setShowTypographyModal(false)}>
              <X size={24} color={currentTheme.secondaryText} />
            </PressableScale>
            <ThemedText variant="primary" size="header" weight="semibold">
              Typography
            </ThemedText>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            style={styles.modalContent}
            contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Font Family */}
            <View style={styles.settingGroup}>
              <ThemedText
                variant="secondary"
                size="caption"
                weight="medium"
                style={styles.settingLabel}
              >
                FONT FAMILY
              </ThemedText>
              <View style={styles.fontOptions}>
                {fontOptions.map(font => (
                  <PressableScale
                    key={font.value}
                    onPress={() => setTypography({ fontFamily: font.value })}
                    style={[
                      styles.fontOption,
                      {
                        backgroundColor:
                          typography.fontFamily === font.value
                            ? currentTheme.accent + '20'
                            : currentTheme.cardBackground,
                        borderColor:
                          typography.fontFamily === font.value
                            ? currentTheme.accent
                            : 'transparent',
                      },
                    ]}
                  >
                    <ThemedText
                      variant={typography.fontFamily === font.value ? 'accent' : 'primary'}
                      size="body"
                      weight={typography.fontFamily === font.value ? 'semibold' : 'regular'}
                      style={!isSystemFontValue(font.value) ? { fontFamily: getNativeFontFamily(font.value) } : undefined}
                    >
                      {font.label}
                    </ThemedText>
                    {typography.fontFamily === font.value && (
                      <Check size={18} color={currentTheme.accent} />
                    )}
                  </PressableScale>
                ))}
              </View>
            </View>

            {/* Font Size */}
            <View style={styles.settingGroup}>
              <View style={styles.sliderHeader}>
                <ThemedText
                  variant="secondary"
                  size="caption"
                  weight="medium"
                  style={styles.settingLabel}
                >
                  FONT SIZE
                </ThemedText>
                <ThemedText variant="accent" size="body" weight="semibold">
                  {typography.fontSize}px
                </ThemedText>
              </View>
              <View style={styles.sliderContainer}>
                <ThemedText variant="secondary" size="caption">12</ThemedText>
                <View style={styles.slider}>
                  <View 
                    style={[
                      styles.sliderTrack, 
                      { backgroundColor: currentTheme.secondaryText + '30' }
                    ]}
                  >
                    <View 
                      style={[
                        styles.sliderFill, 
                        { 
                          backgroundColor: currentTheme.accent,
                          width: `${((typography.fontSize - 12) / (28 - 12)) * 100}%`
                        }
                      ]}
                    />
                  </View>
                  <PressableScale
                    style={[
                      styles.sliderThumb,
                      { 
                        backgroundColor: currentTheme.accent,
                        left: `${((typography.fontSize - 12) / (28 - 12)) * 100}%`
                      }
                    ]}
                  />
                </View>
                <ThemedText variant="secondary" size="caption">28</ThemedText>
              </View>
              <View style={styles.sizeButtons}>
                <PressableScale
                  onPress={() => setTypography({ fontSize: Math.max(12, typography.fontSize - 1) })}
                  style={[styles.sizeButton, { backgroundColor: currentTheme.cardBackground }]}
                >
                  <ThemedText variant="primary" size="body" weight="bold">A-</ThemedText>
                </PressableScale>
                <PressableScale
                  onPress={() => setTypography({ fontSize: Math.min(28, typography.fontSize + 1) })}
                  style={[styles.sizeButton, { backgroundColor: currentTheme.cardBackground }]}
                >
                  <ThemedText variant="primary" size="header" weight="bold">A+</ThemedText>
                </PressableScale>
              </View>
            </View>

            {/* Line Height */}
            <View style={styles.settingGroup}>
              <View style={styles.sliderHeader}>
                <ThemedText
                  variant="secondary"
                  size="caption"
                  weight="medium"
                  style={styles.settingLabel}
                >
                  LINE HEIGHT
                </ThemedText>
                <ThemedText variant="accent" size="body" weight="semibold">
                  {typography.lineHeight.toFixed(1)}
                </ThemedText>
              </View>
              <View style={styles.sizeButtons}>
                <PressableScale
                  onPress={() => setTypography({ lineHeight: Math.max(1.2, typography.lineHeight - 0.1) })}
                  style={[styles.sizeButton, { backgroundColor: currentTheme.cardBackground }]}
                >
                  <ThemedText variant="primary" size="body">Compact</ThemedText>
                </PressableScale>
                <PressableScale
                  onPress={() => setTypography({ lineHeight: Math.min(2.0, typography.lineHeight + 0.1) })}
                  style={[styles.sizeButton, { backgroundColor: currentTheme.cardBackground }]}
                >
                  <ThemedText variant="primary" size="body">Relaxed</ThemedText>
                </PressableScale>
              </View>
            </View>

            {/* Text Alignment */}
            <View style={styles.settingGroup}>
              <ThemedText
                variant="secondary"
                size="caption"
                weight="medium"
                style={styles.settingLabel}
              >
                TEXT ALIGNMENT
              </ThemedText>
              <View style={styles.alignmentOptions}>
                <PressableScale
                  onPress={() => setTypography({ textAlign: 'left' })}
                  style={[
                    styles.alignmentOption,
                    {
                      backgroundColor:
                        typography.textAlign === 'left'
                          ? currentTheme.accent + '20'
                          : currentTheme.cardBackground,
                      borderColor:
                        typography.textAlign === 'left'
                          ? currentTheme.accent
                          : 'transparent',
                    },
                  ]}
                >
                  <AlignLeft
                    size={20}
                    color={
                      typography.textAlign === 'left'
                        ? currentTheme.accent
                        : currentTheme.secondaryText
                    }
                  />
                  <ThemedText
                    variant={typography.textAlign === 'left' ? 'accent' : 'secondary'}
                    size="caption"
                    weight="medium"
                  >
                    Left
                  </ThemedText>
                </PressableScale>
                <PressableScale
                  onPress={() => setTypography({ textAlign: 'justify' })}
                  style={[
                    styles.alignmentOption,
                    {
                      backgroundColor:
                        typography.textAlign === 'justify'
                          ? currentTheme.accent + '20'
                          : currentTheme.cardBackground,
                      borderColor:
                        typography.textAlign === 'justify'
                          ? currentTheme.accent
                          : 'transparent',
                    },
                  ]}
                >
                  <AlignJustify
                    size={20}
                    color={
                      typography.textAlign === 'justify'
                        ? currentTheme.accent
                        : currentTheme.secondaryText
                    }
                  />
                  <ThemedText
                    variant={typography.textAlign === 'justify' ? 'accent' : 'secondary'}
                    size="caption"
                    weight="medium"
                  >
                    Justify
                  </ThemedText>
                </PressableScale>
              </View>
            </View>

            {/* Preview */}
            <View style={styles.settingGroup}>
              <ThemedText
                variant="secondary"
                size="caption"
                weight="medium"
                style={styles.settingLabel}
              >
                PREVIEW
              </ThemedText>
              <View
                style={[
                  styles.preview,
                  { backgroundColor: currentTheme.cardBackground },
                ]}
              >
                <ThemedText
                  style={{
                    fontSize: typography.fontSize,
                    lineHeight: typography.fontSize * typography.lineHeight,
                    letterSpacing: typography.letterSpacing,
                    textAlign: typography.textAlign,
                    fontWeight: String(typography.fontWeight) as '400',
                    ...(!isSystemFontValue(typography.fontFamily) && {
                      fontFamily: getNativeFontFamily(typography.fontFamily),
                    }),
                  }}
                >
                  The quick brown fox jumps over the lazy dog. This is a preview of how your reading text will appear with the current typography settings.
                </ThemedText>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* WebDAV Configuration Modal */}
      <Modal
        visible={showWebdavModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowWebdavModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: currentTheme.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: currentTheme.secondaryText + '22' }]}>
            <ThemedText variant="primary" size="title" weight="bold">WebDAV Server</ThemedText>
            <PressableScale onPress={() => setShowWebdavModal(false)} style={{ padding: 8 }}>
              <X size={22} color={currentTheme.secondaryText} />
            </PressableScale>
          </View>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={{ padding: 20, gap: 14 }}>
              <ThemedText variant="secondary" size="body" style={{ lineHeight: 20, marginBottom: 4 }}>
                Enter your WebDAV server details. Compatible with Nextcloud, ownCloud, and other WebDAV servers.
              </ThemedText>
              <TextInput
                style={[styles.authInput, { borderColor: currentTheme.secondaryText + '40', color: currentTheme.text, backgroundColor: currentTheme.cardBackground }]}
                placeholder="Server URL (e.g. https://my.server.com/dav)"
                placeholderTextColor={currentTheme.secondaryText + '80'}
                value={webdavHost}
                onChangeText={setWebdavHost}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <TextInput
                style={[styles.authInput, { borderColor: currentTheme.secondaryText + '40', color: currentTheme.text, backgroundColor: currentTheme.cardBackground }]}
                placeholder="Username"
                placeholderTextColor={currentTheme.secondaryText + '80'}
                value={webdavUsername}
                onChangeText={setWebdavUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={[styles.authInput, { borderColor: currentTheme.secondaryText + '40', color: currentTheme.text, backgroundColor: currentTheme.cardBackground }]}
                placeholder="Password"
                placeholderTextColor={currentTheme.secondaryText + '80'}
                value={webdavPassword}
                onChangeText={setWebdavPassword}
                secureTextEntry
              />
              <PressableScale
                onPress={handleConnectWebDAV}
                disabled={syncOpBusy || !webdavHost.trim() || !webdavUsername.trim() || !webdavPassword}
                style={[styles.authSubmitBtn, { backgroundColor: currentTheme.accent, opacity: syncOpBusy || !webdavHost.trim() || !webdavUsername.trim() || !webdavPassword ? 0.6 : 1 }]}
              >
                {syncOpBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <ThemedText style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Connect</ThemedText>
                )}
              </PressableScale>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Logger Modal */}
      <LoggerModal
        visible={showLoggerModal}
        onClose={() => setShowLoggerModal(false)}
      />

      {/* Permission Modal */}
      <PermissionModal
        visible={showPermissionModal}
        onGrantAccess={async () => {
          setShowPermissionModal(false);
          await openAppSettings();
        }}
        onDismiss={() => setShowPermissionModal(false)}
      />

      <DictionaryLibraryModal
        visible={showDictionaryLibrary}
        onClose={() => setShowDictionaryLibrary(false)}
      />

      <ReaderAiConfigModal
        visible={showAiConfigModal}
        onClose={() => setShowAiConfigModal(false)}
        onSaved={() => {
          showDialog(
            'AI Configuration Saved',
            'Provider keys, endpoints, and model selections were updated.',
            'success'
          );
        }}
      />

      <AppDialog
        visible={!!dialogState?.visible}
        title={dialogState?.title || ''}
        message={dialogState?.message || ''}
        tone={dialogState?.tone}
        actions={dialogState?.actions || [{ label: 'OK', onPress: () => setDialogState(null) }]}
        onClose={() => setDialogState(null)}
      />

      {/* Auth Modal */}
      <Modal
        visible={showAuthModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowAuthModal(false);
          resetAuthForm();
        }}
      >
        <View style={[styles.modalContainer, { backgroundColor: currentTheme.background }]}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <PressableScale onPress={() => {
              setShowAuthModal(false);
              resetAuthForm();
            }}>
              <X size={24} color={currentTheme.secondaryText} />
            </PressableScale>
            <ThemedText variant="primary" size="header" weight="semibold">
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </ThemedText>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView
            style={styles.modalContent}
            contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.authHeroCard,
                {
                  backgroundColor: currentTheme.cardBackground,
                  borderColor: currentTheme.accent + '22',
                },
              ]}
            >
              <ThemedText variant="accent" size="caption" weight="semibold" style={styles.authHeroLabel}>
                MIYO ACCOUNT
              </ThemedText>
              <ThemedText variant="primary" size="title" weight="bold" style={{ marginBottom: 8 }}>
                {authMode === 'login' ? 'Welcome back' : 'Create your reading profile'}
              </ThemedText>
              <ThemedText variant="secondary" size="body" style={{ lineHeight: 22 }}>
                {authMode === 'login'
                  ? 'Sign in to sync reading progress, save dictionaries, and keep translation tools available across sessions.'
                  : 'Create an account, confirm it by email on this device, and unlock sync, dictionaries, and translation tools.'}
              </ThemedText>

              <View style={styles.authModeSwitch}>
                {(['login', 'signup'] as const).map(mode => {
                  const active = authMode === mode;
                  return (
                    <PressableScale
                      key={mode}
                      onPress={() => {
                        setAuthMode(mode);
                        setAuthError('');
                        setAuthPassword('');
                        setAuthConfirmPassword('');
                      }}
                      style={[
                        styles.authModeChip,
                        {
                          backgroundColor: active ? currentTheme.accent : currentTheme.background,
                          borderColor: active ? currentTheme.accent : currentTheme.secondaryText + '20',
                        },
                      ]}
                    >
                      <ThemedText
                        size="caption"
                        weight="semibold"
                        style={{ color: active ? '#FFFFFF' : currentTheme.text }}
                      >
                        {mode === 'login' ? 'Sign In' : 'Create Account'}
                      </ThemedText>
                    </PressableScale>
                  );
                })}
              </View>
            </View>

            {authError ? (
              <View style={[styles.authErrorBox, { backgroundColor: '#EF444415', borderColor: '#EF444440' }]}>
                <ThemedText style={{ color: '#EF4444', fontSize: 13, lineHeight: 18 }}>{authError}</ThemedText>
              </View>
            ) : null}

            <View style={[styles.authSectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
              <ThemedText variant="secondary" size="caption" weight="medium" style={styles.settingLabel}>
                GOOGLE ACCOUNT
              </ThemedText>
              {isGoogleSignInDisabled() ? (
                <View style={[styles.authNoticeCard, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '16' }]}>
                  <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                    Google sign-in is not configured for this build. Use email and password below.
                  </ThemedText>
                </View>
              ) : (
                <PressableScale
                  onPress={handleGoogleSignIn}
                  disabled={googleSignInBusy || authBusy}
                  style={[
                    styles.authSubmitBtn,
                    {
                      backgroundColor: currentTheme.cardBackground,
                      borderColor: currentTheme.secondaryText + '30',
                      borderWidth: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    },
                  ]}
                >
                  {googleSignInBusy ? (
                    <ActivityIndicator size="small" color={currentTheme.accent} />
                  ) : (
                    <LogIn size={16} color={currentTheme.accent} />
                  )}
                  <ThemedText variant="accent" size="body" weight="semibold">
                    Continue with Google
                  </ThemedText>
                </PressableScale>
              )}
            </View>

            <View style={[styles.authSectionCard, { backgroundColor: currentTheme.cardBackground, borderColor: currentTheme.secondaryText + '16' }]}>
              <ThemedText variant="secondary" size="caption" weight="medium" style={styles.settingLabel}>
                EMAIL AND PASSWORD
              </ThemedText>
              <ThemedText variant="secondary" size="caption" style={styles.authHelperText}>
                Email/password login is the only account option enabled in this beta build.
              </ThemedText>

              <TextInput
                style={[
                  styles.authInput,
                  {
                    color: currentTheme.text,
                    backgroundColor: currentTheme.background,
                    borderColor: currentTheme.secondaryText + '25',
                  },
                ]}
                placeholder="your@email.com"
                placeholderTextColor={currentTheme.secondaryText + '70'}
                value={authEmail}
                onChangeText={setAuthEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View
                style={[
                  styles.authInputRow,
                  {
                    backgroundColor: currentTheme.background,
                    borderColor: currentTheme.secondaryText + '25',
                  },
                ]}
              >
                <TextInput
                  style={[styles.authInlineInput, { color: currentTheme.text }]}
                  placeholder="Password"
                  placeholderTextColor={currentTheme.secondaryText + '70'}
                  value={authPassword}
                  onChangeText={setAuthPassword}
                  secureTextEntry={!showPassword}
                />
                <Pressable onPress={() => setShowPassword(value => !value)} hitSlop={10}>
                  {showPassword ? (
                    <EyeOff size={18} color={currentTheme.secondaryText} />
                  ) : (
                    <Eye size={18} color={currentTheme.secondaryText} />
                  )}
                </Pressable>
              </View>

              {authMode === 'signup' ? (
                <View
                  style={[
                    styles.authInputRow,
                    {
                      backgroundColor: currentTheme.background,
                      borderColor: currentTheme.secondaryText + '25',
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.authInlineInput, { color: currentTheme.text }]}
                    placeholder="Confirm password"
                    placeholderTextColor={currentTheme.secondaryText + '70'}
                    value={authConfirmPassword}
                    onChangeText={setAuthConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <Pressable onPress={() => setShowConfirmPassword(value => !value)} hitSlop={10}>
                    {showConfirmPassword ? (
                      <EyeOff size={18} color={currentTheme.secondaryText} />
                    ) : (
                      <Eye size={18} color={currentTheme.secondaryText} />
                    )}
                  </Pressable>
                </View>
              ) : null}

              <View style={[styles.authNoticeCard, { backgroundColor: currentTheme.background, borderColor: currentTheme.secondaryText + '16' }]}>
                <ThemedText variant="secondary" size="caption" style={{ lineHeight: 18 }}>
                  {authMode === 'login'
                    ? 'Use the same email you verified in Miyo.'
                    : 'Passwords must be at least 8 characters. Create the account, then open the verification email on this device.'}
                </ThemedText>
              </View>

              <PressableScale
                onPress={async () => {
                  setAuthError('');
                  const email = authEmail.trim();
                  const password = authPassword.trim();
                  if (!email || !password) {
                    setAuthError('Please enter both email and password.');
                    return;
                  }
                  if (authMode === 'signup') {
                    if (password.length < 8) {
                      setAuthError('Use at least 8 characters for your password.');
                      return;
                    }
                    if (!authConfirmPassword.trim()) {
                      setAuthError('Confirm your password before creating the account.');
                      return;
                    }
                    if (password !== authConfirmPassword.trim()) {
                      setAuthError('The password confirmation does not match.');
                      return;
                    }
                  }

                  setAuthBusy(true);
                  try {
                    const result =
                      authMode === 'login'
                        ? await signIn(email, password)
                        : await signUp(email, password);
                    if (result.error) {
                      setAuthError(result.error);
                    } else {
                      setShowAuthModal(false);
                      resetAuthForm();
                      showDialog(
                        authMode === 'login' ? 'Signed In' : 'Check Your Email',
                        authMode === 'login'
                          ? 'Signed in successfully.'
                          : 'Account created. Open the verification email on this device to finish setup in Miyo.',
                        'success'
                      );
                    }
                  } finally {
                    setAuthBusy(false);
                  }
                }}
                disabled={authBusy}
                style={[styles.authSubmitBtn, { backgroundColor: currentTheme.accent, opacity: authBusy ? 0.7 : 1 }]}
              >
                <ThemedText style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>
                  {authBusy ? 'Working…' : authMode === 'login' ? 'Sign In' : 'Create Account'}
                </ThemedText>
              </PressableScale>

              <PressableScale
                onPress={() => {
                  setAuthMode(authMode === 'login' ? 'signup' : 'login');
                  setAuthError('');
                  setAuthPassword('');
                  setAuthConfirmPassword('');
                }}
                style={styles.authToggle}
              >
                <ThemedText variant="secondary" size="body">
                  {authMode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                </ThemedText>
                <ThemedText variant="accent" size="body" weight="semibold">
                  {authMode === 'login' ? 'Sign Up' : 'Sign In'}
                </ThemedText>
              </PressableScale>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
  },
  title: {
    marginBottom: 24,
  },
  aboutSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  aboutText: {
    marginBottom: 4,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalScroll: {
    flex: 1,
  },
  settingGroup: {
    marginBottom: 28,
  },
  settingLabel: {
    letterSpacing: 1,
    marginBottom: 12,
  },
  fontOptions: {
    gap: 8,
  },
  fontOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  slider: {
    flex: 1,
    height: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  sizeButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  sizeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  alignmentOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  alignmentOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
  },
  preview: {
    padding: 16,
    borderRadius: 12,
  },
  authErrorBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  authHeroCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
  },
  authHeroLabel: {
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  authModeSwitch: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  authModeChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  authSectionCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  googleBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineGuideBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  authHelperText: {
    lineHeight: 18,
    marginBottom: 12,
  },
  authInput: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
  },
  authInputRow: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  authInlineInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 14,
  },
  authNoticeCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  authSubmitBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 18,
  },
  authToggle: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
});
