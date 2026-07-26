import { Fragment, type ReactNode } from 'react';

// Minimal, dependency-free markdown renderer for the legal scaffold. Supports the
// subset the documents use: paragraphs, blank-line separation, `- ` bullet lists,
// and inline **bold** / *italic*. Not a general markdown engine — the content
// source is controlled (the LegalDocumentSeeder), so this stays small and safe
// (plain text nodes only, no dangerouslySetInnerHTML).

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and *italic* while keeping delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  parts.forEach((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      nodes.push(<strong key={i} style={{ color: 'var(--text-primary)' }}>{part.slice(2, -2)}</strong>);
    } else if (/^\*[^*]+\*$/.test(part)) {
      nodes.push(<em key={i} style={{ color: 'var(--text-secondary)' }}>{part.slice(1, -1)}</em>);
    } else if (part) {
      nodes.push(<Fragment key={i}>{part}</Fragment>);
    }
  });
  return nodes;
}

export function Markdown({ children }: { children: string }) {
  const blocks = children.trim().split(/\n\s*\n/); // paragraphs on blank lines
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^\s*-\s+/.test(l));
        if (isList) {
          return (
            <ul key={bi} style={{ margin: '0 0 var(--space-sm)', paddingLeft: 20 }}>
              {lines.map((l, li) => (
                <li key={li} className="t-body" style={{ marginBottom: 4, lineHeight: 1.55 }}>
                  {renderInline(l.replace(/^\s*-\s+/, ''))}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="t-body" style={{ margin: '0 0 var(--space-sm)', lineHeight: 1.6 }}>
            {renderInline(block.replace(/\n/g, ' '))}
          </p>
        );
      })}
    </>
  );
}
