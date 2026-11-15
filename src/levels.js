// The Level and tuning box shown under the grid for the selected zone: one
// row per sample, so each round-robin can be evened out on its own (docs:
// volume, pan, tuning on <sample>). Volume is in dB, the unit audio editors
// show; the docs accept it with "dB" appended.
// Checks on the values happen in export.js (checkLevels).

const FIELDS = [
  { key: 'volumeDb', title: 'Volume (dB)', step: 0.5, hint: '0 = unchanged' },
  { key: 'pan', title: 'Pan', step: 1, min: -100, max: 100, hint: '−100 left, 100 right' },
  { key: 'tuning', title: 'Tuning (semitones)', step: 0.01, hint: '0.01 = 1 cent' },
];

// `onChange` is called after any value changes, so the XML preview and
// export checks can update.
export function renderLevelEditor(box, zone, onChange) {
  const table = document.createElement('table');
  table.className = 'loop-table';
  const header = document.createElement('tr');
  for (const title of ['Sample', ...FIELDS.map((f) => f.title)]) {
    const th = document.createElement('th');
    th.textContent = title;
    header.append(th);
  }
  table.append(header);

  for (const sample of zone) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = sample.path.split('/').pop();
    row.append(name);
    for (const { key, step, min, max } of FIELDS) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      if (min !== undefined) input.min = min;
      if (max !== undefined) input.max = max;
      input.className = 'envelope-input';
      input.value = sample[key] ?? '';
      // "input" fires on every keystroke, so the XML updates as you type.
      // A blank box is kept as null, so the export check catches it.
      input.addEventListener('input', () => {
        sample[key] = input.value === '' ? null : Number(input.value);
        onChange();
      });
      cell.append(input);
      row.append(cell);
    }
    table.append(row);
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Level and tuning';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = `Per sample. ${FIELDS.map((f) => `${f.title}: ${f.hint}`).join('. ')}.`;
  box.replaceChildren(heading, table, hint);
}
