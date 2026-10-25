// Reads the header of a WAV file without loading the audio.
//
// A WAV file is a "RIFF" container: a 12-byte header, then a series of chunks.
// Each chunk starts with a 4-letter ID and a 4-byte size. We need two of them:
// - "fmt ": channels, sample rate, bit depth
// - "data": the audio itself; its size tells us the length in frames
// All numbers in WAV files are little-endian.

// Reads a 4-letter chunk ID.
function readId(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

// Reads `length` bytes starting at `start`. Only that part of the file is read.
async function readBytes(file, start, length) {
  return new DataView(await file.slice(start, start + length).arrayBuffer());
}

// Returns { sampleRate, channels, bitDepth, frames }, or throws an Error
// whose message explains what is wrong with the file.
export async function readWavInfo(file) {
  const { sampleRate, channels, bitDepth, frames } = await readWavLayout(file);
  return { sampleRate, channels, bitDepth, frames };
}

// Finds the "fmt " and "data" chunks. Returns the format and where the audio
// starts, without reading the audio itself.
async function readWavLayout(file) {
  if (file.size < 12) throw new Error('File too small to be a WAV');

  const header = await readBytes(file, 0, 12);
  const riff = readId(header, 0);
  if (riff === 'RF64') throw new Error('RF64 (very large WAV) not supported');
  if (riff !== 'RIFF' || readId(header, 8) !== 'WAVE') throw new Error('Not a WAV file');

  let fmt = null;
  let dataOffset = null;
  let dataSize = null;
  let offset = 12;

  while (offset + 8 <= file.size && (fmt === null || dataSize === null)) {
    const chunk = await readBytes(file, offset, 8);
    const id = readId(chunk, 0);
    const size = chunk.getUint32(4, true);

    if (id === 'fmt ') {
      const v = await readBytes(file, offset + 8, Math.min(size, 40));
      let format = v.getUint16(0, true); // 1 = integer PCM, 3 = float
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in its "sub-format".
      if (format === 0xfffe && v.byteLength >= 26) format = v.getUint16(24, true);
      fmt = {
        format,
        channels: v.getUint16(2, true),
        sampleRate: v.getUint32(4, true),
        blockAlign: v.getUint16(12, true), // bytes per frame (all channels)
        bitDepth: v.getUint16(14, true),
      };
    } else if (id === 'data') {
      // If the file was cut short, only count the audio that is really there.
      dataOffset = offset + 8;
      dataSize = Math.min(size, file.size - offset - 8);
    }

    // Chunks are padded to an even number of bytes.
    offset += 8 + size + (size % 2);
  }

  if (fmt === null) throw new Error('No "fmt " chunk found');
  if (dataSize === null) throw new Error('No "data" chunk found');
  if (fmt.blockAlign === 0) throw new Error('Invalid format (0 bytes per frame)');

  return { ...fmt, dataOffset, frames: Math.floor(dataSize / fmt.blockAlign) };
}

// Reads all of the audio, one Float32Array per channel with levels -1 to 1.
// Returns { frames, channels }, or throws an Error if the format isn't one we
// can read.
export async function readWavAudio(file) {
  const layout = await readWavLayout(file);
  const readSample = sampleReader(layout.format, layout.bitDepth);
  if (!readSample) throw new Error(`Waveform not available for this format (${layout.bitDepth}-bit, format ${layout.format})`);

  const { frames, blockAlign } = layout;
  const bytes = layout.bitDepth / 8;
  const channels = Array.from({ length: layout.channels }, () => new Float32Array(frames));
  const view = await readBytes(file, layout.dataOffset, frames * blockAlign);
  // In the file the channels are interleaved: frame 0 left, frame 0 right, ...
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channels.length; c++) {
      channels[c][frame] = readSample(view, frame * blockAlign + c * bytes);
    }
  }
  return { frames, channels };
}

// A function that reads one sample value as -1 to 1, or null if unsupported.
function sampleReader(format, bitDepth) {
  if (format === 1) {
    if (bitDepth === 8) return (v, o) => (v.getUint8(o) - 128) / 128; // 8-bit WAV is unsigned
    if (bitDepth === 16) return (v, o) => v.getInt16(o, true) / 32768;
    if (bitDepth === 24) {
      return (v, o) => {
        // Three bytes, little-endian; shift up then down to keep the sign.
        const n = (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16)) << 8 >> 8;
        return n / 8388608;
      };
    }
    if (bitDepth === 32) return (v, o) => v.getInt32(o, true) / 2147483648;
  }
  if (format === 3) {
    if (bitDepth === 32) return (v, o) => v.getFloat32(o, true);
    if (bitDepth === 64) return (v, o) => v.getFloat64(o, true);
  }
  return null;
}
