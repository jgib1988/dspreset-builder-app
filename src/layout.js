// Page layout: the tabs along the top and the foldable sections. Each tab
// button (in #tabs) shows the .tab-panel with the same data-tab and hides
// the others. Each section's heading is a <details class="fold"> summary, so
// clicking it folds the section away (the browser does that part itself).
//
// Which tab is open and which sections are folded are screen-only settings,
// not part of the project: they're kept in the browser's localStorage, so
// they survive a reload. If the browser blocks storage, the page still works
// and just starts on the first tab with everything open.

const TAB_KEY = 'dspreset-builder.tab';
const FOLDED_KEY = 'dspreset-builder.folded';

export function setUpLayout() {
  const tabs = [...document.querySelectorAll('#tabs button')];
  const panels = [...document.querySelectorAll('.tab-panel')];

  const show = (name) => {
    for (const button of tabs) button.classList.toggle('active', button.dataset.tab === name);
    for (const panel of panels) panel.hidden = panel.dataset.tab !== name;
    store(TAB_KEY, name);
  };
  for (const button of tabs) button.addEventListener('click', () => show(button.dataset.tab));
  const saved = read(TAB_KEY);
  show(tabs.some((b) => b.dataset.tab === saved) ? saved : tabs[0].dataset.tab);

  // Folded sections, by their <section>'s id.
  let folded;
  try {
    folded = new Set(JSON.parse(read(FOLDED_KEY) ?? '[]'));
  } catch {
    folded = new Set(); // unreadable: start with everything open
  }
  for (const details of document.querySelectorAll('details.fold')) {
    const id = details.closest('section').id;
    if (folded.has(id)) details.open = false;
    details.addEventListener('toggle', () => {
      if (details.open) folded.delete(id);
      else folded.add(id);
      store(FOLDED_KEY, JSON.stringify([...folded]));
    });
  }
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked (e.g. a private window): nothing is remembered.
  }
}
