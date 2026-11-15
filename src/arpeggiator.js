// The Arpeggiator section (docs: "The <arpeggiator> element"). The
// arpeggiator plays whatever notes are held, one at a time, in the chosen
// order across the chosen octaves. When it's on it takes over every note
// played (tested: keyswitches still switch, and a sequence's notes are fed
// into it like held keys and arpeggiated).
// Checks on the values happen in export.js (checkArpeggiator).

// Orders (docs: arpOrder), with names for the app and the plugin's menu.
export const ARP_ORDERS = [
  ['up', 'Up'],
  ['down', 'Down'],
  ['up_down', 'Up-Down'],
  ['up_down_inclusive', 'Up-Down incl'],
  ['down_up', 'Down-Up'],
  ['down_up_inclusive', 'Down-Up incl'],
  ['as_played', 'As played'],
  ['random', 'Random'],
  ['random_no_repeat', 'Random no repeat'],
];

// Octave modes (docs: arpOctaveMode).
export const ARP_OCTAVE_MODES = [
  ['replayPerOctave', 'Replay per octave (the pattern again an octave up)'],
  ['interleaveByPitch', 'Interleave by pitch (all octaves sorted together)'],
];

// Step sizes (docs: arpSyncDivision), shortest first, as in the docs' list.
export const ARP_DIVISIONS = [
  ['noteOneSixtyFourthTriplet', '1/64 triplet'],
  ['noteOneSixtyFourth', '1/64'],
  ['noteOneThirtySecondTriplet', '1/32 triplet'],
  ['noteOneSixtyFourthDotted', '1/64 dotted'],
  ['noteOneThirtySecond', '1/32'],
  ['noteOneSixteenthTriplet', '1/16 triplet'],
  ['noteOneThirtySecondDotted', '1/32 dotted'],
  ['noteOneSixteenth', '1/16'],
  ['noteOneEighthTriplet', '1/8 triplet'],
  ['noteOneSixteenthDotted', '1/16 dotted'],
  ['noteOneEighth', '1/8'],
  ['noteOneFourthTriplet', '1/4 triplet'],
  ['noteOneEighthDotted', '1/8 dotted'],
  ['noteOneFourth', '1/4'],
  ['noteOneHalfTriplet', '1/2 triplet'],
  ['noteOneFourthDotted', '1/4 dotted'],
  ['noteOneHalf', '1/2'],
  ['noteOneTriplet', '1/1 triplet'],
  ['noteOneHalfDotted', '1/2 dotted'],
  ['noteWhole', '1/1 (whole note)'],
  ['noteWholeDotted', '1/1 dotted'],
];

// The number settings, with the docs' ranges.
export const ARP_NUMBERS = [
  { key: 'octaveRange', label: 'Octave range', min: 1, max: 8, step: 1, integer: true, hint: '1 = only the notes held' },
  { key: 'stepCount', label: 'Steps', min: 1, max: 16, step: 1, integer: true, hint: 'most notes in one cycle' },
  { key: 'gateLength', label: 'Gate length', min: 0, max: Infinity, step: 0.05, hint: 'part of a step each note lasts' },
  { key: 'rateMultiplier', label: 'Rate multiplier', min: 0.01, max: 100, step: 0.1, hint: 'on top of the step size' },
  { key: 'overrideBpm', label: 'Fixed BPM', min: 1, max: 1000, step: 1, hint: 'used when not following the DAW tempo' },
];

// The arpeggiator's settings, with the docs' defaults. `included` puts the
// <arpeggiator> element in the preset at all; `enabled` is whether it's on
// when the preset loads (the docs' default is off, but an arpeggiator added
// in the app is most likely wanted on).
export function createArpeggiator() {
  return {
    included: false,
    enabled: true,
    order: 'up',
    octaveRange: 1,
    octaveMode: 'replayPerOctave',
    stepCount: 16,
    gateLength: 0.75,
    followTempo: true,
    syncDivision: 'noteOneSixteenth',
    rateMultiplier: 1,
    overrideBpm: 120,
  };
}

// `onChange` is called after anything changes. Ticking "Include" adds or
// removes the Arpeggiator controls' target, so main.js redraws Controls too.
export function renderArpeggiatorEditor(container, project, onChange) {
  const arp = project.arpeggiator;
  const rerender = () => renderArpeggiatorEditor(container, project, onChange);

  const include = checkbox(arp.included, ' Include an arpeggiator', (checked) => {
    arp.included = checked;
    // Its controls go when it does.
    if (!checked) project.ui.controls = project.ui.controls.filter((c) => !c.key.startsWith('arp'));
    rerender();
    onChange();
  });
  const includeRow = document.createElement('p');
  includeRow.append(include);
  if (!arp.included) {
    container.replaceChildren(includeRow);
    return;
  }

  const enabled = checkbox(arp.enabled, ' On when the preset loads (an On/Off button in Controls can switch it)', (checked) => {
    arp.enabled = checked;
    onChange();
  });

  const choices = document.createElement('p');
  choices.append(
    label('Order ', select(ARP_ORDERS, arp.order, (value) => {
      arp.order = value;
      onChange();
    })),
    label('Step size ', select(ARP_DIVISIONS, arp.syncDivision, (value) => {
      arp.syncDivision = value;
      onChange();
    })),
    label('Octaves ', select(ARP_OCTAVE_MODES, arp.octaveMode, (value) => {
      arp.octaveMode = value;
      onChange();
    })),
  );

  const numbers = document.createElement('p');
  for (const { key, label: text, min, max, step, hint } of ARP_NUMBERS) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    if (max !== Infinity) input.max = max;
    input.step = step;
    input.className = 'envelope-input';
    input.value = arp[key] ?? '';
    input.title = hint;
    // "input" fires on every keystroke, so the XML updates as you type. A
    // blank box is kept as null, so the export check catches it.
    input.addEventListener('input', () => {
      arp[key] = input.value === '' ? null : Number(input.value);
      onChange();
    });
    numbers.append(label(`${text} `, input));
  }

  const tempo = checkbox(arp.followTempo, ' Follow the DAW tempo (off: use the fixed BPM)', (checked) => {
    arp.followTempo = checked;
    onChange();
  });

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'While it is on, every note played goes through the arpeggiator, including notes from sequences. Keyswitches still switch.';

  const paragraph = (content) => {
    const element = document.createElement('p');
    element.append(content);
    return element;
  };
  container.replaceChildren(includeRow, paragraph(enabled), choices, numbers, paragraph(tempo), hint);
}

function checkbox(checked, text, onToggle) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onToggle(input.checked));
  const element = document.createElement('label');
  element.append(input, text);
  return element;
}

function select(options, value, onSelect) {
  const element = document.createElement('select');
  for (const [optionValue, text] of options) element.append(new Option(text, optionValue));
  element.value = value;
  element.addEventListener('change', () => onSelect(element.value));
  return element;
}

function label(...content) {
  const element = document.createElement('label');
  element.className = 'effect-field';
  element.append(...content);
  return element;
}
