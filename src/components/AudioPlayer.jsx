import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SNAP_PX = 80;
const audioGraphs = new WeakMap();

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

const getPlaylistDuration = (track, index, durations, currentIndex, liveDuration) => {
  if (track?.duration) return track.duration;
  if (durations[track?.filename]) return durations[track.filename];
  if (index === currentIndex && liveDuration) return formatTime(liveDuration);
  return '--:--';
};

function DurationProbe({ track, onDuration }) {
  if (!track?.src || track.duration) return null;

  return (
    <audio
      preload="metadata"
      src={track.src}
      onLoadedMetadata={(event) => {
        onDuration(track.filename, event.currentTarget.duration);
      }}
      onError={() => onDuration(track.filename, 0)}
    />
  );
}

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

function SyncedCanvasVisualizer({ audioRef, playing, visualMode }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    if (!audio || !canvas) return undefined;

    const context = canvas.getContext('2d');
    const frequencyData = new Uint8Array(128);
    const timeData = new Uint8Array(128);
    let frameId = 0;
    let graph = audioGraphs.get(audio);

    const drawIdle = (time = 0) => {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(0, 0, 0, 0.12)';
      context.fillRect(0, 0, width, height);

      for (let i = 0; i < 42; i += 1) {
        const x = (i / 41) * width;
        const wave = Math.sin(time / 420 + i * 0.52) * 0.5 + 0.5;
        const barHeight = (0.12 + wave * 0.76) * height;
        context.fillStyle = `hsla(${118 + i * 7}, 100%, ${54 + wave * 18}%, ${0.32 + wave * 0.34})`;
        context.fillRect(x, height - barHeight, width / 52, barHeight);
      }
    };

    const drawWave = (width, height) => {
      const centerY = height * 0.52;
      context.lineWidth = 6;
      const lineGradient = context.createLinearGradient(0, 0, width, 0);
      lineGradient.addColorStop(0, '#00ff41');
      lineGradient.addColorStop(0.45, '#d6ff36');
      lineGradient.addColorStop(0.72, '#ff335c');
      lineGradient.addColorStop(1, '#58d7ff');
      context.strokeStyle = lineGradient;
      context.beginPath();
      timeData.forEach((value, index) => {
        const x = (index / (timeData.length - 1)) * width;
        const y = centerY + ((value - 128) / 128) * height * 0.32;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };

    const drawBars = (width, height, alphaBoost = 0) => {
      frequencyData.forEach((value, index) => {
        const barWidth = width / frequencyData.length;
        const normalized = value / 255;
        const barHeight = Math.max(8, normalized * height * 0.66);
        const hue = 112 + normalized * 210 + index * 0.9;
        context.fillStyle = `hsla(${hue}, 100%, ${52 + normalized * 22}%, ${0.22 + normalized * 0.58 + alphaBoost})`;
        context.fillRect(index * barWidth, height - barHeight, Math.max(2, barWidth - 2), barHeight);
      });
    };

    const ensureGraph = async () => {
      if (graph) {
        await graph.audioContext.resume();
        return graph;
      }

      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioContextClass();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
        graph = { analyser, audioContext };
        audioGraphs.set(audio, graph);
        await audioContext.resume();
        return graph;
      } catch {
        return null;
      }
    };

    const draw = () => {
      const activeGraph = graph;
      const width = canvas.width;
      const height = canvas.height;

      if (!activeGraph) {
        drawIdle(performance.now());
        frameId = requestAnimationFrame(draw);
        return;
      }

      activeGraph.analyser.getByteFrequencyData(frequencyData);
      activeGraph.analyser.getByteTimeDomainData(timeData);
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(0, 0, 0, 0.14)';
      context.fillRect(0, 0, width, height);

      if (visualMode === 'idle') {
        drawIdle(performance.now());
      } else if (visualMode === 'bars') {
        drawBars(width, height, 0.08);
      } else if (visualMode === 'wave') {
        drawWave(width, height);
      } else {
        drawWave(width, height);
        drawBars(width, height);
      }

      frameId = requestAnimationFrame(draw);
    };

    const start = async () => {
      graph = await ensureGraph();
      cancelAnimationFrame(frameId);
      draw();
    };

    const stop = () => {
      cancelAnimationFrame(frameId);
      drawIdle(performance.now());
    };

    audio.addEventListener('play', start);
    audio.addEventListener('pause', stop);
    audio.addEventListener('ended', stop);

    if (!audio.paused || playing) start();
    else stop();

    return () => {
      cancelAnimationFrame(frameId);
      audio.removeEventListener('play', start);
      audio.removeEventListener('pause', stop);
      audio.removeEventListener('ended', stop);
    };
  }, [audioRef, playing, visualMode]);

  return (
    <div className="synced-visualizers" aria-hidden="true">
      <canvas className="waviz-canvas" ref={canvasRef} width="1200" height="720" />
    </div>
  );
}

function VisualMode({ track, playing, audioRef, visualMode }) {
  return (
    <section className="visual-mode" data-playing={playing} data-visual-mode={visualMode} aria-label="Minimized music visualizer">
      <div className="visual-field" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span className="visual-wave" key={index} style={{ '--wave': index }} />
        ))}
        <div className="visual-prism" />
        <div className="visual-grid" />
      </div>
      <SyncedCanvasVisualizer audioRef={audioRef} playing={playing} visualMode={visualMode} />

      <div className="visual-title">
        <p className="eyebrow">Miniplayer visual mode</p>
        <h1>{track?.title || 'Musicplayer'}</h1>
        <p>{playing ? `${visualMode} visual locked to playback` : 'Ready for signal'}</p>
      </div>
    </section>
  );
}

function DockedMiniHandle({ side, playing, onRestore, onPrevious, onNext }) {
  const isVertical = side === 'left' || side === 'right';

  return (
    <aside className={`dock-handle dock-${side}`} data-playing={playing} aria-label="Docked miniplayer">
      <button type="button" onClick={onPrevious} title="Previous track">
        {isVertical ? 'UP' : 'PREV'}
      </button>
      <button className="dock-pulse" type="button" onClick={onRestore} title="Restore floating miniplayer">
        {Array.from({ length: 5 }, (_, index) => <span key={index} style={{ '--bar': index }} />)}
      </button>
      <button type="button" onClick={onNext} title="Next track">
        {isVertical ? 'DN' : 'NEXT'}
      </button>
    </aside>
  );
}

function WinampMiniPlayer({
  track,
  tracks,
  currentIndex,
  playing,
  currentTime,
  durationLabel,
  progress,
  position,
  dragging,
  playlistOpen,
  durations,
  volume,
  visualMode,
  onSeek,
  onVolumeChange,
  onToggle,
  onStop,
  onPrevious,
  onNext,
  onRestore,
  onSelect,
  onTogglePlaylist,
  onVisualModeChange,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
  playerRef,
}) {
  const style = position ? { left: position.x, top: position.y } : undefined;

  return (
    <aside ref={playerRef} className="winamp-mini" style={style} aria-label="Floating Winamp miniplayer">
      {dragging && <div className="dock-hint">Drag to edge to dock</div>}
      <div
        className="winamp-titlebar"
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
      >
        <span>MUSICPLAYER MINI</span>
        <button type="button" onClick={onRestore} title="Open full-page player">FULL PAGE</button>
      </div>

      <div className="winamp-lcd">
        <div className="winamp-time-row">
          <strong>{formatTime(currentTime)}</strong>
          <span>{durationLabel}</span>
        </div>
        <div className="winamp-marquee">
          <span data-playing={playing}>{(track?.title || 'No Tracks Loaded').toUpperCase()}</span>
        </div>
        <div className="winamp-meter" aria-hidden="true">
          {Array.from({ length: 16 }, (_, index) => (
            <span key={index} data-playing={playing} style={{ '--bar': index }} />
          ))}
        </div>
      </div>

      <div className="winamp-seek">
        <Slider label="Miniplayer progress" value={progress} onChange={onSeek} />
      </div>

      <div className="winamp-controls">
        <button type="button" onClick={onPrevious} title="Previous track">PREV</button>
        <button className="winamp-play" type="button" onClick={onToggle} title={playing ? 'Pause' : 'Play'}>
          {playing ? 'PAUS' : 'PLAY'}
        </button>
        <button type="button" onClick={onStop} title="Stop">STOP</button>
        <button type="button" onClick={onNext} title="Next track">NEXT</button>
      </div>

      <div className="winamp-volume">
        <span>VOL</span>
        <Slider label="Miniplayer volume" value={volume} onChange={onVolumeChange} />
        <strong>{Math.round(volume * 100)}</strong>
      </div>

      <div className="winamp-drawer">
        <button className="winamp-drawer-toggle" type="button" onClick={onTogglePlaylist} aria-expanded={playlistOpen}>
          <span>Playlist ({tracks.length})</span>
          <span>{playlistOpen ? 'Hide' : 'Show'}</span>
        </button>

        <div className="winamp-vis-row" aria-label="Visualizer mode">
          <span>VIS</span>
          {['candy', 'bars', 'wave', 'idle'].map((mode) => (
            <button
              type="button"
              key={mode}
              data-active={visualMode === mode}
              onClick={() => onVisualModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        {playlistOpen && (
          <div className="winamp-songlist" role="list">
            {tracks.length === 0 ? (
              <div className="winamp-empty">Drop tracks into /public/assets/audio</div>
            ) : (
              tracks.map((playlistTrack, index) => {
                const isActive = index === currentIndex;
                return (
                  <button
                    type="button"
                    key={playlistTrack.filename}
                    className="winamp-song-row"
                    data-active={isActive}
                    onClick={() => onSelect(index)}
                  >
                    <span>{isActive && playing ? 'PLAY' : String(index + 1).padStart(2, '0')}</span>
                    <strong>{playlistTrack.title}</strong>
                    <small>{getPlaylistDuration(playlistTrack, index, durations, currentIndex, 0)}</small>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </aside>
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

function Playlist({ tracks, currentIndex, playing, query, onQueryChange, onSelect, liveDuration, durations }) {
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
                  <span>{getPlaylistDuration(track, index, durations, currentIndex, liveDuration)}</span>
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
  const [isMinimized, setIsMinimized] = useState(true);
  const [durations, setDurations] = useState({});
  const [miniPosition, setMiniPosition] = useState(null);
  const [docked, setDocked] = useState(null);
  const [isDraggingMini, setIsDraggingMini] = useState(false);
  const [miniPlaylistOpen, setMiniPlaylistOpen] = useState(true);
  const [visualMode, setVisualMode] = useState('candy');

  const audioRef = useRef(null);
  const miniRef = useRef(null);
  const miniDragging = useRef(false);
  const miniDragOffset = useRef({ x: 0, y: 0 });
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

  const setTrackDuration = useCallback((filename, seconds) => {
    setDurations((currentDurations) => {
      if (!filename || currentDurations[filename]) return currentDurations;
      return {
        ...currentDurations,
        [filename]: seconds ? formatTime(seconds) : '--:--',
      };
    });
  }, []);

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

  const minimize = () => {
    setIsMinimized(true);
    setDocked(null);
  };

  const restoreFullPlayer = () => {
    setIsMinimized(false);
    setDocked(null);
  };

  const onMiniTitlePointerDown = useCallback((event) => {
    if (event.target.tagName === 'BUTTON') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = miniRef.current.getBoundingClientRect();
    miniDragOffset.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    miniDragging.current = true;
    setIsDraggingMini(true);
    setDocked(null);
  }, []);

  const onMiniTitlePointerMove = useCallback((event) => {
    if (!miniDragging.current) return;
    const width = miniRef.current?.offsetWidth || 320;
    const height = miniRef.current?.offsetHeight || 190;
    const x = clamp(event.clientX - miniDragOffset.current.x, 0, window.innerWidth - width);
    const y = clamp(event.clientY - miniDragOffset.current.y, 0, window.innerHeight - height);
    setMiniPosition({ x, y });
  }, []);

  const onMiniTitlePointerUp = useCallback((event) => {
    if (!miniDragging.current) return;
    miniDragging.current = false;
    setIsDraggingMini(false);

    const width = miniRef.current?.offsetWidth || 320;
    const height = miniRef.current?.offsetHeight || 190;
    const x = clamp(event.clientX - miniDragOffset.current.x, 0, window.innerWidth - width);
    const y = clamp(event.clientY - miniDragOffset.current.y, 0, window.innerHeight - height);
    const edgeDistances = {
      left: x,
      right: window.innerWidth - (x + width),
      top: y,
      bottom: window.innerHeight - (y + height),
    };
    const closestSide = Object.entries(edgeDistances).sort((a, b) => a[1] - b[1])[0];

    if (closestSide[1] <= SNAP_PX) {
      setDocked(closestSide[0]);
      return;
    }

    setMiniPosition({ x, y });
  }, []);

  const durationProbes = tracks.map((track) => (
    <DurationProbe key={track.filename} track={track} onDuration={setTrackDuration} />
  ));

  return (
    <main className={`player-shell${isMinimized ? ' is-minimized' : ''}`}>
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
      <div className="duration-probes" aria-hidden="true">{durationProbes}</div>

      {isMinimized ? (
        <>
          <VisualMode track={currentTrack} playing={isPlaying} audioRef={audioRef} visualMode={visualMode} />
          {docked ? (
            <DockedMiniHandle
              side={docked}
              playing={isPlaying}
              onRestore={() => setDocked(null)}
              onPrevious={previous}
              onNext={next}
            />
          ) : (
            <WinampMiniPlayer
              track={currentTrack}
              tracks={tracks}
              currentIndex={trackIndex}
              playing={isPlaying}
              currentTime={currentTime}
              durationLabel={getDurationLabel(currentTrack, duration)}
              progress={progress}
              position={miniPosition}
              dragging={isDraggingMini}
              playlistOpen={miniPlaylistOpen}
              durations={durations}
              volume={volume}
              visualMode={visualMode}
              onSeek={seek}
              onVolumeChange={setVolume}
              onToggle={togglePlay}
              onStop={stop}
              onPrevious={previous}
              onNext={next}
              onRestore={restoreFullPlayer}
              onSelect={selectTrack}
              onTogglePlaylist={() => setMiniPlaylistOpen((value) => !value)}
              onVisualModeChange={setVisualMode}
              onTitlePointerDown={onMiniTitlePointerDown}
              onTitlePointerMove={onMiniTitlePointerMove}
              onTitlePointerUp={onMiniTitlePointerUp}
              playerRef={miniRef}
            />
          )}
        </>
      ) : (
        <>

      <section className="production-deck" aria-labelledby="page-title">
        <div className="deck-hero">
          <div className="brand-lockup">
            <p className="eyebrow">Private catalog // production player</p>
            <h1 id="page-title">Musicplayer</h1>
          </div>
          <div className="deck-stats" aria-label="Catalog summary">
            <span>{tracks.length} tracks</span>
            <span>{new Set(tracks.map((track) => track.format).filter(Boolean)).size || 0} formats</span>
            <button className="mini-return-button" type="button" onClick={minimize}>Return to Mini Player</button>
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

            <div className="full-player-actions">
              <button type="button" onClick={minimize}>Return to Floating Mini Player</button>
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
        durations={durations}
      />
        </>
      )}
    </main>
  );
}
