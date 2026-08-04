const fs = require('fs');
const path = require('path');

const audioDir = path.join(__dirname, '../public/assets/audio');
const coverDir = path.join(__dirname, '../public/assets/covers');
const outputJson = path.join(__dirname, '../src/audioData.json');
const overridesJson = path.join(__dirname, '../src/catalogOverrides.json');
const flowCatalogJson = path.join(__dirname, '../src/flowCatalog.json');

const audioPattern = /\.(mp3|ogg|wav|flac|aac|m4a|mp4)$/i;
const coverPattern = /\.(jpg|jpeg|png|webp|avif)$/i;

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`Could not read ${path.basename(filePath)}: ${error.message}`);
    return fallback;
  }
}

function normalizeName(value) {
  return value
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleCase(value) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function displayTitleFromFileName(fileName) {
  const rawName = fileName.replace(audioPattern, '');
  return rawName
    .replace(/\s+by\s+/i, ' by ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || rawName;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getId3v2Size(buffer) {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return 0;
  return 10
    + ((buffer[6] & 0x7f) << 21)
    + ((buffer[7] & 0x7f) << 14)
    + ((buffer[8] & 0x7f) << 7)
    + (buffer[9] & 0x7f);
}

function getMp3Duration(buffer) {
  const mpegBitrates = {
    '1-1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  const sampleRates = {
    0: [11025, 12000, 8000],
    2: [22050, 24000, 16000],
    3: [44100, 48000, 32000],
  };
  const layerMap = { 1: 3, 2: 2, 3: 1 };
  let offset = getId3v2Size(buffer);

  while (offset + 4 < buffer.length) {
    if (buffer[offset] === 0xff && (buffer[offset + 1] & 0xe0) === 0xe0) {
      const versionBits = (buffer[offset + 1] >> 3) & 0x03;
      const layerBits = (buffer[offset + 1] >> 1) & 0x03;
      const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
      const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
      if (versionBits !== 1 && layerBits !== 0 && bitrateIndex > 0 && bitrateIndex < 15 && sampleRateIndex < 3) {
        const version = versionBits === 3 ? 1 : 2;
        const layer = layerMap[layerBits];
        const bitrate = mpegBitrates[`${version}-${layer}`]?.[bitrateIndex];
        if (bitrate) return (buffer.length - offset) / ((bitrate * 1000) / 8);
      }
    }
    offset += 1;
  }

  return 0;
}

function readMp4BoxSize(buffer, offset) {
  if (offset + 8 > buffer.length) return null;
  const size32 = buffer.readUInt32BE(offset);
  const type = buffer.toString('latin1', offset + 4, offset + 8);
  if (size32 === 1 && offset + 16 <= buffer.length) {
    return { headerSize: 16, size: Number(buffer.readBigUInt64BE(offset + 8)), type };
  }
  if (size32 === 0) return { headerSize: 8, size: buffer.length - offset, type };
  return { headerSize: 8, size: size32, type };
}

function getMp4Duration(buffer) {
  const containerTypes = new Set(['moov', 'trak', 'mdia']);
  const durationBoxTypes = new Set(['mvhd', 'mdhd']);
  const stack = [{ start: 0, end: buffer.length }];

  while (stack.length) {
    const { start, end } = stack.pop();
    let offset = start;

    while (offset + 8 <= end) {
      const box = readMp4BoxSize(buffer, offset);
      if (!box || box.size < box.headerSize || offset + box.size > buffer.length) break;
      const contentStart = offset + box.headerSize;
      const contentEnd = offset + box.size;

      if (durationBoxTypes.has(box.type) && contentStart + 20 <= contentEnd) {
        const version = buffer[contentStart];
        const timescaleOffset = contentStart + (version === 1 ? 20 : 12);
        const durationOffset = contentStart + (version === 1 ? 24 : 16);
        if (version === 1 && durationOffset + 8 <= contentEnd) {
          const timescale = buffer.readUInt32BE(timescaleOffset);
          const duration = Number(buffer.readBigUInt64BE(durationOffset));
          if (timescale) return duration / timescale;
        }
        if (version === 0 && durationOffset + 4 <= contentEnd) {
          const timescale = buffer.readUInt32BE(timescaleOffset);
          const duration = buffer.readUInt32BE(durationOffset);
          if (timescale) return duration / timescale;
        }
      }

      if (containerTypes.has(box.type)) stack.push({ start: contentStart, end: contentEnd });
      offset += box.size;
    }
  }

  return 0;
}

function getWavDuration(buffer) {
  if (buffer.length < 44 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') return 0;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('latin1', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    if (type === 'fmt ' && contentStart + 12 <= buffer.length) byteRate = buffer.readUInt32LE(contentStart + 8);
    if (type === 'data') dataSize = size;
    if (byteRate && dataSize) return dataSize / byteRate;
    offset += 8 + size + (size % 2);
  }

  return 0;
}

function getAudioDuration(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.mp3') return formatDuration(getMp3Duration(buffer));
    if (extension === '.m4a' || extension === '.aac' || extension === '.mp4') return formatDuration(getMp4Duration(buffer));
    if (extension === '.wav') return formatDuration(getWavDuration(buffer));
  } catch (error) {
    console.warn(`Could not read duration for ${path.basename(filePath)}: ${error.message}`);
  }

  return '';
}

function extractMetadata(fileName) {
  const extension = path.extname(fileName).slice(1).toUpperCase();
  const rawName = fileName.replace(audioPattern, '');
  const byParts = rawName.split(/\s+by\s+/i);
  const artist = byParts[1] ? byParts.slice(1).join(' by ').trim() : '';
  let workingName = byParts[0].trim();

  const parenthetical = [...workingName.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());
  const version = parenthetical.find((part) => /version|edit|mix|extended|remaster|dub|instrumental|vocal/i.test(part)) || '';

  workingName = workingName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: titleCase(workingName || rawName),
    displayTitle: displayTitleFromFileName(fileName),
    artist,
    mix: version,
    version,
    format: extension,
    duration: '',
    bpm: '',
    key: '',
    notes: '',
  };
}

function getUrlFormat(url) {
  try {
    const parsedUrl = new URL(url);
    const extension = path.extname(parsedUrl.pathname).slice(1);
    return extension ? extension.toUpperCase() : 'STREAM';
  } catch {
    return 'STREAM';
  }
}

function createCoverIndex() {
  if (!fs.existsSync(coverDir)) return new Map();

  return fs
    .readdirSync(coverDir)
    .filter((file) => coverPattern.test(file))
    .reduce((index, file) => {
      index.set(normalizeName(file), `/assets/covers/${file}`);
      return index;
    }, new Map());
}

function findCover(fileName, title, coverIndex) {
  const candidates = [fileName, title];
  for (const candidate of candidates) {
    const cover = coverIndex.get(normalizeName(candidate));
    if (cover) return cover;
  }

  return '';
}

const overrides = readJson(overridesJson, {});
const flowCatalog = readJson(flowCatalogJson, []);
const coverIndex = createCoverIndex();
const localTracks = [];

if (fs.existsSync(audioDir)) {
  const audioFiles = fs
    .readdirSync(audioDir)
    .filter((file) => audioPattern.test(file))
    .sort((a, b) => a.localeCompare(b));

  localTracks.push(...audioFiles.map((file) => {
    const filePath = path.join(audioDir, file);
    const inferred = extractMetadata(file);
    const override = overrides[file] || overrides[normalizeName(file)] || {};
    const merged = {
      filename: file,
      src: `/assets/audio/${file}`,
      source: 'local',
      flowUrl: '',
      ...inferred,
      ...override,
    };

    return {
      ...merged,
      duration: merged.duration || getAudioDuration(filePath),
      cover: merged.cover || findCover(file, merged.title, coverIndex),
    };
  }));
}

const flowTracks = Array.isArray(flowCatalog)
  ? flowCatalog
      .filter((track) => track && track.src)
      .map((track, index) => {
        const title = track.title || `Google Flow Track ${index + 1}`;
        const id = track.id || normalizeName(title);

        return {
          filename: track.filename || `${id}.flow`,
          src: track.src,
          title,
          artist: track.artist || '',
          mix: track.mix || '',
          version: track.version || '',
          format: track.format || getUrlFormat(track.src),
          duration: track.duration || '',
          bpm: track.bpm || '',
          key: track.key || '',
          notes: track.notes || '',
          cover: track.cover || '',
          source: 'google-flow',
          flowUrl: track.flowUrl || track.shareUrl || '',
        };
      })
  : [];

const tracks = [...localTracks, ...flowTracks];

fs.writeFileSync(outputJson, JSON.stringify(tracks, null, 2));
console.log(`src/audioData.json generated with ${tracks.length} track(s).`);
