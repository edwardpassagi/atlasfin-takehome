import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiClient, ApiResult, JsonObject, Persona, personas } from './src/apiClient';
import { color, radius, space, type } from './src/tokens';

type Screen =
  | { name: 'home'; refreshKey: number }
  | { name: 'request'; limitCents: number }
  | { name: 'result'; result: ApiResult | null; error: string | null };

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
const wholeCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function money(cents: number) {
  return currency.format(cents / 100);
}

function moneyWhole(cents: number) {
  return wholeCurrency.format(cents / 100);
}

function numberField(object: JsonObject | null, key: string) {
  const value = object?.[key];
  return typeof value === 'number' ? value : 0;
}

export default function App() {
  const api = useMemo(() => new ApiClient(), []);
  const [screen, setScreen] = useState<Screen>({ name: 'home', refreshKey: 0 });

  const goHome = () => {
    setScreen((current) => ({
      name: 'home',
      refreshKey: current.name === 'home' ? current.refreshKey + 1 : Date.now(),
    }));
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      {screen.name === 'home' ? (
        <HomePage
          api={api}
          refreshKey={screen.refreshKey}
          onRequest={(limitCents) => setScreen({ name: 'request', limitCents })}
        />
      ) : screen.name === 'request' ? (
        <RequestPage
          api={api}
          limitCents={screen.limitCents}
          onBack={goHome}
          onResult={(result, error) => setScreen({ name: 'result', result, error })}
        />
      ) : (
        <ResultPage result={screen.result} error={screen.error} onDone={goHome} />
      )}
    </SafeAreaView>
  );
}

function HomePage({
  api,
  refreshKey,
  onRequest,
}: {
  api: ApiClient;
  refreshKey: number;
  onRequest: (limitCents: number) => void;
}) {
  const [account, setAccount] = useState<JsonObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [persona, setPersona] = useState<Persona>(api.persona);
  const [personaOpen, setPersonaOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    api.getCreditLine().then((response) => {
      if (!active) return;
      if (response.isSuccess) {
        setAccount(response.body);
      } else {
        setError('The API answered HTTP ' + response.statusCode + '.');
      }
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setError('Could not reach the mock API.\nIs it running? cd mock-api && npm start');
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [api, persona, refreshKey, reloadKey]);

  const choosePersona = (next: Persona) => {
    api.persona = next;
    setPersona(next);
    setPersonaOpen(false);
  };

  const limit = numberField(account, 'limit_cents');
  const spent = numberField(account, 'balance_cents');
  const alreadyRequested = account?.increase_request != null;

  return (
    <View style={styles.page}>
      <Text style={type.title}>Your credit line</Text>
      <View style={styles.topGap} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={[type.bodyMuted, styles.centerText]}>{error}</Text>
          <View style={styles.mediumGap} />
          <SecondaryButton label="Retry" onPress={() => setReloadKey((value) => value + 1)} />
        </View>
      ) : (
        <View style={styles.flex}>
          {!alreadyRequested ? (
            <PrimaryButton label="Increase" onPress={() => onRequest(limit)} />
          ) : null}
          <View style={styles.mediumGap} />
          <View style={styles.card}>
            <AccountRow label="Credit limit" value={money(limit)} />
            <View style={styles.divider} />
            <AccountRow label="Spent" value={money(spent)} />
          </View>
        </View>
      )}

      <View style={styles.personaRow}>
        <Text style={type.label}>PERSONA</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'Current persona: ' + persona}
          onPress={() => setPersonaOpen(true)}
          style={styles.personaButton}
        >
          <Text numberOfLines={1} style={type.small}>{persona}</Text>
          <View style={styles.chevron} />
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={personaOpen}
        onRequestClose={() => setPersonaOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPersonaOpen(false)}>
          <View style={styles.personaMenu}>
            <Text style={type.heading}>Choose a persona</Text>
            <View style={styles.smallGap} />
            {personas.map((option) => (
              <Pressable
                accessibilityRole="button"
                key={option}
                onPress={() => choosePersona(option)}
                style={({ pressed }) => [
                  styles.personaOption,
                  option === persona && styles.personaOptionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={option === persona ? type.body : type.bodyMuted}>{option}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function RequestPage({
  api,
  limitCents,
  onBack,
  onResult,
}: {
  api: ApiClient;
  limitCents: number;
  onBack: () => void;
  onResult: (result: ApiResult | null, error: string | null) => void;
}) {
  const [amountDollars, setAmountDollars] = useState(500);
  const [submitting, setSubmitting] = useState(false);
  const increase = Math.round(amountDollars * 100);

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await api.submitIncreaseRequest(increase);
      setSubmitting(false);
      onResult(result, null);
    } catch {
      setSubmitting(false);
      onResult(null, 'Could not reach the mock API.');
    }
  };

  return (
    <View style={styles.page}>
      <BackButton onPress={onBack} />
      <Text style={type.title}>Request an increase</Text>
      <View style={styles.topGap} />
      <View style={styles.card}>
        <Text style={[type.label, styles.centerText]}>INCREASE BY</Text>
        <View style={styles.tinyGap} />
        <Text style={[type.display, styles.centerText]}>{moneyWhole(increase)}</Text>
        <Slider
          accessibilityLabel="Increase amount"
          maximumTrackTintColor={color.rule}
          maximumValue={2500}
          minimumTrackTintColor={color.accent}
          minimumValue={100}
          onValueChange={setAmountDollars}
          step={50}
          style={styles.slider}
          thumbTintColor={color.accent}
          value={amountDollars}
        />
        <Text style={[type.small, styles.centerText]}>
          {'New limit if approved: ' + money(limitCents + increase)}
        </Text>
      </View>
      <View style={styles.flex} />
      <PrimaryButton
        disabled={submitting}
        label={submitting ? 'Submitting…' : 'Submit'}
        onPress={submit}
      />
    </View>
  );
}

function ResultPage({
  result,
  error,
  onDone,
}: {
  result: ApiResult | null;
  error: string | null;
  onDone: () => void;
}) {
  let headline = 'Request not sent';
  let detail = result && typeof result.body.message === 'string'
    ? result.body.message
    : result
      ? 'The API answered HTTP ' + result.statusCode + '.'
      : 'Please try again later.';

  if (error || !result || result.statusCode >= 500) {
    headline = 'Something went wrong';
    detail = 'Please try again later.';
  } else if (result.body.status === 'APPROVED') {
    headline = 'Approved';
    detail = typeof result.body.new_limit_cents === 'number'
      ? 'Your new limit is ' + money(result.body.new_limit_cents) + '.'
      : 'Your limit went up.';
  } else if (result.body.status === 'DECLINED') {
    headline = 'Declined';
    detail = "We can't increase your limit right now.";
  }

  return (
    <View style={styles.page}>
      <View style={styles.resultTopGap} />
      <Text style={type.title}>{headline}</Text>
      <View style={styles.smallGap} />
      <Text style={type.bodyMuted}>{detail}</Text>
      <View style={styles.flex} />
      <PrimaryButton label="Back to Home" onPress={onDone} />
    </View>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.accountRow}>
      <Text style={type.bodyMuted}>{label}</Text>
      <Text style={type.numeric}>{value}</Text>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Back"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
    >
      <Text style={styles.backGlyph}>‹</Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
    >
      <Text style={type.body}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.paper,
  },
  page: {
    alignSelf: 'center',
    backgroundColor: color.paper,
    flex: 1,
    padding: space.s5,
    width: '100%',
    maxWidth: 560,
  },
  flex: { flex: 1 },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  topGap: { height: space.s5 },
  resultTopGap: { height: space.s7 },
  mediumGap: { height: space.s4 },
  smallGap: { height: space.s2 },
  tinyGap: { height: space.s1 },
  card: {
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    padding: space.s4,
  },
  accountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  divider: {
    backgroundColor: color.rule,
    height: 1,
    marginVertical: space.s4 / 2,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: color.accent,
    borderRadius: radius,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: space.s4,
    paddingVertical: space.s3,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: {
    ...type.body,
    color: color.accentInk,
    fontWeight: '600',
  },
  secondaryButton: {
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    paddingHorizontal: space.s4,
    paddingVertical: space.s2,
  },
  pressed: { opacity: 0.72 },
  slider: {
    height: 44,
    marginVertical: space.s2,
    width: '100%',
  },
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    marginBottom: space.s2,
    marginLeft: -space.s2,
    width: 36,
  },
  backGlyph: {
    color: color.ink,
    fontSize: 36,
    lineHeight: 36,
  },
  personaRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  personaButton: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 40,
  },
  chevron: {
    borderBottomColor: color.ink2,
    borderBottomWidth: 2,
    borderRightColor: color.ink2,
    borderRightWidth: 2,
    height: 8,
    marginLeft: space.s2,
    marginTop: -4,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(20, 24, 27, 0.35)',
    flex: 1,
    justifyContent: 'center',
    padding: space.s5,
  },
  personaMenu: {
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    maxWidth: 420,
    padding: space.s4,
    width: '100%',
  },
  personaOption: {
    borderRadius: radius,
    minHeight: 44,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
  },
  personaOptionSelected: { backgroundColor: color.accentSoft },
});
