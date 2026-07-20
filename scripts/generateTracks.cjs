const fs = require('fs');
const path = require('path');

const audioDir = path.join(__dirname, '../public/assets/audio');
const outputJson = path.join(__dirname, '../src/audioData.json');
const audioPattern = /\.(mp3|ogg|wav|flac|aac|m4a)$/i;

function formatAudioTitle(fileName) {
  return fileName
    .replace(audioPattern, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bEven More\b/g, 'Even more')
    .replace(/\s+By\s+/g, ' by ');
}

if (fs.existsSync(audioDir)) {
  const audioFiles = fs.readdirSync(audioDir).filter((file) => audioPattern.test(file));
  const tracks = audioFiles.map((file) => ({
    filename: file,
    title: formatAudioTitle(file),
    src: `/assets/audio/${file}`
  }));

  fs.writeFileSync(outputJson, JSON.stringify(tracks, null, 2));
  console.log(`src/audioData.json generated with ${tracks.length} track(s).`);
} else {
  fs.writeFileSync(outputJson, JSON.stringify([], null, 2));
  console.log('src/audioData.json generated with no tracks.');
}
