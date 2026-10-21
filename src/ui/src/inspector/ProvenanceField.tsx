/**
 * SourceSink — read-only provenance of one element.
 *
 * Shows who authored an element and the sources behind it. Human-authored
 * elements without sources have nothing to report and render nothing.
 */

import type { Provenance } from "@sourcesink/model";

import "./inspector.css";

/** A clickable URL for a source: plain http(s) URLs, or a DOI (bare or with
 * a `doi:` prefix) resolved through doi.org. Anything else is plain text. */
export function sourceHref(source: string): string | null {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return s;
  const doi = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(s);
  return doi ? `https://doi.org/${doi[1]}` : null;
}

/** The one-line author summary shown above the source links. */
export function provenanceSummary(p: Provenance): string {
  if (p.author === "import") return "Imported from a legacy model";
  if (p.author === "ai") {
    const details: string[] = [];
    if (p.agent) details.push(p.agent);
    if (p.confidence !== undefined) details.push(`confidence ${Math.round(p.confidence * 100)}%`);
    return details.length > 0 ? `Proposed by AI (${details.join(", ")})` : "Proposed by AI";
  }
  return "Human-authored";
}

export function ProvenanceField({ provenance }: { provenance?: Provenance }) {
  if (!provenance) return null;
  const sources = provenance.sources ?? [];
  // A human author with no sources carries no audit information.
  if (provenance.author === "human" && sources.length === 0) return null;

  return (
    <div className="insp-field">
      <div className="insp-label">Provenance</div>
      <span className="insp-muted">{provenanceSummary(provenance)}</span>
      {sources.length > 0 ? (
        <ul className="insp-list">
          {sources.map((source, index) => {
            const href = sourceHref(source);
            return (
              <li key={`${source}-${index}`}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer noopener">
                    {source}
                  </a>
                ) : (
                  source
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
