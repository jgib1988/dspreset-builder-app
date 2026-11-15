// The Choke section: which sample names cut each name off (docs: tags,
// silencedByTags; one-way is allowed, and a name can cut off its own previous
// hit), each name's voice limit (docs: polyphony on <tag>), and how a cut-off
// sample stops (docs: silencingMode, silencingDecay). Checks on the values
// happen in export.js (checkPreset).

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

  // One row per name: the names that cut it off, then its voice limit.
  const table = document.createElement('table');
  table.className = 'loop-table';
  for (const name of names) {
    const row = document.createElement('tr');
    const title = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = name;
    title.append(strong, ' is cut off by:');
    row.append(title);

    const boxes = document.createElement('td');
    for (const other of names) {
      const label = document.createElement('label');
      label.className = 'inline-option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = (project.chokedBy[name] ?? []).includes(other);
      box.addEventListener('change', () => {
        const list = (project.chokedBy[name] ?? []).filter((n) => n !== other);
        if (box.checked) list.push(other);
        if (list.length > 0) project.chokedBy[name] = list.sort();
        else delete project.chokedBy[name];
        onChange();
      });
      label.append(box, ` ${other === name ? `${other} (itself)` : other}`);
      boxes.append(label);
    }
    row.append(boxes);

    const limitCell = document.createElement('td');
    const limit = document.createElement('input');
    limit.type = 'number';
    limit.min = 1;
    limit.step = 1;
    limit.className = 'envelope-input';
    limit.placeholder = 'none';
    limit.value = project.voiceLimits[name] ?? '';
    // "input" fires on every keystroke, so the XML updates as you type.
    limit.addEventListener('input', () => {
      if (limit.value === '') delete project.voiceLimits[name];
      else project.voiceLimits[name] = Number(limit.value);
      onChange();
    });
    const limitLabel = document.createElement('label');
    limitLabel.append('Voice limit ', limit);
    limitCell.append(limitLabel);
    row.append(limitCell);
    table.append(row);
  }

  // How cut-off samples (and ones over their voice limit) stop: one setting for all of them.
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

  container.replaceChildren(table, modeRow);
}
