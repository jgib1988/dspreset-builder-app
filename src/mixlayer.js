// The Mix layers section: which sample names play together on the same keys,
// each as its own layer (e.g. close and room mics), and each layer's starting
// volume. Each mix layer is mapped on its own and exported in its own groups
// with tags="mixN"; its Mixer knob sets the tag's volume (docs: TAG_VOLUME).
// Checks on the values happen in export.js (checkPreset).

import { isExportable, mixLayerLabel, mixLayerVolume, remapName, usedMixLayers } from './mapping.js';
import { updateMixerControls } from './ui.js';

// `onMappingChange` is called after a mix layer changes (its zones move, so
// the grid needs redrawing); `onChange` after a volume is typed.
export function renderMixLayerEditor(container, project, onMappingChange, onChange) {
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
      // A layer that's now empty forgets its volume, so a later one starts at 1.
      for (const key of Object.keys(project.mixLayerVolumes)) {
        if (!usedMixLayers(project).includes(Number(key))) delete project.mixLayerVolumes[key];
      }
      // Mixer knobs come and go with their layers.
      updateMixerControls(project);
      onMappingChange();
    });
    label.append(`${name} `, select);
    list.append(label);
  }

  // A starting volume box for each mix layer in use.
  const rows = usedMixLayers(project).map((mixLayer) => {
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
    return row;
  });

  container.replaceChildren(list, ...rows);
}
