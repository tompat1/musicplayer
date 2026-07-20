const fs = require('fs');
const path = require('path');

const audioDir = path.join(__dirname, '../public/assets/audio');
const coverDir = path.join(__dirname, '../public/assets/covers');
const outputJson = path.join(__dirname, '../src/audioData.json');
const overridesJson = path.join(__dirname, '../src/catalogOverrides.json');

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
const coverIndex = createCoverIndex();

if (fs.existsSync(audioDir)) {
  const audioFiles = fs
    .readdirSync(audioDir)
    .filter((file) => audioPattern.test(file))
    .sort((a, b) => a.localeCompare(b));

  const tracks = audioFiles.map((file) => {
    const inferred = extractMetadata(file);
    const override = overrides[file] || overrides[normalizeName(file)] || {};
    const merged = {
      filename: file,
      src: `/assets/audio/${file}`,
      ...inferred,
      ...override,
    };

    return {
      ...merged,
      cover: merged.cover || findCover(file, merged.title, coverIndex),
    };
  });

  fs.writeFileSync(outputJson, JSON.stringify(tracks, null, 2));
  console.log(`src/audioData.json generated with ${tracks.length} track(s).`);
} else {
  fs.writeFileSync(outputJson, JSON.stringify([], null, 2));
  console.log('src/audioData.json generated with no tracks.');
}
