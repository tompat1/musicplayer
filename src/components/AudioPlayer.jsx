import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getDurationLabel = (track, liveDuration) => {
  if (track?.duration) return track.duration;
  return liveDuration ? formatTime(liveDuration) : '--:--';
};

function Slider({ label, value, onChange }) {
  const sliderRef = useRef(null);

  const updateValue = useCallback(
    (event) => {
      const rect = sliderRef.current.getBoundingClientRect();
      onChange(clamp((event.clientX - rect.left) / rect.width, 0, 1));
    },
    [onChange],
  );

  return (
    <div className="slider-field" aria-label={label}>
      <div
        ref={sliderRef}
        className="slider-track"
        role="slider"
        aria-label={label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(value * 100)}
        tabIndex="0"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateValue(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons) updateValue(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') onChange(clamp(value - 0.02, 0, 1));
          if (event.key === 'ArrowRight') onChange(clamp(value + 0.02, 0, 1));
        }}
      >
        <span className="slider-fill" style={{ width: `${value * 100}%` }} />
        <span className="slider-thumb" style={{ left: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function Equalizer({ playing }) {
  return (
    <div className="equalizer" aria-hidden="true">
      {Array.from({ length: 28 }, (_, index) => (
        <span
          className="eq-bar"
          key={index}
          style={{
            '--delay': `${index * 36}ms`,
            '--level': `${28 + ((index * 17) % 64)}%`,
          }}
          data-playing={playing}
        />
      ))}
    </div>
  );
}

function CoverArt({ track, playing }) {
  return (
    <div className="cover-stage" data-playing={playing}>
      {track?.cover ? (
        <img src={track.cover} alt={`${track.title} cover art`} />
      ) : (
        <div className="generated-cover" aria-label={`${track?.title || 'No track'} cover fallback`}>
          <span>{track?.title?.slice(0, 2).toUpperCase() || 'MP'}</span>
        </div>
      )}
      <div className="cover-ring" aria-hidden="true" />
    </div>
  );
}

function TrackMeta({ track, liveDuration }) {
  const meta = [
    ['Source', track?.source === 'google-flow' ? 'Google Flow' : 'Local'],
    ['Mix', track?.mix],
    ['Version', track?.version && track.version !== track.mix ? track.version : ''],
    ['Format', track?.format],
    ['Duration', getDurationLabel(track, liveDuration)],
    ['BPM', track?.bpm],
    ['Key', track?.key],
  ].filter(([, value]) => value);

  return (
    <div className="metadata-grid">
      {meta.map(([label, value]) => (
        <div className="metadata-cell" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Playlist({ tracks, currentIndex, playing, query, onQueryChange, onSelect, liveDuration }) {
  const filteredTracks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return tracks.map((track, index) => ({ track, index }));

    return tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => {
        const haystack = [track.title, track.mix, track.version, track.format, track.bpm, track.key, track.filename]
          .concat(track.source, track.flowUrl)
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      });
  }, [tracks, query]);

  return (
    <aside className="library-view" aria-label="Library playlist">
      <div className="library-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Playlist</h2>
        </div>
        <span>{filteredTracks.length}/{tracks.length}</span>
      </div>

      <label className="search-field">
        <span>Search</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Title, mix, key, BPM"
        />
      </label>

      <div className="track-list" role="list">
        {filteredTracks.length === 0 ? (
          <div className="empty-state">No matching tracks.</div>
        ) : (
          filteredTracks.map(({ track, index }) => {
            const isActive = index === currentIndex;
            return (
              <button
                className="track-row"
                type="button"
                key={track.filename}
                onClick={() => onSelect(index)}
                data-active={isActive}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="track-number">{isActive && playing ? 'PLAY' : String(index + 1).padStart(2, '0')}</span>
                <span className="track-thumb">
                  {track.cover ? <img src={track.cover} alt="" /> : <span>{track.title.slice(0, 1)}</span>}
                </span>
                <span className="track-main">
                  <strong>{track.title}</strong>
                  <small>{[track.mix || track.version, track.source === 'google-flow' ? 'Google Flow' : track.filename].filter(Boolean).join(' / ')}</small>
                </span>
                <span className="track-tags">
                  {track.source === 'google-flow' && <span>FLOW</span>}
                  <span>{track.format || 'AUDIO'}</span>
                  <span>{isActive ? getDurationLabel(track, liveDuration) : track.duration || '--:--'}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

export default function AudioPlayer({ tracks = [] }) {
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.75);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [query, setQuery] = useState('');
  const [audioError, setAudioError] = useState('');

  const audioRef = useRef(null);
  const hasTracks = tracks.length > 0;
  const currentTrack = hasTracks ? tracks[trackIndex] : null;

  useEffect(() => {
    if (trackIndex > tracks.length - 1) setTrackIndex(0);
  }, [trackIndex, tracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    };
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (repeat) {
        audio.currentTime = 0;
        audio.play();
        return;
      }

      if (shuffle) {
        setTrackIndex(Math.floor(Math.random() * tracks.length));
        return;
      }

      if (trackIndex < tracks.length - 1) setTrackIndex((index) => index + 1);
      else setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [repeat, shuffle, trackIndex, tracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    audio.src = currentTrack.src;
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setAudioError('');

    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
  }, [currentTrack]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = isMuted;
  }, [isMuted]);

  const play = async () => {
    if (!audioRef.current || !currentTrack) return;
    try {
      await audioRef.current.play();
      setIsPlaying(true);
      setAudioError('');
    } catch {
      setIsPlaying(false);
      setAudioError('This track could not start. If it is from Google Flow, use a direct audio file URL or download/export it locally.');
    }
  };

  const pause = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (isPlaying) pause();
    else play();
  };

  const stop = () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  };

  const seek = useCallback((percent) => {
    const audio = audioRef.current;
    if (!audio?.duration) return;
    audio.currentTime = percent * audio.duration;
    setProgress(percent);
    setCurrentTime(percent * audio.duration);
  }, []);

  const previous = () => {
    if (!tracks.length) return;
    if (audioRef.current?.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    setTrackIndex((index) => (index - 1 + tracks.length) % tracks.length);
  };

  const next = () => {
    if (!tracks.length) return;
    if (shuffle) setTrackIndex(Math.floor(Math.random() * tracks.length));
    else setTrackIndex((index) => (index + 1) % tracks.length);
  };

  const selectTrack = (index) => {
    setTrackIndex(index);
    setIsPlaying(true);
  };

  return (
    <main className="player-shell">
      {currentTrack && (
        <audio
          ref={audioRef}
          preload="metadata"
          onError={() => {
            setIsPlaying(false);
            setAudioError('The audio source failed to load. Google Flow share links usually open a page; the player needs a direct streamable audio URL.');
          }}
        />
      )}

      <section className="production-deck" aria-labelledby="page-title">
        <div className="deck-hero">
          <div className="brand-lockup">
            <p className="eyebrow">Private catalog // production player</p>
            <h1 id="page-title">Musicplayer</h1>
          </div>
          <div className="deck-stats" aria-label="Catalog summary">
            <span>{tracks.length} tracks</span>
            <span>{new Set(tracks.map((track) => track.format).filter(Boolean)).size || 0} formats</span>
          </div>
        </div>

        <div className="now-playing-grid">
          <CoverArt track={currentTrack} playing={isPlaying} />

          <div className="control-room">
            <div className="track-kicker">
              <span>{hasTracks ? String(trackIndex + 1).padStart(2, '0') : '--'}</span>
              <span>{isPlaying ? 'Now playing' : 'Ready'}</span>
            </div>

            <div className="title-stack">
              <h2>{currentTrack?.title || 'No Tracks Loaded'}</h2>
              <p>{currentTrack?.artist || currentTrack?.filename || 'Add audio files to the catalog.'}</p>
            </div>

            <TrackMeta track={currentTrack} liveDuration={duration} />
            {currentTrack?.flowUrl && (
              <a className="flow-link" href={currentTrack.flowUrl} target="_blank" rel="noreferrer">
                Open in Google Flow
              </a>
            )}
            {audioError && <div className="stream-alert" role="status">{audioError}</div>}
            <Equalizer playing={isPlaying} />

            <div className="time-row">
              <span>{formatTime(currentTime)}</span>
              <Slider label="Track progress" value={progress} onChange={seek} />
              <span>{getDurationLabel(currentTrack, duration)}</span>
            </div>

            <div className="transport-row" aria-label="Playback controls">
              <button type="button" onClick={previous} disabled={!hasTracks} title="Previous track">
                PREV
              </button>
              <button className="play-button" type="button" onClick={togglePlay} disabled={!hasTracks} title={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? 'PAUSE' : 'PLAY'}
              </button>
              <button type="button" onClick={stop} disabled={!hasTracks} title="Stop">
                STOP
              </button>
              <button type="button" onClick={next} disabled={!hasTracks} title="Next track">
                NEXT
              </button>
            </div>

            <div className="utility-row">
              <button type="button" onClick={() => setShuffle((value) => !value)} aria-pressed={shuffle} data-active={shuffle}>
                Shuffle
              </button>
              <button type="button" onClick={() => setRepeat((value) => !value)} aria-pressed={repeat} data-active={repeat}>
                Repeat
              </button>
              <button type="button" onClick={() => setIsMuted((value) => !value)} aria-pressed={isMuted} data-active={isMuted}>
                {isMuted ? 'Muted' : 'Mute'}
              </button>
              <div className="volume-control">
                <span>Vol</span>
                <Slider label="Volume" value={volume} onChange={setVolume} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <Playlist
        tracks={tracks}
        currentIndex={trackIndex}
        playing={isPlaying}
        query={query}
        onQueryChange={setQuery}
        onSelect={selectTrack}
        liveDuration={duration}
      />
    </main>
  );
}
