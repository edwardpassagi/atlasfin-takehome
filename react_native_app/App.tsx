import Slider from '@react-native-community/slider';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { ApiClient, ApiResult, JsonObject, Persona, personas } from './src/apiClient';
import { color, radius, radiusButton, shadow, space, type } from './src/tokens';

type Screen =
  | { name: 'home'; refreshKey: number }
  | { name: 'request'; limitCents: number; maxEligibleCents: number | null; guidanceCode: string; eligibleReason: string }
  | { name: 'result'; result: ApiResult | null; error: string | null };

const MIN_INCREASE_DOLLARS = 100;
const FALLBACK_MAX_DOLLARS = 1000;
const STEP_DOLLARS = 50;

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

function personaInitials(persona: string) {
  const parts = persona.split('-');
  if (parts.length === 1) {
    return persona.slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function optionalNumber(object: JsonObject | null, key: string) {
  const value = object?.[key];
  return typeof value === 'number' ? value : null;
}

function numberField(object: JsonObject | null, key: string) {
  return optionalNumber(object, key) ?? 0;
}

function nestedNumber(object: JsonObject | null, parentKey: string, key: string) {
  const parent = object?.[parentKey];
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) {
    return 0;
  }
  const value = (parent as JsonObject)[key];
  return typeof value === 'number' ? value : 0;
}

// The API only returns a reason code after a doomed submit. Infer the same
// reason the mock would use if they asked above remaining room.
function likelyDeclineCode(account: JsonObject | null) {
  const limit = numberField(account, 'limit_cents');
  const maxEligible = optionalNumber(account, 'max_eligible_limit_cents');
  const spent = numberField(account, 'balance_cents') + numberField(account, 'pending_holds_cents');
  const months = nestedNumber(account, 'member', 'months_on_book');
  const remaining = maxEligible == null ? null : maxEligible - limit;
  const utilization = limit > 0 ? spent / limit : 0;

  if (remaining != null && remaining < MIN_INCREASE_DOLLARS * 100) {
    return 'INSUFFICIENT_PAYMENT_HISTORY';
  }
  if (utilization >= 0.7) {
    return 'UTILIZATION_TOO_HIGH';
  }
  if (months <= 3) {
    return 'NEW_CREDIT_LINES';
  }
  return 'UTILIZATION_TOO_HIGH';
}

function increaseRange(limitCents: number, maxEligibleCents: number | null) {
  if (maxEligibleCents == null) {
    return {
      min: MIN_INCREASE_DOLLARS,
      max: FALLBACK_MAX_DOLLARS,
      remainingCents: FALLBACK_MAX_DOLLARS * 100,
      canRequest: true,
    };
  }

  const remainingCents = Math.max(0, maxEligibleCents - limitCents);
  const max = Math.floor(remainingCents / 100 / STEP_DOLLARS) * STEP_DOLLARS;
  return {
    min: MIN_INCREASE_DOLLARS,
    max,
    remainingCents,
    canRequest: max >= MIN_INCREASE_DOLLARS,
  };
}

const declineGuidance: Record<string, { reason: string; linkLabel: string; url: string }> = {
  UTILIZATION_TOO_HIGH: {
    reason:
      'Credit file shows high utilization on this card and / or other cards as of late.',
    linkLabel: 'How utilization affects your credit',
    url: 'https://www.consumerfinance.gov/ask-cfpb/how-does-my-credit-card-use-affect-my-credit-score-en-1883/',
  },
  INSUFFICIENT_PAYMENT_HISTORY: {
    reason: 'We need to see a longer run of on-time payments first.',
    linkLabel: 'How to build a stronger payment history',
    url: 'https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/',
  },
  NEW_CREDIT_LINES: {
    reason: "We've noticed a multitude of new credit lines you've opened.",
    linkLabel: 'How new credit can affect your score',
    url: 'https://www.consumerfinance.gov/ask-cfpb/how-do-credit-inquiries-affect-my-credit-report-en-1317/',
  },
};

const fallbackGuidance = {
  reason: "We can't increase your limit right now.",
  linkLabel: 'How to get and keep a good credit score',
  url: 'https://www.consumerfinance.gov/ask-cfpb/how-do-i-get-and-keep-a-good-credit-score-en-318/',
};

function guidanceFor(code: string | null) {
  return (code && declineGuidance[code]) || fallbackGuidance;
}

function firstReasonCode(result: ApiResult | null) {
  const codes = result?.body.reason_codes;
  return Array.isArray(codes) && typeof codes[0] === 'string' ? codes[0] : null;
}

function eligibilityPhrase(account: JsonObject | null) {
  const limit = numberField(account, 'limit_cents');
  const spent = numberField(account, 'balance_cents') + numberField(account, 'pending_holds_cents');
  const months = nestedNumber(account, 'member', 'months_on_book');
  const utilization = limit > 0 ? spent / limit : 0;
  if (months >= 12) {
    return 'on-time payment history';
  }
  if (utilization < 0.5) {
    return 'responsible credit use';
  }
  return 'account standing';
}

export default function App() {
  const api = useMemo(() => new ApiClient(), []);
  const [screen, setScreen] = useState<Screen>({ name: 'home', refreshKey: 0 });
  const [showWhatsNewTip, setShowWhatsNewTip] = useState(true);

  const goHome = () => {
    setScreen((current) => ({
      name: 'home',
      refreshKey: current.name === 'home' ? current.refreshKey + 1 : Date.now(),
    }));
  };

  const isHome = screen.name === 'home';

  return (
    <SafeAreaView style={[styles.safeArea, isHome && styles.safeAreaHome]}>
      <StatusBar style={isHome ? 'light' : 'dark'} />
      {screen.name === 'home' ? (
        <HomePage
          api={api}
          refreshKey={screen.refreshKey}
          showWhatsNewTip={showWhatsNewTip}
          onDismissWhatsNewTip={() => setShowWhatsNewTip(false)}
          onRequest={(limitCents, maxEligibleCents, guidanceCode, eligibleReason) =>
            setScreen({ name: 'request', limitCents, maxEligibleCents, guidanceCode, eligibleReason })
          }
        />
      ) : screen.name === 'request' ? (
        <RequestPage
          api={api}
          limitCents={screen.limitCents}
          maxEligibleCents={screen.maxEligibleCents}
          guidanceCode={screen.guidanceCode}
          eligibleReason={screen.eligibleReason}
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
  showWhatsNewTip,
  onDismissWhatsNewTip,
  onRequest,
}: {
  api: ApiClient;
  refreshKey: number;
  showWhatsNewTip: boolean;
  onDismissWhatsNewTip: () => void;
  onRequest: (
    limitCents: number,
    maxEligibleCents: number | null,
    guidanceCode: string,
    eligibleReason: string,
  ) => void;
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
  const pending = numberField(account, 'pending_holds_cents');
  const available = Math.max(0, limit - spent - pending);
  const maxEligible = optionalNumber(account, 'max_eligible_limit_cents');
  const alreadyRequested = account?.increase_request != null;
  const showIncrease = !alreadyRequested;

  const onIncreasePress = () => {
    onRequest(limit, maxEligible, likelyDeclineCode(account), eligibilityPhrase(account));
  };

  return (
    <View style={styles.homeRoot}>
      <View style={styles.homeHeader}>
        <Text style={styles.homeLogo}>A</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'Current persona: ' + persona}
          onPress={() => setPersonaOpen(true)}
          style={styles.personaChip}
        >
          <Text style={styles.personaChipText}>{personaInitials(persona)}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={[styles.homeSheet, styles.centered]}>
          <ActivityIndicator color={color.accent} />
        </View>
      ) : error ? (
        <View style={[styles.homeSheet, styles.centered]}>
          <Text style={[type.bodyMuted, styles.centerText]}>{error}</Text>
          <View style={styles.mediumGap} />
          <SecondaryButton label="Retry" onPress={() => setReloadKey((value) => value + 1)} />
        </View>
      ) : (
        <View style={styles.homeSheet}>
          <View style={styles.homeSheetInner}>
          <View style={styles.productCard}>
            <View style={styles.productTitleRow}>
              <View style={styles.cardGlyph}>
                <View style={styles.cardGlyphChip} />
              </View>
              <Text style={styles.productTitle}>Credit Card</Text>
            </View>
            <Text style={styles.heroAmount}>{money(available)}</Text>
            <Text style={styles.availableCaption}>Available to spend</Text>
            <View style={styles.heroGap} />
            <AccountRow label="Current balance" value={money(spent)} />
            <View style={styles.divider} />
            <AccountRow label="Pending" value={money(pending)} />
            <Text style={styles.rowHint}>Will settle in 1–3 business days</Text>
            {showIncrease ? (
              <>
                <View style={styles.mediumGap} />
                <View style={styles.increaseCluster}>
                  <IncreaseLimitButton onPress={onIncreasePress} />
                  {showWhatsNewTip ? (
                    <View style={styles.helptipWrap}>
                      <View style={styles.helptipCaret} />
                      <View style={styles.helptipBubble}>
                        <Text style={[type.label, styles.helptipKicker]}>What's new</Text>
                        <View style={styles.tinyGap} />
                        <Text style={type.body}>
                          You can now request a credit line increase from this screen.
                        </Text>
                        <View style={styles.smallGap} />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Dismiss what's new tip"
                          onPress={onDismissWhatsNewTip}
                          hitSlop={8}
                        >
                          <Text style={styles.link}>Got it</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              </>
            ) : null}
          </View>
        </View>
        </View>
      )}

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
  maxEligibleCents,
  guidanceCode,
  eligibleReason,
  onBack,
  onResult,
}: {
  api: ApiClient;
  limitCents: number;
  maxEligibleCents: number | null;
  guidanceCode: string;
  eligibleReason: string;
  onBack: () => void;
  onResult: (result: ApiResult | null, error: string | null) => void;
}) {
  const range = increaseRange(limitCents, maxEligibleCents);
  const [amountDollars, setAmountDollars] = useState(() =>
    Math.min(Math.max(500, range.min), Math.max(range.min, range.max)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [showMoreGuidance, setShowMoreGuidance] = useState(false);
  const [showEligibleOverlay, setShowEligibleOverlay] = useState(range.canRequest);
  const increase = Math.round(amountDollars * 100);
  const singleAmount = range.canRequest && range.min === range.max;
  const guidance = guidanceFor(guidanceCode);

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
    <View style={styles.resultRoot}>
      <View style={styles.page} pointerEvents={showEligibleOverlay ? 'none' : 'auto'}>
      <BackButton onPress={onBack} />
      <Text style={type.title}>Request an increase</Text>
      <View style={styles.topGap} />
      {range.canRequest ? (
        <View style={styles.card}>
          <Text style={[type.label, styles.centerText]}>Increase by</Text>
          <View style={styles.tinyGap} />
          <Text style={[type.display, styles.centerText]}>{moneyWhole(increase)}</Text>
          {singleAmount ? (
            <Text style={[type.small, styles.centerText]}>
              {'This is the amount you can request today.'}
            </Text>
          ) : (
            <>
              <Slider
                accessibilityLabel="Increase amount"
                maximumTrackTintColor={color.rule}
                maximumValue={range.max}
                minimumTrackTintColor={color.accent}
                minimumValue={range.min}
                onValueChange={setAmountDollars}
                step={STEP_DOLLARS}
                style={styles.slider}
                thumbTintColor={color.accent}
                value={amountDollars}
              />
              <View style={styles.sliderLabels}>
                <Text style={type.small}>{moneyWhole(range.min * 100)}</Text>
                <Text style={type.small}>{moneyWhole(range.max * 100)}</Text>
              </View>
            </>
          )}
          <View style={styles.smallGap} />
          <Text style={[type.small, styles.centerText]}>
            {'Eligible up to ' + moneyWhole(range.remainingCents) + ' more'}
          </Text>
          <Text style={[type.small, styles.centerText]}>
            {'New limit: ' + money(limitCents + increase)}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={type.heading}>We can't increase your limit yet</Text>
          <View style={styles.smallGap} />
          <Text style={type.bodyMuted}>{guidance.reason}</Text>
          <View style={styles.smallGap} />
          <HelpLink label={guidance.linkLabel} url={guidance.url} />
        </View>
      )}
      {range.canRequest ? (
        <>
          <View style={styles.mediumGap} />
          <Pressable
            accessibilityRole="link"
            onPress={() => setShowMoreGuidance((open) => !open)}
          >
            <Text style={styles.link}>
              What if I would like to increase my credit limit even more?
            </Text>
          </Pressable>
        </>
      ) : null}
      {range.canRequest && showMoreGuidance ? (
        <>
          <View style={styles.smallGap} />
          <View style={styles.declineCard}>
            <Text style={type.bodyMuted}>{guidance.reason}</Text>
            <View style={styles.smallGap} />
            <HelpLink label={guidance.linkLabel} url={guidance.url} />
          </View>
        </>
      ) : null}
      <View style={styles.flex} />
      {range.canRequest ? (
        <PrimaryButton
          disabled={submitting}
          label={submitting ? 'Submitting…' : 'Submit'}
          onPress={submit}
        />
      ) : null}
      </View>
      {showEligibleOverlay ? (
        <BlurView intensity={55} tint="light" style={styles.eligibleOverlay}>
          <View style={[styles.card, styles.eligibleOverlayInner]}>
            <Text style={[type.label, styles.centerText, styles.approvedKicker]}>
              You're eligible
            </Text>
            <View style={styles.smallGap} />
            <Text style={[type.title, styles.centerText, styles.approvedHeadline]}>
              Congratulations
            </Text>
            <View style={styles.smallGap} />
            <Text style={[type.bodyMuted, styles.centerText]}>
              {'Due to your ' + eligibleReason +
                ', you are eligible to request a credit line increase!'}
            </Text>
            <View style={styles.mediumGap} />
            <PrimaryButton label="Continue" onPress={() => setShowEligibleOverlay(false)} />
          </View>
        </BlurView>
      ) : null}
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
  const failed = Boolean(error || !result || result.statusCode >= 500);
  const approved = !failed && result?.body.status === 'APPROVED';
  const declined = !failed && result?.body.status === 'DECLINED';
  const guidance = guidanceFor(firstReasonCode(result));
  const newLimit = typeof result?.body.new_limit_cents === 'number'
    ? result.body.new_limit_cents
    : null;
  const approvedAmount = typeof result?.body.approved_amount_cents === 'number'
    ? result.body.approved_amount_cents
    : null;

  let headline = 'Request not sent';
  let detail = result && typeof result.body.message === 'string'
    ? result.body.message
    : result
      ? 'The API answered HTTP ' + result.statusCode + '.'
      : 'Please try again later.';

  if (failed) {
    headline = 'Something went wrong';
    detail = 'Please try again later.';
  } else if (approved) {
    headline = "You're approved!";
    detail = newLimit != null
      ? 'Your credit line is now ' + money(newLimit) + '.'
      : 'Your limit went up.';
  } else if (declined) {
    headline = "We can't increase your limit yet";
    detail = guidance.reason;
  }

  return (
    <View style={styles.resultRoot}>
      {approved ? <ConfettiBurst /> : null}
      <View style={styles.page}>
        <View style={styles.resultTopGap} />
        {approved ? (
          <>
            <Text style={[type.label, styles.centerText, styles.approvedKicker]}>Approved</Text>
            <View style={styles.tinyGap} />
            <Text style={[type.title, styles.centerText, styles.approvedHeadline]}>{headline}</Text>
            <View style={styles.smallGap} />
            {newLimit != null ? (
              <Text style={[type.display, styles.centerText, styles.approvedLimit]}>
                {money(newLimit)}
              </Text>
            ) : null}
            <View style={styles.tinyGap} />
            <Text style={[type.bodyMuted, styles.centerText]}>{detail}</Text>
            {approvedAmount != null ? (
              <>
                <View style={styles.smallGap} />
                <Text style={[type.small, styles.centerText]}>
                  {'Increase of ' + moneyWhole(approvedAmount)}
                </Text>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Text style={type.title}>{headline}</Text>
            <View style={styles.smallGap} />
            <Text style={type.bodyMuted}>{detail}</Text>
            {declined ? (
              <>
                <View style={styles.mediumGap} />
                <View style={styles.declineCard}>
                  <Text style={type.heading}>What you can do next</Text>
                  <View style={styles.smallGap} />
                  <Text style={type.bodyMuted}>
                    This doesn't affect your credit score. A few changes over time can put you
                    in a better place to request again.
                  </Text>
                  <View style={styles.smallGap} />
                  <HelpLink label={guidance.linkLabel} url={guidance.url} />
                </View>
              </>
            ) : null}
          </>
        )}
        <View style={styles.flex} />
        <PrimaryButton label="Back to Home" onPress={onDone} />
      </View>
    </View>
  );
}

function HelpLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => {
        Linking.openURL(url).catch(() => {});
      }}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const CONFETTI_COLORS = [
  color.accent,
  color.navy,
  color.positive,
  color.warning,
  '#E8B931',
  color.accentSoft,
];

function ConfettiBurst() {
  const { height, width } = useWindowDimensions();
  const pieces = useMemo(
    () =>
      Array.from({ length: 42 }, (_, id) => ({
        id,
        left: Math.random() * width,
        size: 6 + Math.random() * 7,
        color: CONFETTI_COLORS[id % CONFETTI_COLORS.length],
        delay: Math.random() * 280,
        duration: 2800 + Math.random() * 1600,
        drift: (Math.random() - 0.5) * 120,
        spin: (Math.random() > 0.5 ? 1 : -1) * (220 + Math.random() * 280),
      })),
    [width],
  );

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {pieces.map((piece) => (
        <ConfettiPiece key={piece.id} fallTo={height + 40} {...piece} />
      ))}
    </View>
  );
}

function ConfettiPiece({
  left,
  size,
  color: fill,
  delay,
  duration,
  drift,
  spin,
  fallTo,
}: {
  id: number;
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  fallTo: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, duration, progress]);

  return (
    <Animated.View
      style={[
        styles.confettiPiece,
        {
          left,
          width: size,
          height: size * 1.6,
          backgroundColor: fill,
          opacity: progress.interpolate({
            inputRange: [0, 0.15, 0.75, 1],
            outputRange: [0, 1, 1, 0],
          }),
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-24, fallTo],
              }),
            },
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, drift],
              }),
            },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', spin + 'deg'],
              }),
            },
          ],
        },
      ]}
    />
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.accountRow}>
      <Text style={type.label}>{label}</Text>
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

function IncreaseLimitButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Increase Limit"
      onPress={onPress}
      style={({ pressed }) => [styles.actionItem, pressed && styles.pressed]}
    >
      <View style={styles.actionCircle}>
        <Text style={styles.actionGlyph}>↗</Text>
      </View>
      <Text style={styles.actionLabel}>Increase Limit</Text>
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
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.paper,
    overflow: 'hidden',
  },
  safeAreaHome: {
    backgroundColor: color.accent,
  },
  homeRoot: {
    flex: 1,
  },
  homeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.s5,
    paddingVertical: space.s3,
  },
  homeLogo: {
    color: color.accentInk,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  homeSheet: {
    backgroundColor: color.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flex: 1,
    padding: space.s5,
  },
  homeSheetInner: {
    alignSelf: 'center',
    maxWidth: 430,
    width: '100%',
  },
  resultRoot: {
    flex: 1,
  },
  page: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
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
  heroGap: { height: space.s5 },
  productCard: {
    ...shadow,
    backgroundColor: color.surface,
    borderRadius: radius,
    padding: space.s5,
  },
  productTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space.s2,
    marginBottom: space.s3,
  },
  cardGlyph: {
    backgroundColor: color.navy,
    borderRadius: 6,
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 4,
    width: 28,
  },
  cardGlyphChip: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 2,
    height: 8,
    width: 10,
  },
  productTitle: {
    ...type.heading,
    fontWeight: '600',
  },
  heroAmount: {
    ...type.display,
    fontSize: 40,
    letterSpacing: -1,
    lineHeight: 44,
  },
  availableCaption: {
    ...type.small,
    color: color.accent,
    fontWeight: '500',
    marginTop: space.s1,
  },
  rowHint: {
    ...type.small,
    marginTop: space.s1,
  },
  actionItem: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    width: 88,
  },
  actionCircle: {
    alignItems: 'center',
    backgroundColor: color.accentSoft,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  actionGlyph: {
    color: color.accent,
    fontSize: 22,
    fontWeight: '700',
  },
  actionLabel: {
    ...type.small,
    color: color.ink,
    fontWeight: '500',
    marginTop: space.s2,
    textAlign: 'center',
  },
  increaseCluster: {
    alignSelf: 'flex-start',
  },
  card: {
    ...shadow,
    backgroundColor: color.surface,
    borderRadius: radius,
    padding: space.s5,
  },
  declineCard: {
    backgroundColor: color.criticalSoft,
    borderRadius: radius,
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
    marginVertical: space.s4,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: color.accent,
    borderRadius: radiusButton,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: space.s5,
    paddingVertical: space.s3,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: {
    ...type.body,
    color: color.accentInk,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderColor: color.accentSoft,
    borderRadius: radiusButton,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: space.s5,
    paddingVertical: space.s3,
  },
  secondaryButtonText: {
    ...type.body,
    color: color.accent,
    fontWeight: '600',
  },
  pressed: { opacity: 0.72 },
  slider: {
    height: 44,
    marginVertical: space.s2,
    width: '100%',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  link: {
    ...type.body,
    color: color.accent,
    fontWeight: '600',
  },
  approvedKicker: {
    color: color.accent,
    fontWeight: '600',
  },
  approvedHeadline: {
    color: color.ink,
  },
  approvedLimit: {
    color: color.ink,
  },
  confettiLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  confettiPiece: {
    position: 'absolute',
    top: 0,
    borderRadius: 1,
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
  personaChip: {
    alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  personaChipText: {
    color: color.ink,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 22, 29, 0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: space.s5,
  },
  personaMenu: {
    ...shadow,
    backgroundColor: color.surface,
    borderRadius: radius,
    maxWidth: 420,
    padding: space.s4,
    width: '100%',
  },
  personaOption: {
    borderRadius: radiusButton,
    minHeight: 44,
    paddingHorizontal: space.s3,
    paddingVertical: space.s3,
  },
  personaOptionSelected: { backgroundColor: color.accentSoft },
  helptipWrap: {
    alignItems: 'flex-start',
    marginTop: space.s2,
    maxWidth: 260,
    width: 260,
  },
  helptipCaret: {
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderLeftWidth: 1,
    borderTopWidth: 1,
    height: 10,
    marginBottom: -6,
    marginLeft: 39,
    transform: [{ rotate: '45deg' }],
    width: 10,
    zIndex: 1,
  },
  helptipBubble: {
    ...shadow,
    backgroundColor: color.surface,
    borderColor: color.rule,
    borderRadius: radius,
    borderWidth: 1,
    padding: space.s4,
    width: '100%',
  },
  helptipKicker: {
    color: color.accent,
    fontWeight: '600',
  },
  eligibleOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    padding: space.s5,
  },
  eligibleOverlayInner: {
    alignSelf: 'center',
    maxWidth: 420,
    width: '100%',
  },
});

