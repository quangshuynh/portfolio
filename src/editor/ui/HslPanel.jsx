import React, { useState } from 'react';
import { HSL_PROPERTIES, HSL_RANGES, adjustmentSpec, hslKey } from '../model/adjustments.mjs';
import { AdjustmentRow } from './AdjustmentRow';

/**
 * HSL: pick one of eight colour ranges, then adjust its hue, saturation and
 * luminance. Swatches show which ranges are edited; each range resets on its own.
 */
export default function HslPanel({ adjustments, disabled, dispatch }) {
  const [rangeId, setRangeId] = useState('red');
  const range = HSL_RANGES.find(({ id }) => id === rangeId);
  const keys = (id) => HSL_PROPERTIES.map((property) => hslKey(id, property.id));
  const edited = (id) => keys(id).some((key) => adjustments[key] !== 0);
  const resetRange = () => dispatch({ type: 'applySettings', patch: Object.fromEntries(keys(rangeId).map((key) => [key, 0])) });

  return (
    <div className="pe-hsl">
      <div className="pe-hsl__ranges" role="group" aria-label="Colour range">
        {HSL_RANGES.map(({ id, label, swatch }) => (
          <button
            key={id}
            type="button"
            className="pe-hsl__swatch"
            style={{ '--swatch': swatch }}
            aria-pressed={id === rangeId}
            aria-label={`${label}${edited(id) ? ' (edited)' : ''}`}
            title={label}
            data-edited={edited(id) || undefined}
            onClick={() => setRangeId(id)}
          />
        ))}
      </div>
      <div className="pe-hsl__head">
        <span className="pe-hsl__name">{range.label}</span>
        <button type="button" className="pe-text-button" disabled={disabled || !edited(rangeId)} onClick={resetRange}>Reset {range.label.toLowerCase()}</button>
      </div>
      {HSL_PROPERTIES.map((property) => {
        const spec = adjustmentSpec(hslKey(rangeId, property.id));
        return <AdjustmentRow key={spec.key} spec={spec} label={property.label} value={adjustments[spec.key]} disabled={disabled} dispatch={dispatch} />;
      })}
    </div>
  );
}
