/**
 * A small, muted line under the units field showing dimensional problems with
 * this element. Units are advisory, so this never blocks editing.
 */

import { unitWarningsFor } from "./units";
import { useEditor } from "../state/store";

export function UnitWarnings({ element }: { element: string }) {
  const model = useEditor((s) => s.model);
  const warnings = unitWarningsFor(model, element);
  if (warnings.length === 0) return null;
  return (
    <div className="insp-unit-warning" role="status">
      {warnings.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
