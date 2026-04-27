import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { ThemedText } from '@/components/ui/ThemedText';

function ProviderMark({
  glyph,
  accentColor,
  size,
}: {
  glyph: string;
  accentColor: string;
  size: number;
}) {
  const inset = size * 0.18;
  const inner = size - inset * 2;

  switch (glyph) {
    case 'G':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4a8 8 0 0 1 5.66 2.34l-2.05 2.05A5 5 0 0 0 7 12" stroke="#4285F4" strokeWidth="3" fill="none" strokeLinecap="round" />
          <Path d="M7 12a5 5 0 0 0 1.46 3.54" stroke="#34A853" strokeWidth="3" fill="none" strokeLinecap="round" />
          <Path d="M8.46 15.54A5 5 0 0 0 12 17a4.8 4.8 0 0 0 3.53-1.38" stroke="#FBBC05" strokeWidth="3" fill="none" strokeLinecap="round" />
          <Path d="M17 15.62A8 8 0 0 0 20 12h-8" stroke="#EA4335" strokeWidth="3" fill="none" strokeLinecap="round" />
        </Svg>
      );
    case 'N':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 12c2.7-4 7-6.5 12-6.5 1.4 0 2.7.2 4 .6-2.7 4-7 6.4-12 6.4-1.4 0-2.7-.2-4-.5Z" fill={accentColor} opacity="0.9" />
          <Path d="M20 12c-2.7 4-7 6.5-12 6.5-1.4 0-2.7-.2-4-.6 2.7-4 7-6.4 12-6.4 1.4 0 2.7.2 4 .5Z" fill={accentColor} opacity="0.5" />
          <Circle cx="12" cy="12" r="2.2" fill={accentColor} />
        </Svg>
      );
    case 'A':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4 5.5 20h3.2l1.2-3.3h4.3l1.2 3.3h3.2L12 4Z" fill={accentColor} />
          <Rect x="10.1" y="13.1" width="3.8" height="1.7" rx="0.85" fill="#FFF8" />
        </Svg>
      );
    case 'R':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M7 7h8l-2.5-2.5" stroke={accentColor} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M17 17H9l2.5 2.5" stroke={accentColor} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M15 7 19 11l-4 4" stroke={accentColor} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M9 17 5 13l4-4" stroke={accentColor} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'K':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3 14.6 9.4 21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" fill={accentColor} />
          <Circle cx="12" cy="12" r="2.1" fill="#FFF8" />
        </Svg>
      );
    case 'M':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="4" y="8" width="2.8" height="8" rx="1.4" fill={accentColor} />
          <Rect x="8.4" y="5.5" width="2.8" height="13" rx="1.4" fill={accentColor} opacity="0.9" />
          <Rect x="12.8" y="7" width="2.8" height="10" rx="1.4" fill={accentColor} opacity="0.75" />
          <Rect x="17.2" y="4.5" width="2.8" height="15" rx="1.4" fill={accentColor} opacity="0.6" />
        </Svg>
      );
    case 'O':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 4.8a3.2 3.2 0 0 1 2.8 1.6l1.3-.2a3.3 3.3 0 0 1 3.3 3.3l-.2 1.3a3.2 3.2 0 0 1 0 2.4l.2 1.3a3.3 3.3 0 0 1-3.3 3.3l-1.3-.2A3.2 3.2 0 0 1 12 19.2a3.2 3.2 0 0 1-2.4-1.6l-1.3.2A3.3 3.3 0 0 1 5 14.5l.2-1.3a3.2 3.2 0 0 1 0-2.4L5 9.5a3.3 3.3 0 0 1 3.3-3.3l1.3.2A3.2 3.2 0 0 1 12 4.8Z" stroke={accentColor} strokeWidth="1.8" fill="none" />
          <Circle cx="12" cy="12" r="2.4" fill={accentColor} />
        </Svg>
      );
    case '>':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="m7 7 6 5-6 5" stroke={accentColor} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Rect x="13.6" y="15.3" width="4.4" height="2" rx="1" fill={accentColor} />
        </Svg>
      );
    default:
      return (
        <ThemedText
          style={{
            color: accentColor,
            fontSize: Math.max(12, Math.floor(size * 0.4)),
            fontWeight: '800',
          }}
        >
          {glyph}
        </ThemedText>
      );
  }
}

export function ReaderAiProviderIcon({
  glyph,
  accentColor,
  size = 34,
}: {
  glyph: string;
  accentColor: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${accentColor}16`,
          borderColor: `${accentColor}55`,
        },
      ]}
    >
      <ProviderMark glyph={glyph} accentColor={accentColor} size={Math.max(18, size - 8)} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
});
