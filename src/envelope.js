// The Amp envelope section: one amp envelope (attack, decay, sustain, release) for
// the whole instrument, exported on <groups> (docs: "Amplitude Envelope").
// Times are in seconds; sustain is a level from 0 to 1; curve shapes go from
// -100 (logarithmic) through 0 (linear) to 100 (exponential).
// Checks on the values happen in export.js (checkEnvelope).

import { addEnvelopeControls, removeEnvelopeControls } from './ui.js';

const FIELDS = [
  { key: 'attack', label: 'Attack', unit: 's', min: 0, step: 0.01 },
  { key: 'decay', label: 'Decay', unit: 's', min: 0, step: 0.01 },
  { key: 'sustain', label: 'Sustain', unit: '(0–1)', min: 0, max: 1, step: 0.01 },
  { key: 'release', label: 'Release', unit: 's', min: 0, step: 0.01 },
];

const CURVE_FIELDS = [
  { key: 'attackCurve', label: 'Attack', unit: '', min: -100, max: 100, step: 1 },
  { key: 'decayCurve', label: 'Decay', unit: '', min: -100, max: 100, step: 1 },
  { key: 'releaseCurve', label: 'Release', unit: '', min: -100, max: 100, step: 1 },
];

// `onChange` is called after any envelope value changes, so the XML preview
// and export checks can update.
export function renderEnvelopeEditor(container, project, onChange) {
  const envelope = project.envelope;

  const enabledLabel = document.createElement('label');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = envelope.enabled;
  enabledLabel.append(enabled, ' Set an envelope for the whole instrument');

  const makeField = ({ key, label, unit, min, max, step }) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'envelope-field';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    if (max !== undefined) input.max = max;
    input.step = step;
    input.className = 'envelope-input';
    input.value = envelope[key] ?? '';
    input.disabled = !envelope.enabled;
    // "input" fires on every keystroke, so the XML updates as you type.
    input.addEventListener('input', () => {
      envelope[key] = input.value === '' ? null : Number(input.value);
      onChange();
    });
    wrapper.append(`${label} `, input, unit ? ` ${unit}` : '');
    return { wrapper, input };
  };
  const timeFields = FIELDS.map(makeField);
  const curveFields = CURVE_FIELDS.map(makeField);
  const inputs = [...timeFields, ...curveFields];

  enabled.addEventListener('change', () => {
    envelope.enabled = enabled.checked;
    // Envelope controls only work with the envelope on, so they come and go with it.
    if (envelope.enabled) addEnvelopeControls(project);
    else removeEnvelopeControls(project);
    for (const { input } of inputs) input.disabled = !envelope.enabled;
    onChange();
  });

  const first = document.createElement('p');
  first.append(enabledLabel);
  const timeRow = document.createElement('p');
  timeRow.append(...timeFields.map(({ wrapper }) => wrapper));
  const curveRow = document.createElement('p');
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = '(−100 = log, 0 = linear, 100 = exp)';
  curveRow.append('Curves: ', ...curveFields.map(({ wrapper }) => wrapper), hint);
  container.replaceChildren(first, timeRow, curveRow);
}
