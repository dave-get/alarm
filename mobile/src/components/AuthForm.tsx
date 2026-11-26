import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { Button, Field } from './ui';

export function AuthForm({
  mode,
  onSubmit,
}: {
  mode: 'login' | 'register';
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (mode === 'register' && password.length < 8) return setError('Password must be at least 8 characters.');
    setLoading(true);
    try {
      await onSubmit(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6, marginBottom: 12 }}>
            <Text style={[styles.title, { color: t.text }]}>Crypto Price Alerts</Text>
            <Text style={{ color: t.muted }}>BTC · ETH · BNB · XRP · SOL — alarms that reach you even when the app is closed.</Text>
          </View>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            textContentType={mode === 'login' ? 'password' : 'newPassword'}
            hint={mode === 'register' ? 'At least 8 characters' : undefined}
            onSubmitEditing={submit}
          />
          {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
          <Button title={mode === 'login' ? 'Sign in' : 'Create account'} onPress={submit} loading={loading} />
          <Link href={mode === 'login' ? '/register' : '/login'} style={{ color: t.primary, textAlign: 'center', padding: 12, fontWeight: '600' }}>
            {mode === 'login' ? "No account? Create one" : 'Already have an account? Sign in'}
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '800' },
});
