import { useMemo, useState } from 'react';
import type { LegalDocument } from '../../api/legal';
import { inputStyle } from '../../components/ui/ui';
import { DraftBanner } from './DraftBanner';
import { Markdown } from './Markdown';

// Renders one versioned legal document: header, DRAFT banner, optional in-document
// search, and anchored sections. Shared by the standalone page and the gate.
export function LegalDocumentView({ doc, searchable = true }: { doc: LegalDocument; searchable?: boolean }) {
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return doc.content.sections;
    return doc.content.sections.filter(
      (s) => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
    );
  }, [doc, query]);

  const effective = doc.effective_date ? `Effective ${doc.effective_date}` : 'Effective date set on publication';

  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 4 }}>{doc.title}</h2>
      <p className="t-small t-muted" style={{ marginBottom: 'var(--space-md)' }}>
        Version {doc.version} · {effective}
        {doc.last_updated ? ` · Updated ${doc.last_updated}` : ''}
      </p>

      <DraftBanner draftMode={doc.draft_mode} />

      {doc.content.intro && <Markdown>{doc.content.intro}</Markdown>}

      {searchable && doc.content.sections.length > 4 && (
        <input
          type="search"
          placeholder="Search this document"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ ...inputStyle, margin: 'var(--space-md) 0' }}
          aria-label="Search this document"
        />
      )}

      {sections.length === 0 ? (
        <p className="t-small t-muted">No sections match “{query}”.</p>
      ) : (
        sections.map((s) => (
          // id = section anchor for deep-linking / table of contents.
          <section key={s.id} id={s.id} style={{ marginBottom: 'var(--space-lg)', paddingBottom: 'var(--space-md)', borderBottom: '1px solid var(--border)' }}>
            <h3 className="t-h3" style={{ marginBottom: 6 }}>{s.title}</h3>
            <Markdown>{s.body}</Markdown>
          </section>
        ))
      )}
    </div>
  );
}
