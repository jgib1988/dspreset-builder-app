// The Choke groups section: which sample names cut each other off (docs:
// tags, silencedByTags), and how a cut-off sample stops (docs: silencingMode,
// silencingDecay). Checks on the values happen in export.js (checkPreset).

import { isExportable } from './mapping.js';

const MODES = [
  ['fast', 'Immediately'],
  ['normal', 'Release phase of the amp envelope'],
  ['decay', 'Fade out over'],
];

// `onChange` is called after any setting changes, so the XML preview and
// export checks can update.
export function renderChokeEditor(container, project, onChange) {
  const rerender = () => renderChokeEditor(container, project, onChange);
  const names = [...new Set(project.samples.filter(isExportable).map((s) => s.name))].sort();

  // One dropdown per name: none, or group 1 up to one group per name.
  const list = document.createElement('p');
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const select = document.createElement('select');
    for (let group = 0; group <= names.length; group++) {
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group === 0 ? 'none' : `group ${group}`;
      select.append(option);
    }
    select.value = project.chokeGroups[name] ?? 0;
    select.addEventListener('change', () => {
      const group = Number(select.value);
      if (group === 0) delete project.chokeGroups[name];
      else project.chokeGroups[name] = group;
      onChange();
    });
    label.append(`${name} `, select);
    list.append(label);
  }

  // How cut-off samples stop: one setting for all of them.
  const modeRow = document.createElement('p');
  modeRow.append('When cut off, stop: ');
  for (const [mode, text] of MODES) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'choke-mode';
    radio.checked = project.chokeMode === mode;
    radio.addEventListener('change', () => {
      project.chokeMode = mode;
      rerender(); // enables or disables the fade box
      onChange();
    });
    label.append(radio, ` ${text}`);
    if (mode === 'decay') {
      const seconds = document.createElement('input');
      seconds.type = 'number';
      seconds.min = 0;
      seconds.step = 0.01;
      seconds.className = 'envelope-input';
      seconds.value = project.chokeDecay ?? '';
      seconds.disabled = project.chokeMode !== 'decay';
      seconds.addEventListener('input', () => {
        project.chokeDecay = seconds.value === '' ? null : Number(seconds.value);
        onChange();
      });
      label.append(' ', seconds, ' s');
    }
    modeRow.append(label);
  }

  container.replaceChildren(list, modeRow);
}
