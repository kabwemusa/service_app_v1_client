// "DRAFT — pending legal review" banner, shown ONLY when the backend reports
// draft_mode (non-production). In production, with the documents published and
// draft_mode off, this never renders — so placeholder scaffold is never mistaken
// for approved legal text.
export function DraftBanner({ draftMode }: { draftMode: boolean }) {
  if (!draftMode) return null;
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 'var(--space-sm)',
        alignItems: 'flex-start',
        background: 'var(--warning-light)',
        border: '1px solid var(--warning)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-md)',
        marginBottom: 'var(--space-md)',
      }}
    >
      <span aria-hidden>🚧</span>
      <span className="t-small" style={{ color: 'var(--warning)', fontWeight: 600 }}>
        DRAFT — placeholder wording pending review by a qualified Zambian lawyer.
        Not final or legally binding.
      </span>
    </div>
  );
}
