/**
 * SourceSink — shared parameter-row editor for the three Analyze tabs.
 *
 * Rows are controlled by the panel, so the same parameters feed calibration,
 * sensitivity and the uncertainty ensemble. Bounds stay as text while editing.
 */

import { Plus, X } from "lucide-react";

import type { Model } from "@sourcesink/model";

import {
  addParameterRow,
  numericEquation,
  parameterOptions,
  parameterRowFor,
  type ParameterRow,
} from "./helpers.js";

export interface ParameterRowsProps {
  model: Model;
  rows: ParameterRow[];
  errors: Array<string | null>;
  disabled?: boolean;
  onChange(rows: ParameterRow[]): void;
}

const KIND_LABEL: Record<string, string> = {
  stock: "stock",
  flow: "flow",
  converter: "converter",
};

export function ParameterRows({ model, rows, errors, disabled, onChange }: ParameterRowsProps) {
  const options = parameterOptions(model);

  const patch = (index: number, next: Partial<ParameterRow>): void => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...next } : row)));
  };

  return (
    <div className="ana-params">
      {rows.length === 0 ? (
        <p className="ana-muted">
          {options.length === 0
            ? "This model has no stocks, flows or converters to vary."
            : "Add a parameter to vary or fit."}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="ana-param-head" aria-hidden="true">
          <span>Element</span>
          <span>Min</span>
          <span>Max</span>
          <span>Log</span>
          <span />
        </div>
      ) : null}

      {rows.map((row, index) => {
        const known = options.some((o) => o.name === row.name);
        return (
          <div className="ana-param" key={`${row.name}-${index}`}>
            <div className="ana-param-main">
              <select
                className="ana-select"
                aria-label={`Parameter ${index + 1} element`}
                value={row.name}
                disabled={disabled}
                onChange={(event) => onChange(
                  rows.map((r, i) => (i === index ? parameterRowFor(model, event.target.value) : r)),
                )}
              >
                {!known && row.name ? <option value={row.name}>{row.name} (missing)</option> : null}
                {options.map((option) => (
                  <option key={option.name} value={option.name}>
                    {option.name} · {KIND_LABEL[option.kind]}
                    {numericEquation(option.equation) === undefined ? " (computed)" : ""}
                  </option>
                ))}
              </select>
              <input
                className="ana-input"
                aria-label={`Parameter ${index + 1} minimum`}
                inputMode="decimal"
                value={row.min}
                disabled={disabled}
                onChange={(event) => patch(index, { min: event.target.value })}
              />
              <input
                className="ana-input"
                aria-label={`Parameter ${index + 1} maximum`}
                inputMode="decimal"
                value={row.max}
                disabled={disabled}
                onChange={(event) => patch(index, { max: event.target.value })}
              />
              <label className="ana-check" title="Sample/search log-uniformly">
                <input
                  type="checkbox"
                  checked={row.log}
                  disabled={disabled}
                  onChange={(event) => patch(index, { log: event.target.checked })}
                />
                <span>log</span>
              </label>
              <button
                type="button"
                className="ana-iconbtn"
                title="Remove parameter"
                aria-label={`Remove parameter ${row.name}`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
            </div>
            {errors[index] ? <div className="ana-row-error">{errors[index]}</div> : null}
          </div>
        );
      })}

      <button
        type="button"
        className="ana-btn ana-btn-add"
        disabled={disabled || options.length === 0}
        onClick={() => onChange(addParameterRow(model, rows))}
      >
        <Plus size={13} aria-hidden />
        Add parameter
      </button>
    </div>
  );
}
