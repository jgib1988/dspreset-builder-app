// The Mix layers section: which sample names play together on the same keys,
// each as its own layer (e.g. close and room mics), and each layer's starting
// volume, pan, tuning and envelope. Each mix layer is mapped on its own and
// exported in its own groups with tags="mixN"; its Mixer knob sets the tag's
// volume (docs: TAG_VOLUME). Pan, tuning and envelope go on those groups
// (docs: groupPan, groupTuning, attack… on <group>; tested in the plugin).
// Checks on the values happen in export.js (checkPreset).

import { isExportable, mixLayerLabel, mixLayerSettings, mixLayerVolume, remapName, usedMixLayers } from './mapping.js';
import { updateMixerControls } from './ui.js';

// `onMappingChange` is called after a mix layer changes (its zones move, so
// the grid needs redrawing); `onChange` after a volume is typed.
export function renderMixLayerEditor(container, project, onMappingChange, onChange) {
  const rerender = () => renderMixLayerEditor(container, project, onMappingChange, onChange);
  const names = [...new Set(project.samples.filter(isExportable).map((s) => s.name))].sort();

  // One dropdown per name: none, or mix layer 1 up to one per name.
  const list = document.createElement('p');
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const select = document.createElement('select');
    for (let mixLayer = 0; mixLayer <= names.length; mixLayer++) {
      const option = document.createElement('option');
      option.value = mixLayer;
      option.textContent = mixLayer === 0 ? 'none' : `mix layer ${mixLayer}`;
      select.append(option);
    }
    select.value = project.mixLayers[name] ?? 0;
    select.addEventListener('change', () => {
      const mixLayer = Number(select.value);
      if (mixLayer === 0) delete project.mixLayers[name];
      else project.mixLayers[name] = mixLayer;
      // Its samples are now mapped with that mix layer's other samples.
      remapName(project, name);
      // A layer that's now empty forgets its settings, so a later one starts afresh.
      for (const settings of [project.mixLayerVolumes, project.mixLayerSettings]) {
        for (const key of Object.keys(settings)) {
          if (!usedMixLayers(project).includes(Number(key))) delete settings[key];
        }
      }
      // Mixer knobs come and go with their layers.
      updateMixerControls(project);
      onMappingChange();
    });
    label.append(`${name} `, select);
    list.append(label);
  }

  // Per mix layer: a starting volume box, then pan, tuning and envelope.
  const rows = usedMixLayers(project).flatMap((mixLayer) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = 1;
    input.step = 0.05;
    input.className = 'envelope-input';
    input.value = mixLayerVolume(project, mixLayer);
    // "input" fires on every keystroke, so the XML updates as you type.
    input.addEventListener('input', () => {
      project.mixLayerVolumes[mixLayer] = input.value === '' ? null : Number(input.value);
      onChange();
    });
    const label = document.createElement('label');
    label.append(`Mix layer ${mixLayer} (${mixLayerLabel(project, mixLayer)}) volume `, input, ' (0–1, the Mixer knob starts here)');
    const row = document.createElement('p');
    row.append(label);
    return [row, settingsRow(project, mixLayer, rerender, onChange)];
  });

  container.replaceChildren(list, ...rows);
}

const SETTING_FIELDS = [
  { key: 'pan', label: 'Pan', unit: '(−100–100)', min: -100, max: 100, step: 1 },
  { key: 'tuning', label: 'Tuning', unit: 'semitones', min: -48, max: 48, step: 0.01 },
];
const ENVELOPE_FIELDS = [
  { key: 'attack', label: 'Attack', unit: 's', min: 0, step: 0.01 },
  { key: 'decay', label: 'Decay', unit: 's', min: 0, step: 0.01 },
  { key: 'sustain', label: 'Sustain', unit: '(0–1)', min: 0, max: 1, step: 0.01 },
  { key: 'release', label: 'Release', unit: 's', min: 0, step: 0.01 },
];

// A mix layer's pan and tuning boxes, and its own envelope (tick box, then
// attack, decay, sustain and release). Its settings are only stored once one
// is changed, so untouched layers export nothing extra.
function settingsRow(project, mixLayer, rerender, onChange) {
  const settings = mixLayerSettings(project, mixLayer);
  const set = (key, value) => {
    project.mixLayerSettings[mixLayer] = { ...mixLayerSettings(project, mixLayer), [key]: value };
  };

  const box = ({ key, label, unit, min, max, step }, disabled = false) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    if (max !== undefined) input.max = max;
    input.step = step;
    input.className = 'envelope-input';
    input.value = settings[key] ?? '';
    input.disabled = disabled;
    // "input" fires on every keystroke, so the XML updates as you type.
    input.addEventListener('input', () => {
      set(key, input.value === '' ? null : Number(input.value));
      onChange();
    });
    const wrapper = document.createElement('label');
    wrapper.className = 'envelope-field';
    wrapper.append(`${label} `, input, ` ${unit}`);
    return wrapper;
  };

  // Ticking starts from the instrument's envelope times, so the layer
  // sounds the same until they're changed.
  const own = document.createElement('input');
  own.type = 'checkbox';
  own.checked = settings.ownEnvelope;
  own.addEventListener('change', () => {
    if (own.checked && !project.mixLayerSettings[mixLayer]?.ownEnvelope) {
      for (const { key } of ENVELOPE_FIELDS) set(key, project.envelope[key]);
    }
    set('ownEnvelope', own.checked);
    rerender();
    onChange();
  });
  const ownLabel = document.createElement('label');
  ownLabel.className = 'envelope-field';
  ownLabel.append(own, ' Own envelope:');

  const row = document.createElement('p');
  row.className = 'mixlayer-settings';
  row.append(
    ...SETTING_FIELDS.map((f) => box(f)),
    ownLabel,
    ...ENVELOPE_FIELDS.map((f) => box(f, !settings.ownEnvelope)),
  );
  return row;
}
