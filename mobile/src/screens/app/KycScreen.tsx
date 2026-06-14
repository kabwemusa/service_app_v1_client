import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Chip, HelperText, ProgressBar, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DocType, KycDocument } from '../../api/kyc';
import { useSnackbar } from '../../providers/SnackbarProvider';
import { useKycStore } from '../../store/kycStore';
import { palette, radius as r, shadow, spacing, typography } from '../../theme';

// ── Types ──────────────────────────────────────────────────────────────────

type Step = 'overview' | 'tier1_name' | 'tier1_selfie' | 'tier2_doctype' | 'tier2_doc' | 'tier2_selfie' | 'done';

const DOC_TYPES: { value: DocType; label: string; icon: string }[] = [
  { value: 'NRC',             label: 'National Registration Card', icon: 'card-account-details-outline' },
  { value: 'PASSPORT',        label: 'Passport',                   icon: 'passport'                    },
  { value: 'DRIVERS_LICENSE', label: "Driver's License",           icon: 'car-outline'                 },
];

const TIER_LABELS = ['Unverified', 'Basic', 'Identified', 'Verified', 'Professional'];

const DOC_LABEL: Record<string, string> = {
  NRC: 'National Registration Card',
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: "Driver's License",
  PROOF_OF_ADDRESS: 'Proof of address',
  CERTIFICATE: 'Certificate',
  SELFIE: 'Selfie',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function KycScreen({ navigation }: any) {
  const { status, loading, error, fetchStatus, submitTier1, submitDocument, clearError } = useKycStore();
  const { showSuccess, showError } = useSnackbar();

  const [step, setStep]           = useState<Step>('overview');
  const [legalName, setLegalName] = useState('');
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [docType, setDocType]     = useState<DocType>('NRC');
  const [docUri, setDocUri]       = useState<string | null>(null);
  const [doc2SelfieUri, setDoc2SelfieUri] = useState<string | null>(null);

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  const currentTier = status?.trust_tier ?? 0;

  // Newest submission the provider should be aware of: needs-info, pending, or
  // not-approved. (documents come newest-first from the API.)
  const documents = status?.documents ?? [];
  const attention = documents.find((d) =>
    d.info_requested ||
    ['SUBMITTED', 'MANUAL_REVIEW', 'AUTO_REJECTED', 'REJECTED', 'EXPIRED'].includes(d.status),
  );

  const resubmitFor = (doc: KycDocument) => {
    if (doc.doc_type === 'PROOF_OF_ADDRESS') {
      navigation.navigate('KycAddress');
    } else {
      setDocUri(null);
      setDoc2SelfieUri(null);
      setStep('tier2_doctype');
    }
  };

  const renderReviewStatus = () => {
    if (!attention) return null;
    const label = DOC_LABEL[attention.doc_type] ?? 'Document';
    const rejected = ['AUTO_REJECTED', 'REJECTED', 'EXPIRED'].includes(attention.status);

    const cfg = attention.info_requested
      ? {
          icon: 'alert-circle-outline' as const,
          color: palette.warning,
          bg: palette.warningLight,
          title: 'More information needed',
          body: attention.review_note ||
            'The reviewer needs additional details before they can verify this submission.',
          action: 'Resubmit document',
        }
      : rejected
        ? {
            icon: 'close-circle-outline' as const,
            color: palette.danger,
            bg: palette.dangerLight,
            title: 'Submission not approved',
            body: attention.review_note ||
              'Your document could not be verified. Please check it and submit again.',
            action: 'Resubmit document',
          }
        : {
            icon: 'clock-outline' as const,
            color: palette.primary,
            bg: palette.primaryLight,
            title: 'Pending review',
            body: "We're reviewing your documents. This usually takes up to 24 hours — we'll notify you once it's done.",
            action: null as string | null,
          };

    return (
      <View style={[styles.statusCard, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
        <View style={styles.statusHeaderRow}>
          <MaterialCommunityIcons name={cfg.icon} size={22} color={cfg.color} />
          <Text style={[styles.statusTitle, { color: cfg.color }]}>{cfg.title}</Text>
        </View>
        <Text style={styles.statusDocLabel}>{label}</Text>
        <Text style={styles.statusBody}>{cfg.body}</Text>
        {cfg.action && (
          <Button
            mode="contained"
            buttonColor={cfg.color}
            onPress={() => resubmitFor(attention)}
            style={styles.statusBtn}
            compact
          >
            {cfg.action}
          </Button>
        )}
      </View>
    );
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const pickImage = async (setter: (uri: string) => void) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showError('Camera roll access is required to upload documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      // iPhone photos are HEIC by default; the backend (and admin reviewer's
      // <img> preview) only handle jpg/png/webp. "Compatible" makes iOS hand
      // back the transcoded JPEG representation instead of the raw HEIC.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled && result.assets[0]) {
      setter(result.assets[0].uri);
    }
  };

  const takePhoto = async (setter: (uri: string) => void) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showError('Camera access is required to take a selfie.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      cameraType: ImagePicker.CameraType.front,
    });
    if (!result.canceled && result.assets[0]) {
      setter(result.assets[0].uri);
    }
  };

  // ── Submit handlers ──────────────────────────────────────────────────────

  const handleSubmitTier1 = async () => {
    if (!selfieUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await submitTier1(legalName.trim(), selfieUri);
    if (ok) {
      showSuccess('Tier 1 approved! You can now list services.');
      setStep('done');
    }
  };

  const handleSubmitTier2 = async () => {
    if (!docUri || !doc2SelfieUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await submitDocument(docType, docUri, doc2SelfieUri);
    if (ok) {
      showSuccess('Document submitted. We\'ll notify you once verified.');
      setStep('done');
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderTierBadge = (tier: number) => {
    const colors = [palette.textDisabled, palette.warning, palette.primary, palette.success, palette.secondary];
    return (
      <View style={[styles.tierBadge, { borderColor: colors[tier] }]}>
        <Text style={[styles.tierLabel, { color: colors[tier] }]}>{TIER_LABELS[tier]}</Text>
      </View>
    );
  };

  const renderPhotoButton = (uri: string | null, label: string, onCamera: () => void, onGallery: () => void) => (
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
        <Button mode="outlined" onPress={onCamera} icon="camera" style={styles.photoBtn} compact>
          Camera
        </Button>
        <Button mode="outlined" onPress={onGallery} icon="image" style={styles.photoBtn} compact>
          Gallery
        </Button>
      </View>
    </View>
  );

  // ── Screens ───────────────────────────────────────────────────────────────

  if (loading && !status) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Overview
  if (step === 'overview') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchStatus} tintColor={palette.primary} />
          }
        >
          <Text style={styles.heading}>Identity Verification</Text>
          <Text style={styles.sub}>
            Verify your identity to unlock earning on Sebenza. Higher tiers unlock larger bookings and better placement in search.
          </Text>

          <View style={styles.card}>
            <View style={styles.tierRow}>
              <Text style={styles.sectionLabel}>Current tier</Text>
              {renderTierBadge(currentTier)}
            </View>
            <ProgressBar
              progress={currentTier / 4}
              color={palette.primary}
              style={styles.tierBar}
            />
          </View>

          {/* Latest review status — pending / needs-info / not approved */}
          {renderReviewStatus()}

          {/* Tier 1 */}
          <TierCard
            tier={1}
            title="Basic — Start earning"
            description="Selfie + legal name. Unlocks listing services up to ZMW 300."
            complete={currentTier >= 1}
            onPress={() => currentTier < 1 ? setStep('tier1_name') : undefined}
            actionLabel={currentTier >= 1 ? 'Completed' : 'Start'}
          />

          {/* Tier 2 */}
          <TierCard
            tier={2}
            title="Identified — Earn more"
            description="Government ID + selfie. Unlocks bookings up to ZMW 2,000."
            complete={currentTier >= 2}
            disabled={currentTier < 1}
            onPress={() => currentTier === 1 ? setStep('tier2_doctype') : undefined}
            actionLabel={currentTier >= 2 ? 'Completed' : currentTier < 1 ? 'Complete Tier 1 first' : 'Verify'}
          />

          {/* Tier 3 */}
          <TierCard
            tier={3}
            title="Verified — Unlock full platform"
            description="Proof of address. Removes weekly caps, adds Verified badge."
            complete={currentTier >= 3}
            disabled={currentTier < 2}
            onPress={() => currentTier === 2 ? navigation.navigate('KycAddress') : undefined}
            actionLabel={currentTier >= 3 ? 'Completed' : currentTier < 2 ? 'Complete Tier 2 first' : 'Submit'}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Done
  if (step === 'done') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <MaterialCommunityIcons name="check-circle-outline" size={72} color={palette.success} />
          <Text style={[styles.heading, { marginTop: spacing.md }]}>Submitted!</Text>
          <Text style={[styles.sub, { textAlign: 'center' }]}>
            We'll notify you once your documents are reviewed.
          </Text>
          <Button mode="contained" onPress={() => { setStep('overview'); fetchStatus(); }} style={{ marginTop: spacing.lg }}>
            Back to overview
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // ── Tier 1: legal name ────────────────────────────────────────────────────
  if (step === 'tier1_name') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <StepHeader step={1} total={2} title="Your legal name" onBack={() => setStep('overview')} />
          <Text style={styles.sub}>Enter your name exactly as it appears on your ID.</Text>
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
          <Button
            mode="contained"
            disabled={legalName.trim().length < 2}
            onPress={() => setStep('tier1_selfie')}
            style={styles.cta}
            contentStyle={styles.ctaContent}
          >
            Continue
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Tier 1: selfie ────────────────────────────────────────────────────────
  if (step === 'tier1_selfie') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <StepHeader step={2} total={2} title="Take a selfie" onBack={() => setStep('tier1_name')} />
          <Text style={styles.sub}>Look directly at the camera in good lighting.</Text>
          <View style={styles.card}>
            {renderPhotoButton(
              selfieUri,
              'Your selfie',
              () => takePhoto(setSelfieUri),
              () => pickImage(setSelfieUri),
            )}
          </View>
          <Button
            mode="contained"
            disabled={!selfieUri || loading}
            loading={loading}
            onPress={handleSubmitTier1}
            style={styles.cta}
            contentStyle={styles.ctaContent}
          >
            Submit for Tier 1
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Tier 2: doc type ──────────────────────────────────────────────────────
  if (step === 'tier2_doctype') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <StepHeader step={1} total={3} title="Choose document type" onBack={() => setStep('overview')} />
          <View style={styles.card}>
            {DOC_TYPES.map((dt) => (
              <TouchableRipple
                key={dt.value}
                onPress={() => { setDocType(dt.value); Haptics.selectionAsync(); }}
                style={[styles.docTypeRow, docType === dt.value && styles.docTypeRowActive]}
              >
                <View style={styles.docTypeInner}>
                  <MaterialCommunityIcons
                    name={dt.icon as any}
                    size={24}
                    color={docType === dt.value ? palette.primary : palette.textSecondary}
                  />
                  <Text style={[styles.docTypeLabel, docType === dt.value && { color: palette.primary }]}>
                    {dt.label}
                  </Text>
                  {docType === dt.value && (
                    <MaterialCommunityIcons name="check-circle" size={20} color={palette.primary} />
                  )}
                </View>
              </TouchableRipple>
            ))}
          </View>
          <Button mode="contained" onPress={() => setStep('tier2_doc')} style={styles.cta} contentStyle={styles.ctaContent}>
            Continue
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Tier 2: document image ────────────────────────────────────────────────
  if (step === 'tier2_doc') {
    const selected = DOC_TYPES.find((d) => d.value === docType)!;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <StepHeader step={2} total={3} title={`Upload your ${selected.label}`} onBack={() => setStep('tier2_doctype')} />
          <Text style={styles.sub}>Make sure all text is clearly visible. No glare or shadows.</Text>
          <View style={styles.card}>
            {renderPhotoButton(
              docUri,
              `${selected.label} photo`,
              () => takePhoto(setDocUri),
              () => pickImage(setDocUri),
            )}
          </View>
          <Button
            mode="contained"
            disabled={!docUri}
            onPress={() => setStep('tier2_selfie')}
            style={styles.cta}
            contentStyle={styles.ctaContent}
          >
            Continue
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Tier 2: live selfie ───────────────────────────────────────────────────
  if (step === 'tier2_selfie') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <StepHeader step={3} total={3} title="Take a live selfie" onBack={() => setStep('tier2_doc')} />
          <Text style={styles.sub}>This is used to match your face with the document.</Text>
          <View style={styles.card}>
            {renderPhotoButton(
              doc2SelfieUri,
              'Live selfie',
              () => takePhoto(setDoc2SelfieUri),
              () => pickImage(setDoc2SelfieUri),
            )}
          </View>
          <Button
            mode="contained"
            disabled={!doc2SelfieUri || loading}
            loading={loading}
            onPress={handleSubmitTier2}
            style={styles.cta}
            contentStyle={styles.ctaContent}
          >
            Submit for verification
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StepHeader({ step, total, title, onBack }: { step: number; total: number; title: string; onBack: () => void }) {
  return (
    <View style={styles.stepHeader}>
      <TouchableRipple onPress={onBack} borderless style={styles.backBtn}>
        <MaterialCommunityIcons name="arrow-left" size={24} color={palette.textPrimary} />
      </TouchableRipple>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepCount}>Step {step} of {total}</Text>
        <Text style={styles.stepTitle}>{title}</Text>
        <ProgressBar progress={step / total} color={palette.primary} style={styles.stepBar} />
      </View>
    </View>
  );
}

function TierCard({ tier, title, description, complete, disabled, onPress, actionLabel }: {
  tier: number; title: string; description: string;
  complete: boolean; disabled?: boolean; onPress?: () => void; actionLabel: string;
}) {
  return (
    <TouchableRipple
      onPress={!complete && !disabled ? onPress : undefined}
      style={[styles.tierCard, complete && styles.tierCardDone, disabled && styles.tierCardDisabled]}
      borderless
    >
      <View style={styles.tierCardInner}>
        <View style={styles.tierCardLeft}>
          <MaterialCommunityIcons
            name={complete ? 'check-circle' : 'shield-outline'}
            size={28}
            color={complete ? palette.success : disabled ? palette.textDisabled : palette.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tierCardTitle, disabled && { color: palette.textDisabled }]}>{title}</Text>
          <Text style={styles.tierCardDesc}>{description}</Text>
        </View>
        {!complete && (
          <Chip
            compact
            mode="flat"
            style={[styles.tierChip, disabled && styles.tierChipDisabled]}
            textStyle={{ fontSize: 11 }}
          >
            {actionLabel}
          </Chip>
        )}
      </View>
    </TouchableRipple>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: palette.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  heading: { ...typography.heading2, color: palette.textPrimary, marginBottom: spacing.xs },
  sub:     { ...typography.body, color: palette.textSecondary, marginBottom: spacing.md },
  sectionLabel: { ...typography.label, color: palette.textSecondary },

  card: {
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },

  // Tier overview
  tierRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  tierBar:  { height: 6, borderRadius: 3 },
  tierBadge: { borderWidth: 1.5, borderRadius: r.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  tierLabel: { ...typography.label, fontSize: 12 },

  tierCard: {
    backgroundColor: palette.surface,
    borderRadius: r.xl,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    ...shadow.card,
  },
  tierCardDone:     { borderColor: palette.success, backgroundColor: '#F0FFF4' },
  tierCardDisabled: { opacity: 0.5 },
  tierCardInner:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  tierCardLeft:     { width: 36, alignItems: 'center' },
  tierCardTitle:    { ...typography.label, color: palette.textPrimary, marginBottom: 2 },
  tierCardDesc:     { ...typography.bodySmall, color: palette.textSecondary },
  tierChip:         { backgroundColor: palette.primaryLight, alignSelf: 'flex-start' },
  tierChipDisabled: { backgroundColor: palette.border },

  // Step header
  stepHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  backBtn:    { padding: spacing.xs, marginTop: 2, borderRadius: r.full },
  stepCount:  { ...typography.bodySmall, color: palette.textSecondary },
  stepTitle:  { ...typography.heading3, color: palette.textPrimary, marginBottom: spacing.xs },
  stepBar:    { height: 4, borderRadius: 2 },

  // Photo upload
  photoArea:          { gap: spacing.sm },
  photoPlaceholder:   {
    height: 180, borderRadius: r.lg, borderWidth: 2, borderStyle: 'dashed',
    borderColor: palette.border, alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
  },
  photoPlaceholderText: { ...typography.bodySmall, color: palette.textSecondary },
  photoPreviewWrap:     { borderRadius: r.lg, overflow: 'hidden' },
  photoPreview:         { width: '100%', height: 200, borderRadius: r.lg },
  photoBtnRow:          { flexDirection: 'row', gap: spacing.sm },
  photoBtn:             { flex: 1, borderRadius: r.md },

  // Doc type
  docTypeRow:       { flexDirection: 'row', borderRadius: r.md, marginBottom: spacing.xs, overflow: 'hidden' },
  docTypeRowActive: { backgroundColor: palette.primaryLight },
  docTypeInner:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  docTypeLabel:     { ...typography.body, flex: 1, color: palette.textSecondary },

  // Input
  input:       { backgroundColor: '#FFFFFF' },
  inputOutline:{ borderRadius: r.lg },

  // CTA
  cta:        { borderRadius: r.lg, marginTop: spacing.sm },
  ctaContent: { height: 54 },

  // Review status banner
  statusCard: {
    borderRadius: r.xl,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statusHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusTitle:     { ...typography.label, fontSize: 15 },
  statusDocLabel:  { ...typography.bodySmall, color: palette.textSecondary, marginTop: 2 },
  statusBody:      { ...typography.body, color: palette.textPrimary, marginTop: spacing.xs },
  statusBtn:       { borderRadius: r.md, marginTop: spacing.md, alignSelf: 'flex-start' },
});
