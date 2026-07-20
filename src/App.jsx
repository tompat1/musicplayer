import AudioPlayer from './components/AudioPlayer.jsx';
import tracks from './audioData.json';

const formatFileType = (filename) => {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toUpperCase() : 'AUDIO';
};

function App() {
  const featuredTrack = tracks[0];

  return (
    <main className="app-shell">
      <section className="hero-panel" aria-labelledby="page-title">
        <div className="brand-stack">
          <p className="eyebrow">Private catalog // production player</p>
          <h1 id="page-title">Musicplayer</h1>
          <p className="lede">
            A standalone Winamp-inspired listening desk for music productions,
            edits, extended mixes, and works in progress.
          </p>
        </div>

        <div className="signal-board" aria-label="Library summary">
          <div>
            <span className="metric">{tracks.length}</span>
            <span className="metric-label">Tracks loaded</span>
          </div>
          <div>
            <span className="metric">MP3/M4A</span>
            <span className="metric-label">Current formats</span>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Music library">
        <div className="library-panel">
          <div className="panel-heading">
            <h2>Library</h2>
            <span>{tracks.length} files</span>
          </div>

          <div className="track-list">
            {tracks.map((track, index) => (
              <article className="track-row" key={track.filename}>
                <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{track.title}</h3>
                  <p>{track.filename}</p>
                </div>
                <span className="track-format">{formatFileType(track.filename)}</span>
              </article>
            ))}
          </div>
        </div>

        <aside className="details-panel" aria-label="Production notes">
          <div className="panel-heading">
            <h2>Now cataloging</h2>
          </div>

          {featuredTrack ? (
            <div className="feature-track">
              <span className="needle-light" aria-hidden="true" />
              <p className="eyebrow">First in queue</p>
              <h3>{featuredTrack.title}</h3>
              <p>
                Drop finished masters, edits, and experiments into
                <code>/public/assets/audio</code>, then run the app to refresh
                the playlist.
              </p>
            </div>
          ) : (
            <div className="feature-track">
              <p className="eyebrow">No tracks yet</p>
              <h3>Add audio files</h3>
              <p>Put MP3, M4A, WAV, OGG, FLAC, or AAC files in the audio folder.</p>
            </div>
          )}
        </aside>
      </section>

      <AudioPlayer />
    </main>
  );
}

export default App;
