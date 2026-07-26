import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, ProgressBar, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingProgress } from '../../components/provider/OnboardingProgress';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useAuthStore } from '../../store/authStore';
import { useKycStore } from '../../store/kycStore';
import { useVerificationStore } from '../../store/verificationStore';
import type { KycStatus } from '../../api/kyc';
import type { PendingListing, TierState, VerificationTierRow } from '../../api/verification';
import { palette, radius as r, spacing, typography } from '../../theme';

// ── The gate's requirement vocabulary (mirrors the server ladder) ────────────
// Keys are the `verification_type` values the dispatch gate can require; the
// labels are what we show the provider. `unverified` is the trust<1 sentinel.
const REQUIREMENT_LABEL: Record<string, string> = {
  unverified:      'Verify your identity (Tier 1)',
  nrc:             'Verify your identity — NRC + selfie',
  momo_name_match: 'Confirm your Mobile Money identity',
  portfolio:       'Add a portfolio of your work',
  police_clearance:'Add a police clearance certificate',
  selfie_match:    'Complete your selfie check',
  service_not_found: 'This listing is no longer available',
};

type Step = 'overview' | 'tier1' | 'portfolio' | 'clearance' | 'submitted';
// How the government ID is provided: two photos (front + back) or one copy
// (a scanned PDF or a single photo).
type IdMode = 'two_side' | 'single';

const isPdfUri = (uri: string | null) => !!uri && uri.toLowerCase().split('?')[0].endsWith('.pdf');

const TIER_ICON: Record<number, string> = {
  1: 'card-account-details-outline',
  2: 'image-multiple-outline',
  3: 'shield-check-outline',
  4: 'trophy-outline',
};

/**
 * The verification ladder's base (Tier 1) row only reports DONE / ADD — it can't
 * express "under review" because the gate flips only on admin approval. So we
 * overlay the KYC document lifecycle (kyc status) to give the provider real
 * feedback after they submit their NRC + selfie. documents are newest-first.
 */
function deriveTier1State(baseState: TierState, kyc: KycStatus | null): { state: TierState; reason?: string } {
  if (baseState === 'DONE') return { state: 'DONE' };
  const docs = kyc?.documents ?? [];
  const attn = docs.find(
    (d) => d.info_requested || ['SUBMITTED', 'MANUAL_REVIEW', 'AUTO_REJECTED', 'REJECTED', 'EXPIRED'].includes(d.status),
  );
  if (!attn) return { state: 'ADD' };
  if (attn.info_requested) {
    return { state: 'NEEDS_CHANGES', reason: attn.review_note ?? 'The reviewer needs more detail on your ID.' };
  }
  if (['AUTO_REJECTED', 'REJECTED', 'EXPIRED'].includes(attn.status)) {
    return { state: 'NEEDS_CHANGES', reason: attn.review_note ?? 'Your ID could not be verified. Submit a clearer photo.' };
  }
  return { state: 'UNDER_REVIEW' };
}

const IDENTITY_MISSING = ['unverified', 'nrc', 'momo_name_match', 'selfie_match'];

// ── Component ────────────────────────────────────────────────────────────────
export default function KycScreen({ navigation, route }: any) {
  const onboardingStep: number | undefined = route?.params?.onboardingStep;
  const activeRole = useAuthStore((s) => s.activeRole);

  const { status, loading, error, fetchStatus, submitPortfolio, submitPoliceClearance, submitting, clearError } =
    useVerificationStore();
  // Tier 1 (NRC + selfie) is written by the KYC pipeline — the verification
  // ladder has no Tier-1 submit endpoint, so we reuse the kyc store for it.
  const kyc = useKycStore();

  const { showSuccess, showError, showSnackbar } = useSnackbar();

  const [step, setStep] = useState<Step>('overview');

  // Tier 1 capture
  const [legalName, setLegalName] = useState('');
  const [nrcNumber, setNrcNumber] = useState('');
  const [idMode, setIdMode] = useState<IdMode>('two_side');
  const [nrcUri, setNrcUri] = useState<string | null>(null);       // front (two_side)
  const [nrcBackUri, setNrcBackUri] = useState<string | null>(null); // back (two_side)
  const [copyUri, setCopyUri] = useState<string | null>(null);      // single copy (photo or PDF)
  const [selfieUri, setSelfieUri] = useState<string | null>(null);

  // Tier 2 (portfolio)
  const [portfolioUris, setPortfolioUris] = useState<string[]>([]);

  // Tier 3 (police clearance)
  const [clearanceUri, setClearanceUri] = useState<string | null>(null);
  const [certNumber, setCertNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');

  // Refresh BOTH surfaces: the verification ladder (tiers 2–4 + gates) and the
  // KYC document lifecycle (Tier 1 review state).
  const refreshAll = useCallback(() => {
    fetchStatus();
    kyc.fetchStatus();
  }, []);

  useEffect(() => {
    if (activeRole === 'PROVIDER') refreshAll();
  }, [activeRole]);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  // ── Image helpers ──────────────────────────────────────────────────────────
  const pickImage = async (setter: (uri: string) => void) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return showError('Photo access is required to upload documents.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled && result.assets[0]) setter(result.assets[0].uri);
  };

  const takePhoto = async (setter: (uri: string) => void, front = false) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return showError('Camera access is required.');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    });
    if (!result.canceled && result.assets[0]) setter(result.assets[0].uri);
  };

  // Single-copy ID: a scanned file — allow images AND PDFs.
  const pickDocument = async (setter: (uri: string) => void) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets?.[0]) setter(result.assets[0].uri);
  };

  const pickPortfolio = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return showError('Photo access is required to upload your portfolio.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 8,
    });
    if (!result.canceled) {
      const uris = result.assets.map((a) => a.uri);
      setPortfolioUris((prev) => [...prev, ...uris].slice(0, 8));
    }
  };

  // ── Submit handlers ─────────────────────────────────────────────────────────
  const resetCapture = () => {
    setLegalName(''); setIdMode('two_side'); setNrcUri(null); setNrcBackUri(null); setCopyUri(null); setSelfieUri(null);
    setPortfolioUris([]);
    setClearanceUri(null); setCertNumber(''); setIssuedOn(''); setExpiresOn('');
  };

  // Front photo (two-side) or the single copy — plus the optional back.
  const idDocUri = idMode === 'two_side' ? nrcUri : copyUri;
  const idBackUri = idMode === 'two_side' ? nrcBackUri : null;
  const idReady = idMode === 'two_side' ? !!nrcUri && !!nrcBackUri : !!copyUri;

  // Zambian NRC canonical format: 123456/78/1 (spaces tolerated).
  const nrcClean = nrcNumber.replace(/\s+/g, '');
  const nrcValid = /^\d{6}\/\d{2}\/\d$/.test(nrcClean);

  const handleSubmitTier1 = async () => {
    if (!idDocUri || !selfieUri || legalName.trim().length < 2 || !idReady || !nrcValid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Tier 1 = legal name + NRC number (mandatory) + selfie, then the NRC document
    // pipeline. The document may be two photos (front + back) or one copy (photo or
    // PDF); both write the provider_verifications the dispatch gate reads.
    const okSelfie = await kyc.submitTier1(legalName.trim(), nrcClean, selfieUri);
    if (!okSelfie) return showError(kyc.error?.message ?? 'Could not submit your selfie.');
    const okDoc = await kyc.submitDocument('NRC', idDocUri, selfieUri, idBackUri);
    if (!okDoc) return showError(kyc.error?.message ?? 'Could not submit your NRC.');
    await refreshAll();
    resetCapture();
    setStep('submitted');
  };

  const handleSubmitPortfolio = async () => {
    if (portfolioUris.length < 3) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await submitPortfolio(portfolioUris);
    if (ok) { resetCapture(); setStep('submitted'); }
  };

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

  const handleSubmitClearance = async () => {
    if (!clearanceUri || certNumber.trim().length < 3 || !isValidDate(issuedOn)) return;
    if (expiresOn && !isValidDate(expiresOn)) return showError('Expiry date must be YYYY-MM-DD.');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await submitPoliceClearance(clearanceUri, certNumber.trim(), issuedOn, expiresOn || null);
    if (ok) { resetCapture(); setStep('submitted'); }
  };

  // Tier 1's real state = the base row overlaid with the KYC document lifecycle.
  const baseTier1 = (status?.tiers ?? []).find((t) => t.tier === 1);
  const tier1 = deriveTier1State(baseTier1?.state ?? 'ADD', kyc.status);
  const identityUnderReview = tier1.state === 'UNDER_REVIEW';

  // ── Routing a tier / a blocked-listing requirement to its capture flow ──────
  const startTierAction = (row: VerificationTierRow) => {
    if (row.tier === 1) {
      if (identityUnderReview) return showSnackbar({ message: "Your identity is under review — we'll let you know the outcome." });
      return setStep('tier1');
    }
    if (row.verification_type === 'portfolio') return setStep('portfolio');
    if (row.verification_type === 'police_clearance') return setStep('clearance');
  };

  const startForMissing = (miss: string) => {
    if (miss === 'portfolio') return setStep('portfolio');
    if (miss === 'police_clearance') return setStep('clearance');
    // unverified / nrc / momo_name_match / selfie_match all resolve at Tier 1
    if (identityUnderReview) return showSnackbar({ message: "Your identity is under review — we'll let you know the outcome." });
    return setStep('tier1');
  };

  // ── Non-provider guard ──────────────────────────────────────────────────────
  if (activeRole !== 'PROVIDER') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <MaterialCommunityIcons name="shield-account-outline" size={56} color={palette.textDisabled} />
          <Text style={[styles.heading, { marginTop: spacing.md, textAlign: 'center' }]}>Provider verification</Text>
          <Text style={[styles.sub, { textAlign: 'center' }]}>
            Identity verification unlocks paid work. Switch to your provider account to continue.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading && !status) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator size="large" color={palette.primary} /></View>
      </SafeAreaView>
    );
  }

  // ── Submitted confirmation ──────────────────────────────────────────────────
  if (step === 'submitted') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <MaterialCommunityIcons name="check-circle-outline" size={72} color={palette.success} />
          <Text style={[styles.heading, { marginTop: spacing.md }]}>Submitted for review</Text>
          <Text style={[styles.sub, { textAlign: 'center' }]}>
            A reviewer will check your documents — usually within 24 hours. We'll notify you the moment it's decided.
          </Text>
          <Button mode="contained" onPress={() => { setStep('overview'); refreshAll(); }} style={{ marginTop: spacing.lg }}>
            Back to verification
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // ── Tier 1 capture (NRC + selfie) ───────────────────────────────────────────
  if (step === 'tier1') {
    const canSubmit = idReady && !!selfieUri && legalName.trim().length >= 2 && nrcValid;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <CaptureHeader title="Verify your identity" subtitle="Tier 1 · unlocks remote & digital jobs" onBack={() => setStep('overview')} />
          <Text style={styles.sub}>Enter your name exactly as it appears on your NRC. We match it against your Mobile Money wallet.</Text>

          <View style={styles.card}>
            <TextInput
              mode="outlined"
              label="Legal full name"
              placeholder="e.g. John Mulenga Banda"
              value={legalName}
              onChangeText={setLegalName}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="account-outline" />}
            />
          </View>

          <View style={styles.card}>
            <TextInput
              mode="outlined"
              label="NRC number"
              placeholder="123456/78/1"
              value={nrcNumber}
              onChangeText={setNrcNumber}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              error={nrcNumber.length > 0 && !nrcValid}
              style={styles.input}
              outlineStyle={styles.inputOutline}
              left={<TextInput.Icon icon="card-account-details-outline" />}
            />
          </View>

          {/* Choose how to provide the ID: two photos or a single copy (PDF/photo). */}
          <Text style={styles.photoLabel}>How would you like to add your NRC?</Text>
          <View style={styles.modeToggle}>
            <ModeButton active={idMode === 'two_side'} icon="card-account-details-outline" label="Front & back" onPress={() => setIdMode('two_side')} />
            <ModeButton active={idMode === 'single'} icon="file-document-outline" label="Single copy" onPress={() => setIdMode('single')} />
          </View>

          {idMode === 'two_side' ? (
            <>
              <Text style={styles.photoLabel}>NRC — front</Text>
              <View style={styles.card}>
                <PhotoField uri={nrcUri} label="Front of your NRC" onCamera={() => takePhoto(setNrcUri)} onGallery={() => pickImage(setNrcUri)} />
              </View>
              <Text style={styles.photoLabel}>NRC — back</Text>
              <View style={styles.card}>
                <PhotoField uri={nrcBackUri} label="Back of your NRC" onCamera={() => takePhoto(setNrcBackUri)} onGallery={() => pickImage(setNrcBackUri)} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.photoLabel}>NRC — single copy (PDF or photo)</Text>
              <View style={styles.card}>
                <DocField uri={copyUri} onPick={() => pickDocument(setCopyUri)} onClear={() => setCopyUri(null)} />
              </View>
            </>
          )}

          <Text style={styles.photoLabel}>Selfie</Text>
          <View style={styles.card}>
            <PhotoField uri={selfieUri} label="Look straight at the camera" onCamera={() => takePhoto(setSelfieUri, true)} onGallery={() => pickImage(setSelfieUri)} />
          </View>

          <Button mode="contained" disabled={!canSubmit || kyc.loading} loading={kyc.loading} onPress={handleSubmitTier1} style={styles.cta} contentStyle={styles.ctaContent}>
            Submit for verification
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Tier 2 capture (portfolio) ──────────────────────────────────────────────
  if (step === 'portfolio') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <CaptureHeader title="Add your portfolio" subtitle="Tier 2 · unlocks public-venue jobs" onBack={() => setStep('overview')} />
          <Text style={styles.sub}>Add 3 to 8 clear photos of your own work. Each photo is checked before review.</Text>

          <View style={styles.thumbGrid}>
            {portfolioUris.map((uri, i) => (
              <View key={uri + i} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <TouchableRipple
                  onPress={() => setPortfolioUris((p) => p.filter((_, idx) => idx !== i))}
                  borderless
                  style={styles.thumbRemove}
                >
                  <MaterialCommunityIcons name="close-circle" size={22} color={palette.danger} />
                </TouchableRipple>
              </View>
            ))}
            {portfolioUris.length < 8 && (
              <TouchableRipple onPress={pickPortfolio} style={styles.thumbAdd} borderless>
                <View style={styles.thumbAddInner}>
                  <MaterialCommunityIcons name="plus" size={28} color={palette.primary} />
                  <Text style={styles.thumbAddText}>Add photos</Text>
                </View>
              </TouchableRipple>
            )}
          </View>
          <Text style={styles.countHint}>{portfolioUris.length} of 8 · minimum 3</Text>

          <Button mode="contained" disabled={portfolioUris.length < 3 || submitting} loading={submitting} onPress={handleSubmitPortfolio} style={styles.cta} contentStyle={styles.ctaContent}>
            Submit portfolio
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Tier 3 capture (police clearance) ───────────────────────────────────────
  if (step === 'clearance') {
    const canSubmit = !!clearanceUri && certNumber.trim().length >= 3 && isValidDate(issuedOn) && (!expiresOn || isValidDate(expiresOn));
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <CaptureHeader title="Police clearance" subtitle="Tier 3 · unlocks in-home jobs" onBack={() => setStep('overview')} />
          <Text style={styles.sub}>Upload a clear photo of your Zambia Police clearance certificate and its details.</Text>

          <Text style={styles.photoLabel}>Certificate photo</Text>
          <View style={styles.card}>
            <PhotoField uri={clearanceUri} label="Photo of the certificate" onCamera={() => takePhoto(setClearanceUri)} onGallery={() => pickImage(setClearanceUri)} />
          </View>

          <View style={styles.card}>
            <TextInput mode="outlined" label="Certificate number" value={certNumber} onChangeText={setCertNumber} style={styles.input} outlineStyle={styles.inputOutline} left={<TextInput.Icon icon="identifier" />} />
            <TextInput mode="outlined" label="Issued on (YYYY-MM-DD)" value={issuedOn} onChangeText={setIssuedOn} placeholder="2026-01-15" style={[styles.input, { marginTop: spacing.sm }]} outlineStyle={styles.inputOutline} left={<TextInput.Icon icon="calendar" />} />
            <TextInput mode="outlined" label="Expires on (optional)" value={expiresOn} onChangeText={setExpiresOn} placeholder="2028-01-15" style={[styles.input, { marginTop: spacing.sm }]} outlineStyle={styles.inputOutline} left={<TextInput.Icon icon="calendar-clock" />} />
          </View>

          <Button mode="contained" disabled={!canSubmit || submitting} loading={submitting} onPress={handleSubmitClearance} style={styles.cta} contentStyle={styles.ctaContent}>
            Submit clearance
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Overview (the ladder) ────────────────────────────────────────────────────
  const currentTier = status?.current_tier ?? 0;
  const tiers = status?.tiers ?? [];
  const pending = status?.pending_listings ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshAll} tintColor={palette.primary} />}
      >
        {onboardingStep != null && <OnboardingProgress step={onboardingStep} />}

        <Text style={styles.heading}>Identity verification</Text>
        <Text style={styles.sub}>
          Each tier clears you for a wider set of jobs. You only need the tier your listings actually require.
        </Text>

        <View style={styles.card}>
          <View style={styles.tierRow}>
            <Text style={styles.sectionLabel}>Current tier</Text>
            <View style={[styles.tierBadge, { borderColor: palette.primary }]}>
              <Text style={[styles.tierLabel, { color: palette.primary }]}>
                {currentTier > 0 ? `Tier ${currentTier}` : 'Unverified'}
              </Text>
            </View>
          </View>
          <ProgressBar progress={currentTier / 4} color={palette.primary} style={styles.tierBar} />
        </View>

        {/* Gate surface — services the eligibility check currently blocks. */}
        {pending.length > 0 && <GateBanner listings={pending} onFix={startForMissing} />}

        {/* The ladder, straight from the server's eligibility mirror. Tier 1 is
            overlaid with its live KYC review state (submitted / under review /
            needs changes) so the provider always knows where their ID stands. */}
        {tiers.map((row) => {
          const shown = row.tier === 1 ? { ...row, state: tier1.state, reason: tier1.reason ?? row.reason } : row;
          return <TierRow key={row.tier} row={shown} currentTier={currentTier} onAction={() => startTierAction(row)} />;
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Gate banner ───────────────────────────────────────────────────────────────
function GateBanner({ listings, onFix }: { listings: PendingListing[]; onFix: (miss: string) => void }) {
  // Collect the distinct missing requirements across all blocked listings.
  const missing = Array.from(
    new Set(listings.flatMap((l) => l.eligibility.missing).filter((m) => m !== 'service_not_found')),
  );
  return (
    <View style={[styles.statusCard, { backgroundColor: palette.warningLight, borderColor: palette.warning }]}>
      <View style={styles.statusHeaderRow}>
        <MaterialCommunityIcons name="lock-alert-outline" size={22} color={palette.warning} />
        <Text style={[styles.statusTitle, { color: palette.warning }]}>
          {listings.length} {listings.length === 1 ? 'listing' : 'listings'} can't take bookings yet
        </Text>
      </View>
      <Text style={styles.statusBody}>
        {listings.map((l) => l.title).filter(Boolean).join(', ') || 'Some of your services'} need more verification before customers can book them.
      </Text>
      <View style={styles.gateActions}>
        {missing.map((m) => (
          <Button key={m} mode="contained" compact buttonColor={palette.warning} onPress={() => onFix(m)} style={styles.gateBtn} labelStyle={styles.gateBtnLabel}>
            {REQUIREMENT_LABEL[m] ?? m}
          </Button>
        ))}
      </View>
    </View>
  );
}

// ── Tier row ──────────────────────────────────────────────────────────────────
function TierRow({ row, currentTier, onAction }: { row: VerificationTierRow; currentTier: number; onAction: () => void }) {
  const icon = TIER_ICON[row.tier] ?? 'shield-outline';
  const done = row.state === 'DONE' || row.state === 'EARNED';
  // Identity (Tier 1) is the ONLY universal prerequisite — the gate returns
  // `unverified` below trust tier 1. Portfolio (Tier 2) and police clearance
  // (Tier 3) are independent job-type unlocks, so they are NOT locked behind
  // each other; only behind identity.
  const locked = row.kind === 'upload' && currentTier < 1 && !done;

  const stateChip = (() => {
    switch (row.state) {
      case 'DONE':
      case 'EARNED':          return { label: 'Done', color: palette.success, bg: palette.successLight };
      case 'UNDER_REVIEW':    return { label: 'Under review', color: palette.primary, bg: palette.primaryLight };
      case 'NEEDS_CHANGES':   return { label: 'Needs changes', color: palette.danger, bg: palette.dangerLight };
      case 'EARNED_PROGRESS': return { label: 'In progress', color: palette.textSecondary, bg: palette.border };
      default:                return null; // ADD
    }
  })();

  return (
    <View style={[styles.tierCard, done && styles.tierCardDone, locked && styles.tierCardDisabled]}>
      <View style={styles.tierCardInner}>
        <View style={styles.tierCardLeft}>
          <MaterialCommunityIcons name={(done ? 'check-circle' : icon) as any} size={26} color={done ? palette.success : locked ? palette.textDisabled : palette.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.tierTitleRow}>
            <Text style={[styles.tierCardTitle, locked && { color: palette.textDisabled }]}>Tier {row.tier} · {row.label}</Text>
            {stateChip && (
              <View style={[styles.stateChip, { backgroundColor: stateChip.bg }]}>
                <Text style={[styles.stateChipText, { color: stateChip.color }]}>{stateChip.label}</Text>
              </View>
            )}
          </View>
          {!!row.requirement && <Text style={styles.tierReq}>{row.requirement}</Text>}
          <Text style={styles.tierCardDesc}>Unlocks: {row.unlocks}</Text>

          {/* Reviewer asked for changes */}
          {row.state === 'NEEDS_CHANGES' && !!row.reason && (
            <Text style={styles.tierReason}>{row.reason}</Text>
          )}

          {/* Tier 4 earned progress */}
          {row.progress && (
            <View style={styles.progressRows}>
              <ProgressLine met={row.progress.jobs_met} label={`${row.progress.completed_jobs} / ${row.progress.required_jobs} jobs completed`} />
              <ProgressLine met={row.progress.rating_met} label={`${row.progress.avg_rating ?? '–'} / ${row.progress.required_rating} rating`} />
              <ProgressLine met={row.progress.disputes_met} label={`${row.progress.upheld_disputes} upheld disputes`} />
            </View>
          )}

          {/* Action */}
          {(row.state === 'ADD' || row.state === 'NEEDS_CHANGES') && !locked && (
            <Button mode={row.state === 'NEEDS_CHANGES' ? 'contained' : 'outlined'} compact onPress={onAction} style={styles.tierActionBtn} buttonColor={row.state === 'NEEDS_CHANGES' ? palette.danger : undefined}>
              {row.state === 'NEEDS_CHANGES' ? 'Resubmit' : row.tier === 1 ? 'Verify identity' : 'Add'}
            </Button>
          )}
          {row.state === 'DONE' && row.expires_at && (
            <Text style={styles.tierExpiry}>Valid until {new Date(row.expires_at).toLocaleDateString()}</Text>
          )}
          {locked && <Text style={styles.tierLockedHint}>Verify your identity (Tier 1) first</Text>}
        </View>
      </View>
    </View>
  );
}

function ProgressLine({ met, label }: { met: boolean; label: string }) {
  return (
    <View style={styles.progressLine}>
      <MaterialCommunityIcons name={met ? 'check-circle' : 'circle-outline'} size={16} color={met ? palette.success : palette.textDisabled} />
      <Text style={[styles.progressText, met && { color: palette.textPrimary }]}>{label}</Text>
    </View>
  );
}

// ── Shared capture sub-components ─────────────────────────────────────────────
function CaptureHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <View style={styles.stepHeader}>
      <TouchableRipple onPress={onBack} borderless style={styles.backBtn}>
        <MaterialCommunityIcons name="arrow-left" size={24} color={palette.textPrimary} />
      </TouchableRipple>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepCount}>{subtitle}</Text>
      </View>
    </View>
  );
}

function ModeButton({ active, icon, label, onPress }: { active: boolean; icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableRipple onPress={onPress} borderless style={[styles.modeOption, active && styles.modeOptionActive]}>
      <View style={styles.modeInner}>
        <MaterialCommunityIcons name={icon as any} size={20} color={active ? palette.primary : palette.textSecondary} />
        <Text style={[styles.modeText, active && { color: palette.primary }]}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

function DocField({ uri, onPick, onClear }: { uri: string | null; onPick: () => void; onClear: () => void }) {
  const pdf = isPdfUri(uri);
  return (
    <View style={styles.photoArea}>
      {uri ? (
        pdf ? (
          <View style={styles.pdfChip}>
            <MaterialCommunityIcons name="file-pdf-box" size={34} color={palette.danger} />
            <Text style={styles.pdfChipText}>PDF copy attached</Text>
            <TouchableRipple onPress={onClear} borderless style={styles.pdfClear}>
              <MaterialCommunityIcons name="close-circle" size={22} color={palette.textDisabled} />
            </TouchableRipple>
          </View>
        ) : (
          <TouchableRipple onPress={onPick} borderless style={styles.photoPreviewWrap}>
            <Image source={{ uri }} style={styles.photoPreview} />
          </TouchableRipple>
        )
      ) : (
        <View style={styles.photoPlaceholder}>
          <MaterialCommunityIcons name="file-upload-outline" size={40} color={palette.textDisabled} />
          <Text style={styles.photoPlaceholderText}>A scanned copy of your NRC</Text>
        </View>
      )}
      <Button mode="outlined" onPress={onPick} icon="file-document-outline" style={styles.photoBtn} compact>
        {uri ? 'Choose a different file' : 'Choose file (PDF or photo)'}
      </Button>
    </View>
  );
}

function PhotoField({ uri, label, onCamera, onGallery }: { uri: string | null; label: string; onCamera: () => void; onGallery: () => void }) {
  return (
    <View style={styles.photoArea}>
      {uri ? (
        <TouchableRipple onPress={onGallery} borderless style={styles.photoPreviewWrap}>
          <Image source={{ uri }} style={styles.photoPreview} />
        </TouchableRipple>
      ) : (
        <View style={styles.photoPlaceholder}>
          <MaterialCommunityIcons name="image-outline" size={40} color={palette.textDisabled} />
          <Text style={styles.photoPlaceholderText}>{label}</Text>
        </View>
      )}
      <View style={styles.photoBtnRow}>
        <Button mode="outlined" onPress={onCamera} icon="camera" style={styles.photoBtn} compact>Camera</Button>
        <Button mode="outlined" onPress={onGallery} icon="image" style={styles.photoBtn} compact>Gallery</Button>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: palette.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  heading: { ...typography.heading2, color: palette.textPrimary, marginBottom: spacing.xs },
  sub:     { ...typography.body, color: palette.textSecondary, marginBottom: spacing.md },
  sectionLabel: { ...typography.label, color: palette.textSecondary },

  card: {
    backgroundColor: palette.surface, borderRadius: r.sm, borderWidth: 1,
    borderColor: palette.border, padding: spacing.md, marginBottom: spacing.md,
  },

  // Current tier
  tierRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  tierBar:  { height: 6, borderRadius: 3 },
  tierBadge:{ borderWidth: 1.5, borderRadius: r.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  tierLabel:{ ...typography.label, fontSize: 12 },

  // Ladder rows
  tierCard: { backgroundColor: palette.surface, borderRadius: r.sm, borderWidth: 1, borderColor: palette.border, marginBottom: spacing.sm, overflow: 'hidden' },
  tierCardDone:     { borderColor: palette.success, backgroundColor: palette.successLight },
  tierCardDisabled: { opacity: 0.55 },
  tierCardInner:    { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md },
  tierCardLeft:     { width: 32, alignItems: 'center', marginTop: 2 },
  tierTitleRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  tierCardTitle:    { ...typography.label, color: palette.textPrimary, flexShrink: 1 },
  tierReq:          { ...typography.bodySmall, color: palette.textPrimary, marginTop: 2 },
  tierCardDesc:     { ...typography.bodySmall, color: palette.textSecondary, marginTop: 1 },
  tierReason:       { ...typography.bodySmall, color: palette.danger, marginTop: spacing.xs },
  tierActionBtn:    { alignSelf: 'flex-start', marginTop: spacing.sm, borderRadius: r.sm },
  tierExpiry:       { ...typography.bodySmall, color: palette.textSecondary, marginTop: spacing.xs },
  tierLockedHint:   { ...typography.bodySmall, color: palette.textDisabled, marginTop: spacing.xs },

  stateChip:     { borderRadius: r.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  stateChipText: { ...typography.label, fontSize: 11 },

  // Tier 4 progress
  progressRows: { marginTop: spacing.sm, gap: spacing.xs },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  progressText: { ...typography.bodySmall, color: palette.textSecondary },

  // Gate banner
  statusCard:      { borderRadius: r.sm, borderWidth: 1, padding: spacing.md, marginBottom: spacing.md },
  statusHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusTitle:     { ...typography.label, fontSize: 15, flex: 1 },
  statusBody:      { ...typography.body, color: palette.textPrimary, marginTop: spacing.xs },
  gateActions:     { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  gateBtn:         { borderRadius: r.sm },
  gateBtnLabel:    { fontSize: 12 },

  // Capture header
  stepHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  backBtn:    { padding: spacing.xs, marginTop: 2, borderRadius: r.full },
  stepCount:  { ...typography.bodySmall, color: palette.textSecondary },
  stepTitle:  { ...typography.heading3, color: palette.textPrimary },

  // ID mode toggle
  modeToggle:       { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  modeOption:       { flex: 1, borderRadius: r.sm, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, overflow: 'hidden' },
  modeOptionActive: { borderColor: palette.primary, backgroundColor: palette.primaryLight },
  modeInner:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.sm },
  modeText:         { ...typography.label, fontSize: 13, color: palette.textSecondary },

  // PDF single-copy chip
  pdfChip:     { height: 120, borderRadius: r.sm, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.background, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  pdfChipText: { ...typography.label, fontSize: 13, color: palette.textPrimary },
  pdfClear:    { position: 'absolute', top: spacing.xs, right: spacing.xs, borderRadius: r.full },

  // Photo field
  photoLabel:         { ...typography.label, fontSize: 13, color: palette.textSecondary, marginBottom: spacing.xs },
  photoArea:          { gap: spacing.sm },
  photoPlaceholder:   { height: 170, borderRadius: r.sm, borderWidth: 2, borderStyle: 'dashed', borderColor: palette.border, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  photoPlaceholderText: { ...typography.bodySmall, color: palette.textSecondary },
  photoPreviewWrap:   { borderRadius: r.sm, overflow: 'hidden' },
  photoPreview:       { width: '100%', height: 190, borderRadius: r.sm },
  photoBtnRow:        { flexDirection: 'row', gap: spacing.sm },
  photoBtn:           { flex: 1, borderRadius: r.md },

  // Portfolio grid
  thumbGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap:    { width: '31%', aspectRatio: 1, borderRadius: r.sm, overflow: 'hidden' },
  thumb:        { width: '100%', height: '100%' },
  thumbRemove:  { position: 'absolute', top: 2, right: 2, backgroundColor: '#fff', borderRadius: r.full },
  thumbAdd:     { width: '31%', aspectRatio: 1, borderRadius: r.sm, borderWidth: 2, borderStyle: 'dashed', borderColor: palette.primary },
  thumbAddInner:{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  thumbAddText: { ...typography.bodySmall, fontSize: 11, color: palette.primary },
  countHint:    { ...typography.bodySmall, color: palette.textSecondary, marginTop: spacing.sm, marginBottom: spacing.md },

  // Inputs
  input:        { backgroundColor: '#FFFFFF' },
  inputOutline: { borderRadius: r.sm },

  // CTA
  cta:        { borderRadius: r.sm, marginTop: spacing.sm },
  ctaContent: { height: 54 },
});
