import React from 'react';
import { adjustmentSpec } from '../model/adjustments.mjs';
import { DAYLIGHT_KELVIN, multipliersToKelvinTint } from '../raw/rawColor.mjs';
import { RAW_FORMATS } from '../raw/rawFormat.mjs';
import { LEGACY_RAW_PROFILE, RAW_PROFILES, dngBaselineEv } from '../raw/rawProfiles.mjs';
import { AdjustmentRow } from './AdjustmentRow';
import { formatShutter } from '../hdr/hdrMetadata.mjs';

const signed = (value) => (value > 0 ? `+${value}` : String(value));

/** Exposure line from whatever the file recorded, e.g. "1/250 s · f/8 · ISO 100 · 50 mm". */
export function exposureSummary(raw) {
  return [
    raw.shutter && formatShutter(raw.shutter),
    raw.aperture && `f/${Number(raw.aperture.toFixed(1))}`,
    raw.iso && `ISO ${Math.round(raw.iso)}`,
    raw.focalLength && `${Math.round(raw.focalLength)} mm`,
  ].filter(Boolean).join(' · ');
}

const PROFILE_NOTES = {
  'camera-natural': 'A natural starting point: a fixed rendering baseline and tone curve with highlight protection, the same for every camera. It does not imitate the camera\'s own JPEG.',
  linear: 'Linear sensor values with no tone curve: a neutral, technical starting point for precise editing.',
  legacy: 'The rendering of edits saved before profiles existed (linear, without BaselineExposure). Kept so those edits look unchanged.',
};

/**
 * RAW development: camera details, the rendering profile (raw/rawProfiles.mjs) and the camera
 * white balance (as shot, daylight or a custom temperature and tint, applied to camera RGB
 * before the colour matrix). Exposure, tone and colour stay in the panels below and act on
 * the developed data; the profile never changes their values.
 */
export default function RawPanel({ raw, adjustments, disabled, dispatch }) {
  const asShot = multipliersToKelvinTint(raw.asShot, raw.camXyz);
  const mode = adjustments.raw.whiteBalance;
  const setMode = (whiteBalance) => {
    // Custom starts from what was shown, so switching does not jump.
    const start = whiteBalance === 'custom' && mode !== 'custom'
      ? (mode === 'daylight' ? { rawTemperature: DAYLIGHT_KELVIN, rawTint: 0 } : { rawTemperature: asShot.temperature, rawTint: asShot.tint })
      : {};
    const reset = whiteBalance === 'custom' ? {} : { rawTemperature: DAYLIGHT_KELVIN, rawTint: 0 };
    dispatch({ type: 'applySettings', patch: { raw: { ...adjustments.raw, whiteBalance }, ...reset, ...start } });
  };
  const exposure = exposureSummary(raw);
  const { profile } = adjustments.raw;
  // Legacy is offered only to the edits that have it, so switching away can be undone or reselected.
  const profiles = RAW_PROFILES.filter(({ id }) => id !== LEGACY_RAW_PROFILE || profile === LEGACY_RAW_PROFILE);
  const baseline = dngBaselineEv(raw);

  return (
    <div className="pe-raw">
      <dl className="pe-raw__meta">
        <div><dt>Camera</dt><dd>{[raw.make, raw.model].filter(Boolean).join(' ') || 'Unknown'}</dd></div>
        {raw.lens && <div><dt>Lens</dt><dd>{raw.lens}</dd></div>}
        {exposure && <div><dt>Exposure</dt><dd className="mono">{exposure}</dd></div>}
        <div><dt>RAW</dt><dd className="mono">{RAW_FORMATS[raw.format]?.label ?? 'RAW'} · {raw.width}×{raw.height}</dd></div>
      </dl>
      <label className="pe-field">
        <span>Profile</span>
        <select value={profile} disabled={disabled || raw.hdrWhite > 1} onChange={(event) => dispatch({ type: 'applySettings', patch: { raw: { ...adjustments.raw, profile: event.target.value } } })}>
          {profiles.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <p className="pe-note" data-testid="raw-profile-note">
        {raw.hdrWhite > 1 ? 'Merged HDR photos use their own tone controls.' : PROFILE_NOTES[profile]}
        {profile !== LEGACY_RAW_PROFILE && baseline !== 0 && ` Includes the file's DNG BaselineExposure (${baseline > 0 ? '+' : ''}${baseline.toFixed(2)} EV).`}
      </p>
      <label className="pe-field">
        <span>White balance</span>
        <select value={mode} disabled={disabled} onChange={(event) => setMode(event.target.value)}>
          <option value="as-shot">{raw.asShotAvailable ? `As shot (${asShot.temperature} K, ${signed(asShot.tint)})` : 'As shot (not recorded: daylight)'}</option>
          <option value="daylight">Daylight ({DAYLIGHT_KELVIN} K)</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {mode === 'custom' && ['rawTemperature', 'rawTint'].map((key) => (
        <AdjustmentRow key={key} spec={adjustmentSpec(key)} value={adjustments[key]} disabled={disabled} dispatch={dispatch} label={key === 'rawTemperature' ? 'Temperature' : 'Tint'} />
      ))}
      <p className="pe-note">
        Developed from the sensor data with LibRaw and the camera&apos;s colour matrix. Exposure acts on linear sensor values before the profile; when raised, bright tones roll off to white instead of clipping.
      </p>
    </div>
  );
}
