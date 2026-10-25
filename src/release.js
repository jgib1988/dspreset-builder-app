// The Release samples section: which sample names play when a key is released
// (docs: trigger="release"), how much quieter they get the longer the key was
// held (docs: releaseTriggerDecay, in dB per second), and whether they ignore
// the amp envelope (docs: ampEnvEnabled).
// Checks on the values happen in export.js (checkPreset).

import { isExportable, remapName } from './mapping.js';

// `onMappingChange` is called after a name is ticked or unticked (its zones
// move, so the grid needs redrawing); `onChange` after the other settings change.
export function renderReleaseEditor(container, project, onMappingChange, onChange) {
  const names = [...new Set(project.samples.filter(isExportable).map((s) => s.name))].sort();

  const list = document.createElement('p');
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = project.releaseNames.includes(name);
    box.addEventListener('change', () => {
      project.releaseNames = box.checked
        ? [...project.releaseNames, name]
        : project.releaseNames.filter((n) => n !== name);
      // Its samples are now mapped with the other kind (normal or release).
      remapName(project, name);
      onMappingChange();
    });
    label.append(box, ` ${name}`);
    list.append(label);
  }

  const decay = document.createElement('input');
  decay.type = 'number';
  decay.min = 0;
  decay.step = 0.5;
  decay.className = 'envelope-input';
  decay.placeholder = 'none';
  decay.value = project.releaseDecay ?? '';
  // "input" fires on every keystroke, so the XML updates as you type.
  decay.addEventListener('input', () => {
    project.releaseDecay = decay.value === '' ? null : Number(decay.value);
    onChange();
  });
  const decayRow = document.createElement('p');
  const decayLabel = document.createElement('label');
  decayLabel.className = 'envelope-field';
  decayLabel.append('Release decay ', decay, ' dB per second the key was held (blank = none)');
  decayRow.append(decayLabel);

  // Without this, release samples use the instrument's amp envelope, so its
  // release time can cut them short (tested in the plugin).
  const ignore = document.createElement('input');
  ignore.type = 'checkbox';
  ignore.checked = project.releaseIgnoresEnvelope;
  ignore.addEventListener('change', () => {
    project.releaseIgnoresEnvelope = ignore.checked;
    onChange();
  });
  const ignoreRow = document.createElement('p');
  const ignoreLabel = document.createElement('label');
  ignoreLabel.append(ignore, ' Release samples ignore the amp envelope (play to the end of the file)');
  ignoreRow.append(ignoreLabel);

  container.replaceChildren(list, decayRow, ignoreRow);
}
