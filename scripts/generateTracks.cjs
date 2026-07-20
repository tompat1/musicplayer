const fs = require('fs');
const path = require('path');

const audioDir = path.join(__dirname, '../public/assets/audio');
const coverDir = path.join(__dirname, '../public/assets/covers');
const outputJson = path.join(__dirname, '../src/audioData.json');
const overridesJson = path.join(__dirname, '../src/catalogOverrides.json');
const flowCatalogJson = path.join(__dirname, '../src/flowCatalog.json');

const audioPattern = /\.(mp3|ogg|wav|flac|aac|m4a)$/i;
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
