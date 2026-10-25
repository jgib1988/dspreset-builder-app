// Lets the user pick a folder and returns the audio files inside it (including
// subfolders), each with its path relative to the picked folder.
//
// Two browser APIs do this:
// - showDirectoryPicker (Chrome, Edge): a proper folder dialog.
// - <input webkitdirectory> (all browsers, incl. Safari, Firefox): the fallback.
// Both return the same shape: { folderName, files: [{ path, file }] }, or null if cancelled.

// The audio formats Decent Sampler supports (see docs, <sample> path attribute).
const AUDIO_EXTENSIONS = ['.wav', '.aif', '.aiff', '.flac'];

function isAudioFile(name) {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Skip hidden files and folders such as .DS_Store.
function isHidden(path) {
  return path.split('/').some((part) => part.startsWith('.'));
}

function sortByPath(files) {
  // "numeric" sorts "2.wav" before "10.wav".
  return files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export async function pickFolder() {
  if ('showDirectoryPicker' in window) {
    return pickWithDirectoryPicker();
  }
  return pickWithInput();
}

async function pickWithDirectoryPicker() {
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker();
  } catch (err) {
    if (err.name === 'AbortError') return null; // user cancelled
    throw err;
  }
  const files = [];
  await collectFiles(dirHandle, '', files);
  return { folderName: dirHandle.name, files: sortByPath(files) };
}

// Walks a folder and its subfolders, adding each audio file to `files`.
async function collectFiles(dirHandle, prefix, files) {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix + name;
    if (isHidden(name)) continue;
    if (handle.kind === 'directory') {
      await collectFiles(handle, path + '/', files);
    } else if (isAudioFile(name)) {
      files.push({ path, file: await handle.getFile() });
    }
  }
}

function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;

    input.addEventListener('change', () => {
      const all = [...input.files];
      // webkitRelativePath looks like "MyInstrument/Samples/C3.wav".
      // The first part is the picked folder, so we strip it off.
      const folderName = all.length > 0 ? all[0].webkitRelativePath.split('/')[0] : '';
      const files = all
        .map((file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), file }))
        .filter(({ path }) => !isHidden(path) && isAudioFile(path));
      resolve({ folderName, files: sortByPath(files) });
    });
    input.addEventListener('cancel', () => resolve(null));

    input.click();
  });
}
