// The Key switches section: which articulation each sample name belongs to,
// and the keyswitch note that selects each articulation (docs: "The <note>
// element", TAG_ENABLED). Checks on the values happen in export.js
// (checkPreset) and validate.js (keyswitch inside a zone).

import { isExportable, remapName, usedArticulations } from './mapping.js';
import { addControl, removeArticulationMenu } from './ui.js';
import { midiToNoteName } from './filename.js';

const FIRST_SUGGESTED_KEYSWITCH = 24; // C0; articulation 2 gets C#0, and so on

// `onMappingChange` is called after an articulation changes (its zones move,
// so the grid needs redrawing); `onChange` after a keyswitch note is typed.
export function renderKeyswitchEditor(container, project, onMappingChange, onChange) {
  const names = [...new Set(project.samples.filter(isExportable).map((s) => s.name))].sort();

  // One dropdown per name: none, or articulation 1 up to one per name.
  const list = document.createElement('p');
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const select = document.createElement('select');
    for (let articulation = 0; articulation <= names.length; articulation++) {
      const option = document.createElement('option');
      option.value = articulation;
      option.textContent = articulation === 0 ? 'none (always plays)' : `articulation ${articulation}`;
      select.append(option);
    }
    select.value = project.articulations[name] ?? 0;
    select.addEventListener('change', () => {
      const before = usedArticulations(project).length;
      const articulation = Number(select.value);
      if (articulation === 0) delete project.articulations[name];
      else project.articulations[name] = articulation;
      // A new articulation gets a suggested keyswitch, which can be changed.
      if (articulation > 0 && project.keyswitches[articulation] === undefined) {
        project.keyswitches[articulation] = FIRST_SUGGESTED_KEYSWITCH + articulation - 1;
      }
      // Its samples are now mapped with that articulation's other samples.
      remapName(project, name);
      // The plugin's articulation menu comes and goes with a second articulation.
      const after = usedArticulations(project).length;
      if (before < 2 && after >= 2) addControl(project, null, 'articulation');
      if (after < 2) removeArticulationMenu(project);
      onMappingChange();
    });
    label.append(`${name} `, select);
    list.append(label);
  }

  // A keyswitch note box for each articulation in use.
  const articulations = usedArticulations(project);
  const rows = articulations.map((articulation) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = 127;
    input.step = 1;
    input.className = 'envelope-input';
    input.value = project.keyswitches[articulation] ?? '';
    const noteName = document.createElement('span');
    const showName = () => {
      const note = project.keyswitches[articulation];
      noteName.textContent = Number.isInteger(note) && note >= 0 && note <= 127 ? ` ${midiToNoteName(note)}` : '';
    };
    showName();
    // "input" fires on every keystroke, so the XML updates as you type;
    // "change" (on Return or leaving the box) also redraws the grid's labels.
    input.addEventListener('input', () => {
      project.keyswitches[articulation] = input.value === '' ? null : Number(input.value);
      showName();
      onChange();
    });
    input.addEventListener('change', onMappingChange);
    const label = document.createElement('label');
    label.append(
      `Articulation ${articulation} keyswitch `,
      input,
      noteName,
      articulation === articulations[0] ? ' (on when the preset loads)' : '',
    );
    const row = document.createElement('p');
    row.append(label);
    return row;
  });

  container.replaceChildren(list, ...rows);
}
