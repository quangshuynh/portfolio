import React, { useMemo, useState } from 'react';
import { adjustmentSpec } from '../model/adjustments.mjs';
import { DAYLIGHT_KELVIN, multipliersToKelvinTint } from '../raw/rawColor.mjs';
import { RAW_FORMATS } from '../raw/rawFormat.mjs';
import { RAW_PROFILE_CHOICES, cameraCalibrationEv, dngBaselineEv, profileChoiceOf, rawProfileParams } from '../raw/rawProfiles.mjs';
import { suggestExposure } from '../raw/rawAutoExposure.mjs';
import { AdjustmentRow } from './AdjustmentRow';
import { formatShutter } from '../hdr/hdrMetadata.mjs';

const signed = (value) => (value > 0 ? `+${value}` : String(value));
const ev = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} EV`;
// Dismissed suggestions, per photo for this session (a dismissal is not an edit).
const dismissed = new WeakSet();

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
  'camera-natural@1': 'Camera Natural as it was in Interval 22, without camera calibration. Kept so those edits look unchanged.',
  linear: 'Linear sensor values with no tone curve: a neutral, technical starting point for precise editing.',
  legacy: 'The rendering of edits saved before profiles existed (linear, without BaselineExposure). Kept so those edits look unchanged.',
};

/**
 * Auto Exposure (raw/rawAutoExposure.mjs): a suggestion from the photo's own luminance, previewed,
 * applied or dismissed by the owner. An applied correction is stored apart from the Exposure slider.
 */
function AutoExposure({ raw, samples, adjustments, disabled, dispatch }) {
  const [previewing, setPreviewing] = useState(false);
  const [, setDismissals] = useState(0);
  const settings = adjustments.raw;
  const suggestion = useMemo(() => {
    if (!samples) return null;
    const { exposureEv, curve } = rawProfileParams(settings.profile, raw, settings.profileVersion);
    return suggestExposure(samples, { baseEv: exposureEv, curve, raw });
  }, [samples, raw, settings.profile, settings.profileVersion]);
  if (!suggestion) return null;
  const withAuto = (autoExposure) => ({ raw: { ...settings, autoExposure } });
  const applied = settings.autoExposure;
  if (applied !== null && !previewing) {
    return (
      <div className="pe-raw__auto" role="group" aria-label="Auto Exposure">
        <p className="pe-note" data-testid="raw-auto-exposure">Auto Exposure {ev(applied)} applied, added to the Exposure slider.</p>
        <button type="button" className="pe-text-button" disabled={disabled} onClick={() => dispatch({ type: 'applySettings', patch: withAuto(null) })}>Reset Auto Exposure</button>
      </div>
    );
  }
  if (suggestion.ev === null) return <p className="pe-note" data-testid="raw-auto-exposure">Auto Exposure: no suggestion. {suggestion.reason}</p>;
  if (dismissed.has(raw) && !previewing) return <p className="pe-note" data-testid="raw-auto-exposure">Auto Exposure: suggestion dismissed.</p>;
  const togglePreview = () => {
    dispatch({ type: 'previewSettings', patch: withAuto(previewing ? null : suggestion.ev) });
    setPreviewing(!previewing);
  };
  return (
    <div className="pe-raw__auto" role="group" aria-label="Auto Exposure">
      <p className="pe-note" data-testid="raw-auto-exposure">
        Auto Exposure suggests <strong>{ev(suggestion.ev)}</strong>{suggestion.limitedBy ? ` (limited by ${suggestion.limitedBy})` : ''}.
      </p>
      <div className="pe-raw__auto-actions">
        <button type="button" className="pe-text-button" aria-pressed={previewing} disabled={disabled} onClick={togglePreview}>Preview</button>
        <button type="button" className="pe-text-button" disabled={disabled} onClick={() => { setPreviewing(false); dispatch({ type: 'applySettings', patch: withAuto(suggestion.ev) }); }}>Apply</button>
        <button
          type="button"
          className="pe-text-button"
          disabled={disabled}
          onClick={() => {
            if (previewing) dispatch({ type: 'previewSettings', patch: withAuto(null) });
            setPreviewing(false);
            dismissed.add(raw);
            setDismissals((count) => count + 1);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * RAW development: camera details, the rendering profile (raw/rawProfiles.mjs) and the camera
 * white balance (as shot, daylight or a custom temperature and tint, applied to camera RGB
 * before the colour matrix). Exposure, tone and colour stay in the panels below and act on
 * the developed data; the profile never changes their values.
 */
export default function RawPanel({ raw, adjustments, disabled, dispatch, exposureSamples = null }) {
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
  const choice = profileChoiceOf(adjustments.raw.profile, adjustments.raw.profileVersion);
  // Superseded profiles are offered only to the edits that have them, so switching away can be undone.
  const choices = RAW_PROFILE_CHOICES.filter((entry) => !entry.superseded || entry === choice);
  const baseline = dngBaselineEv(raw);
  const calibration = choice.profile === 'camera-natural' && choice.version >= 2 ? cameraCalibrationEv(raw) : 0;
  const hdr = raw.hdrWhite > 1;
  const choose = (value) => {
    const next = RAW_PROFILE_CHOICES.find((entry) => entry.value === value);
    dispatch({ type: 'applySettings', patch: { raw: { ...adjustments.raw, profile: next.profile, profileVersion: next.version } } });
  };

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
        <select value={choice.value} disabled={disabled || hdr} onChange={(event) => choose(event.target.value)}>
          {choices.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="pe-note" data-testid="raw-profile-note">
        {hdr ? 'Merged HDR photos use their own tone controls.' : PROFILE_NOTES[choice.value]}
        {!hdr && choice.profile !== 'legacy' && baseline !== 0 && ` Includes the file's DNG BaselineExposure (${baseline > 0 ? '+' : ''}${baseline.toFixed(2)} EV).`}
        {!hdr && calibration !== 0 && ` Includes the measured calibration for the ${raw.model} (${calibration > 0 ? '+' : ''}${calibration.toFixed(2)} EV).`}
      </p>
      {!hdr && <AutoExposure raw={raw} samples={exposureSamples} adjustments={adjustments} disabled={disabled} dispatch={dispatch} />}
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
