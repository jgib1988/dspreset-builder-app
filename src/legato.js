// The Legato section: for each sample name, whether it plays on every note
// (the default), only when no other note is held (docs: trigger="first") or
// only when another note is already held (docs: trigger="legato", e.g. a
// transition or slur sample). "Legato only" names get their own mapping,
// since they share keys with the normal samples. Release samples aren't listed:
// they already have their own trigger. Tested in the plugin (LegatoTest A–D).

import { isExportable, isRelease, remapName } from './mapping.js';

const TRIGGERS = [
  ['', 'every note'],
  ['first', 'first note only'],
  ['legato', 'legato only'],
];

// `onMappingChange` is called after a name's trigger changes (a name moving to
// or from "legato only" moves its zones, so the grid needs redrawing).
export function renderLegatoEditor(container, project, onMappingChange) {
  const names = [
    ...new Set(project.samples.filter((s) => isExportable(s) && !isRelease(project, s)).map((s) => s.name)),
  ].sort();

  const list = document.createElement('p');
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const select = document.createElement('select');
    for (const [value, text] of TRIGGERS) select.append(new Option(text, value));
    select.value = project.legatoTriggers[name] ?? '';
    select.addEventListener('change', () => {
      if (select.value === '') delete project.legatoTriggers[name];
      else project.legatoTriggers[name] = select.value;
      // Its samples are now mapped with the other kind (normal or legato).
      remapName(project, name);
      onMappingChange();
    });
    label.append(`${name} `, select);
    list.append(label);
  }
  container.replaceChildren(list);
}
