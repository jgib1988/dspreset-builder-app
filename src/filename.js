// Parses sample filenames in the project's format: Name_Note_vN_rrN.wav
//
// Examples:
//   "Piano_C3_v1_rr1.wav"        -> name "Piano", note 60, layer 1, RR 1
//   "Piano_60_v1_rr1.wav"        -> the same, with the note as a MIDI number
//   "Grand_Piano_F#2_v3_rr2.wav" -> name "Grand_Piano", note 54, layer 3, RR 2
//
// The last three parts are always note, velocity layer and round-robin, so the
// name itself may contain underscores. Middle C is C3 = MIDI note 60.

// Semitones above C for each note letter.
const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Returns { name, rootNote, velocityLayer, roundRobin }, or throws an Error
// whose message explains what doesn't match the format.
export function parseFilename(path) {
  const fileName = path.split('/').pop();
  const base = fileName.replace(/\.[^.]+$/, ''); // remove the extension
  const parts = base.split('_');

  if (parts.length < 4) {
    throw new Error(`Expected Name_Note_vN_rrN, found ${parts.length} part(s)`);
  }

  const [noteText, velocityText, roundRobinText] = parts.slice(-3);
  const name = parts.slice(0, -3).join('_');
  if (name === '') throw new Error('Missing sample name before the note');

  return {
    name,
    rootNote: parseNote(noteText),
    velocityLayer: parsePrefixedNumber(velocityText, 'v', 'velocity layer'),
    roundRobin: parsePrefixedNumber(roundRobinText, 'rr', 'round-robin'),
  };
}

// "C3" -> 60, "F#2" -> 54, "Bb1" -> 46, "C-2" -> 0, "60" -> 60
function parseNote(text) {
  let midi;
  if (/^\d+$/.test(text)) {
    midi = Number(text);
  } else {
    const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(text);
    if (!match) {
      throw new Error(`Note "${text}" not recognised (use e.g. C3, F#2, Bb1 or 60)`);
    }
    const [, letter, accidental, octave] = match;
    const sharpOrFlat = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
    // C-2 is MIDI 0, so octave -2 starts at 0 and each octave adds 12.
    midi = (Number(octave) + 2) * 12 + NOTE_OFFSETS[letter.toUpperCase()] + sharpOrFlat;
  }
  if (midi < 0 || midi > 127) {
    throw new Error(`Note "${text}" is outside the MIDI range 0–127`);
  }
  return midi;
}

// "v2" -> 2, "rr1" -> 1 (prefix is not case-sensitive; number must be 1 or more)
function parsePrefixedNumber(text, prefix, label) {
  const match = new RegExp(`^${prefix}(\\d+)$`, 'i').exec(text);
  if (!match || Number(match[1]) < 1) {
    throw new Error(`Expected ${prefix}<number from 1> for ${label}, found "${text}"`);
  }
  return Number(match[1]);
}

// 60 -> "C3" (sharps are used for black keys)
export function midiToNoteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 2);
}
