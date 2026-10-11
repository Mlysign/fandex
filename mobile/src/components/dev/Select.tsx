// A native select has no equal in React Native. This is a button that opens the
// options in a sheet. Shared by the Scoring admin's Tags table and its Review section.
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Sheet } from '~/components/kit';
import { color, font, radius } from '~/theme';

export function Select({ value, options, onChange, placeholder, disabled, width, label }: {
  value: string; options: [string, string][]; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; width?: number; label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(([k]) => k === value)?.[1] ?? placeholder ?? '';
  return (
    <>
      <Pressable onPress={() => setOpen(true)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} style={[styles.select, { width }, disabled && { opacity: 0.5 }]}>
        <Text numberOfLines={1} style={[styles.text, { flex: 1, color: color.textPrimary }]}>{current}</Text>
        <Text style={styles.tiny}>▾</Text>
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: 8 }}>
          {options.map(([k, text]) => (
            <Pressable key={k} onPress={() => { setOpen(false); onChange(k); }} accessibilityRole="button" style={styles.option}>
              <Text style={[styles.text, { flex: 1, color: k === value ? color.accent : color.textPrimary }]}>{text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.textSecondary },
  tiny: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  select: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    backgroundColor: color.surfaceInset,
  },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
});
