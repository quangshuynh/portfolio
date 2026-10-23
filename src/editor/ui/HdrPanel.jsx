import React from 'react';
import { adjustmentSpec } from '../model/adjustments.mjs';
import { ROLE_LABELS } from '../hdr/hdrMetadata.mjs';
import { HDR_MODES } from '../hdr/hdrSource.mjs';
import { AdjustmentRow } from './AdjustmentRow';

/** Tone-mapping looks: values of the HDR controls only (one undo step each). */
export const HDR_LOOKS = Object.freeze([
  { id: 'natural', label: 'Natural', patch: { hdrHighlights: 50, hdrShadows: 0 } },
  { id: 'strong', label: 'Stronger', patch: { hdrHighlights: 85, hdrShadows: 45 } },
]);

const ALIGNMENT = { aligned: 'aligned', uncertain: 'uncertain alignment', failed: 'alignment failed, not aligned', flat: 'too little detail, not aligned', off: 'not aligned (off)', reference: 'reference' };
const percent = (value) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

/**
 * A merged photo: how it was made (inputs, measured exposure, alignment and ghost
 * results, warnings) and, for a RAW merge, its tone mapping. The merge itself is fixed;
 * these controls only change how its scene values are rendered.
 */
export default function HdrPanel({ hdr, adjustments, disabled, dispatch }) {
  const { mode, inputs, summary } = hdr;
  const radiance = mode === 'radiance';
  return (
    <div className="pe-hdr">
      <p className="pe-note"><strong>{HDR_MODES[mode].label}</strong>{radiance ? ' of three RAW exposures. Scene values above white are kept; the controls below compress them into the photo.' : ' of processed images: no scene brightness is reconstructed. Edit it like any photo.'}</p>
      <dl className="pe-raw__meta">
        {inputs.map((input, index) => (
          <div key={input.role}>
            <dt>{ROLE_LABELS[input.role]}</dt>
            <dd className="mono" title={input.name}>
              {input.name}
              {radiance && summary.measuredStops[index] !== null && input.role !== 'normal' ? ` · ${summary.measuredStops[index] > 0 ? '+' : ''}${summary.measuredStops[index].toFixed(2)} EV` : ''}
            </dd>
          </div>
        ))}
        {summary.alignment.map((entry, index) => (entry.status === 'reference' ? null : (
          <div key={`align-${inputs[index].role}`}>
            <dt>Alignment</dt>
            <dd className="mono">{ROLE_LABELS[inputs[index].role]}: {ALIGNMENT[entry.status]}{entry.after !== null && entry.before !== null ? `, edge mismatch ${percent(entry.before)} → ${percent(entry.after)}` : ''}</dd>
          </div>
        )))}
        <div><dt>Moving areas</dt><dd className="mono">{hdr.settings.deghost ? `${percent(summary.ghostFraction)} from the reference only` : 'not detected (off)'}</dd></div>
      </dl>
      {summary.warnings.map((text) => <p key={text} className="pe-note pe-note--warning">{text}</p>)}
      {radiance && (
        <>
          <div className="pe-segmented pe-hdr__looks" role="group" aria-label="Tone mapping look">
            {HDR_LOOKS.map((look) => {
              const active = Object.entries(look.patch).every(([key, value]) => adjustments[key] === value);
              return <button key={look.id} type="button" aria-pressed={active} disabled={disabled} onClick={() => dispatch({ type: 'applySettings', patch: look.patch })}>{look.label}</button>;
            })}
          </div>
          {['hdrHighlights', 'hdrShadows'].map((key) => (
            <AdjustmentRow key={key} spec={adjustmentSpec(key)} value={adjustments[key]} disabled={disabled} dispatch={dispatch} />
          ))}
          <p className="pe-note">Exposure, white balance and every other control act on the merged scene values; Original shows the merge with these defaults.</p>
        </>
      )}
    </div>
  );
}
