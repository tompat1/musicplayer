import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SNAP_PX = 80;
const audioGraphs = new WeakMap();
const EQ_BANDS = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const DEFAULT_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const playerBrand = 'RYNELL PLAYER';

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

const isKeyboardControlTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="slider"], [data-player-shortcuts="ignore"]',
    ),
  );
};

const applyEqSettings = (graph, gains, enabled) => {
  if (!graph?.filters) return;
  graph.filters.forEach((filter, index) => {
    filter.gain.value = enabled ? gains[index] || 0 : 0;
  });
};

const ensureAudioGraph = async (audio, gains = DEFAULT_EQ_GAINS, enabled = true) => {
  if (!audio) return null;
  const existingGraph = audioGraphs.get(audio);

  if (existingGraph) {
    applyEqSettings(existingGraph, gains, enabled);
    await existingGraph.audioContext.resume();
    return existingGraph;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    const filters = EQ_BANDS.map((frequency, index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;

    source.connect(filters[0]);
    filters.forEach((filter, index) => {
      const nextNode = filters[index + 1] || analyser;
      filter.connect(nextNode);
    });
    analyser.connect(audioContext.destination);

    const graph = { analyser, audioContext, filters };
    audioGraphs.set(audio, graph);
    applyEqSettings(graph, gains, enabled);
    await audioContext.resume();
    return graph;
  } catch {
    return null;
  }
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
  const activePointerId = useRef(null);
  const thumbValue = clamp(value, 0.025, 0.975);

  const updateValue = useCallback(
    (event) => {
      const rect = sliderRef.current.getBoundingClientRect();
      if (!rect.width) return;
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
          activePointerId.current = event.pointerId;
          event.preventDefault();
          updateValue(event);
        }}
        onPointerMove={(event) => {
          event.preventDefault();
          if (activePointerId.current === event.pointerId) updateValue(event);
        }}
        onPointerUp={(event) => {
          if (activePointerId.current === event.pointerId) {
            activePointerId.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }
        }}
        onPointerCancel={(event) => {
          if (activePointerId.current === event.pointerId) {
            activePointerId.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onChange(clamp(value - 0.02, 0, 1));
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            onChange(clamp(value + 0.02, 0, 1));
          }
        }}
      >
        <span className="slider-fill" style={{ width: `${value * 100}%` }} />
        <span className="slider-thumb" style={{ left: `${thumbValue * 100}%` }} />
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

function SyncedCanvasVisualizer({ audioRef, playing, visualMode, eqGains, eqEnabled }) {
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
      graph = await ensureAudioGraph(audio, eqGains, eqEnabled);
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
  }, [audioRef, playing, visualMode, eqGains, eqEnabled]);

  return (
    <div className="synced-visualizers" aria-hidden="true">
      <canvas className="waviz-canvas" ref={canvasRef} width="1200" height="720" />
    </div>
  );
}

function VisualMode({ track, playing, audioRef, visualMode, eqGains, eqEnabled }) {
  return (
    <section className="visual-mode" data-playing={playing} data-visual-mode={visualMode} aria-label="Minimized music visualizer">
      <div className="visual-field" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span className="visual-wave" key={index} style={{ '--wave': index }} />
        ))}
        <div className="visual-prism" />
        <div className="visual-grid" />
      </div>
      <SyncedCanvasVisualizer
        audioRef={audioRef}
        playing={playing}
        visualMode={visualMode}
        eqGains={eqGains}
        eqEnabled={eqEnabled}
      />

      <div className="visual-title">
        <p className="eyebrow">Rynell Player visual mode</p>
        <h1>{track?.title || 'Musicplayer'}</h1>
        <p>{playing ? `${visualMode} visual locked to playback` : 'Ready for signal'}</p>
      </div>
    </section>
  );
}

function DockedMiniHandle({ side, playing, onRestore, onPrevious, onNext, onToggle }) {
  const isVertical = side === 'left' || side === 'right';

  return (
    <aside className={`dock-handle dock-${side}`} data-playing={playing} aria-label="Docked miniplayer">
      <button type="button" onClick={onPrevious} title="Previous track">
        {isVertical ? 'UP' : 'PREV'}
      </button>
      <button className="dock-pulse" type="button" onClick={onToggle} title={playing ? 'Pause' : 'Play'}>
        {Array.from({ length: 5 }, (_, index) => <span key={index} style={{ '--bar': index }} />)}
      </button>
      <button type="button" onClick={onRestore} title="Restore floating miniplayer">
        OPEN
      </button>
      <button type="button" onClick={onNext} title="Next track">
        {isVertical ? 'DN' : 'NEXT'}
      </button>
    </aside>
  );
}

function WinampWindowBar({ title, children, onPointerDown, onPointerMove, onPointerUp }) {
  return (
    <div
      className="winamp-window-bar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span className="winamp-title-lines" aria-hidden="true" />
      <strong>{title}</strong>
      <span className="winamp-title-lines" aria-hidden="true" />
      <div className="winamp-window-tools">{children}</div>
    </div>
  );
}

function WinampLedButton({ active, children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`winamp-led-button${className ? ` ${className}` : ''}`}
      data-active={active}
      aria-pressed={active}
      {...props}
    >
      <span aria-hidden="true" />
      {children}
    </button>
  );
}

function WinampTransportIcon({ type }) {
  return <span className={`winamp-transport-icon icon-${type}`} aria-hidden="true" />;
}

function WinampLcdSpectrum({ audioRef, playing, eqGains, eqEnabled }) {
  const [levels, setLevels] = useState(() => Array.from({ length: 18 }, () => 14));

  useEffect(() => {
    let frameId = 0;
    let cancelled = false;
    const audio = audioRef.current;

    const drawIdle = () => {
      setLevels((currentLevels) => currentLevels.map((_, index) => 10 + ((index * 13) % 18)));
    };

    const start = async () => {
      const graph = await ensureAudioGraph(audio, eqGains, eqEnabled);
      if (!graph || cancelled) {
        drawIdle();
        return;
      }

      const frequencyData = new Uint8Array(graph.analyser.frequencyBinCount);
      const draw = () => {
        graph.analyser.getByteFrequencyData(frequencyData);
        setLevels((currentLevels) => currentLevels.map((_, index) => {
          const bucketStart = Math.floor((index / currentLevels.length) * frequencyData.length);
          const bucketEnd = Math.max(bucketStart + 1, Math.floor(((index + 1) / currentLevels.length) * frequencyData.length));
          let peak = 0;
          for (let i = bucketStart; i < bucketEnd; i += 1) peak = Math.max(peak, frequencyData[i]);
          return clamp(Math.round((peak / 255) * 92), 8, 94);
        }));
        frameId = requestAnimationFrame(draw);
      };

      draw();
    };

    if (playing) start();
    else drawIdle();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [audioRef, playing, eqEnabled, eqGains]);

  return (
    <div className="winamp-lcd-bars" aria-hidden="true">
      {levels.map((level, index) => (
        <span key={index} data-playing={playing} style={{ '--bar': index, '--level': `${level}%` }} />
      ))}
    </div>
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
  shuffle,
  repeat,
  eqEnabled,
  eqGains,
  eqPanelOpen,
  audioRef,
  onSeek,
  onVolumeChange,
  onToggle,
  onStop,
  onPrevious,
  onNext,
  onToggleShuffle,
  onToggleRepeat,
  onToggleEq,
  onToggleEqPanel,
  onEqGainChange,
  onEqReset,
  onRestore,
  onSelect,
  onTogglePlaylist,
  onVisualModeChange,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
  playerRef,
  canOpenFullPlayer,
}) {
  const style = position ? { left: position.x, top: position.y } : undefined;
  const bitrate = track?.bitrate || (track?.source === 'google-flow' ? 'FLOW' : '320');
  const format = track?.format || 'AUDIO';

  return (
    <aside ref={playerRef} className="winamp-mini" data-skin="classic" style={style} aria-label="Floating Winamp miniplayer">
      {dragging && <div className="dock-hint">Drag to edge to dock</div>}
      <section className="winamp-panel winamp-player-panel" aria-label="Rynell player">
        <WinampWindowBar
          title={playerBrand}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
        >
          {canOpenFullPlayer && <button type="button" onClick={onRestore} title="Open full-page player">FULL</button>}
          <button type="button" aria-label="Decorative minimize control">_</button>
          <button type="button" aria-label="Decorative close control">x</button>
        </WinampWindowBar>

        <div className="winamp-player-body">
          <div className="winamp-led-stack" aria-hidden="true">
            {['O', 'A', 'I', 'D', 'V'].map((letter) => <span key={letter}>{letter}</span>)}
          </div>

          <div className="winamp-time-display">
            <span className="winamp-play-indicator">{playing ? '>' : '||'}</span>
            <strong>{formatTime(currentTime)}</strong>
            <WinampLcdSpectrum audioRef={audioRef} playing={playing} eqGains={eqGains} eqEnabled={eqEnabled} />
          </div>

          <div className="winamp-track-display">
            <div className="winamp-marquee">
              <span data-playing={playing}>{(track?.title || 'No Tracks Loaded').toUpperCase()}</span>
            </div>
            <div className="winamp-meter" aria-hidden="true">
              {Array.from({ length: 20 }, (_, index) => (
                <span key={index} data-playing={playing} style={{ '--bar': index }} />
              ))}
            </div>
            <div className="winamp-tech-row">
              <span>{bitrate} kbps</span>
              <span>{format}</span>
              <span>{track?.key || 'mono'}</span>
              <strong>{track?.bpm ? `${track.bpm} BPM` : durationLabel}</strong>
            </div>
          </div>
        </div>

        <div className="winamp-seek">
          <Slider label="Miniplayer progress" value={progress} onChange={onSeek} />
        </div>

        <div className="winamp-bottom-row">
          <div className="winamp-controls">
            <button type="button" onClick={onPrevious} title="Previous track">
              <WinampTransportIcon type="previous" />
            </button>
            <button type="button" onClick={onToggle} title={playing ? 'Pause' : 'Play'} data-active={!playing}>
              <WinampTransportIcon type="play" />
            </button>
            <button type="button" onClick={onToggle} title={playing ? 'Pause' : 'Play'} data-active={playing}>
              <WinampTransportIcon type="pause" />
            </button>
            <button type="button" onClick={onStop} title="Stop">
              <WinampTransportIcon type="stop" />
            </button>
            <button type="button" onClick={onNext} title="Next track">
              <WinampTransportIcon type="next" />
            </button>
          </div>

          <div className="winamp-volume">
            <span>VOL</span>
            <Slider label="Miniplayer volume" value={volume} onChange={onVolumeChange} />
            <strong>{Math.round(volume * 100)}</strong>
          </div>

          <div className="winamp-mode-buttons">
            <WinampLedButton active={shuffle} onClick={onToggleShuffle}>SHUFFLE</WinampLedButton>
            <WinampLedButton active={repeat} onClick={onToggleRepeat}>REPEAT</WinampLedButton>
          </div>
        </div>
      </section>

      <section className="winamp-panel winamp-eq-panel" aria-label="Winamp equalizer">
        <WinampWindowBar title="RYNELL EQUALIZER">
          <WinampLedButton active={eqEnabled} onClick={onToggleEq}>ON</WinampLedButton>
          <WinampLedButton active={eqPanelOpen} onClick={onToggleEqPanel}>EQ</WinampLedButton>
          <button type="button" onClick={onEqReset}>AUTO</button>
        </WinampWindowBar>
        <div className="winamp-eq-body" data-open={eqPanelOpen}>
          <div className="winamp-preamp">
            <span>PREAMP</span>
            <i aria-hidden="true" />
          </div>
          {EQ_BANDS.map((band, index) => (
            <div className="winamp-eq-band" key={band} style={{ '--eq-gain': eqGains[index] }}>
              <input
                type="range"
                min="-12"
                max="12"
                step="1"
                value={eqGains[index]}
                onChange={(event) => onEqGainChange(index, Number(event.target.value))}
                aria-label={`${band} hertz EQ gain`}
              />
              <span>{band >= 1000 ? `${band / 1000}K` : band}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="winamp-panel winamp-playlist-panel" aria-label="Winamp playlist">
        <WinampWindowBar title="RYNELL PLAYLIST">
          <WinampLedButton active={playlistOpen} onClick={onTogglePlaylist} aria-expanded={playlistOpen}>PL</WinampLedButton>
        </WinampWindowBar>

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

        <div className="winamp-songlist" role="list" data-open={playlistOpen}>
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
                  <span>{`${index + 1}.`}</span>
                  <strong>{playlistTrack.title}</strong>
                  <small>{getPlaylistDuration(playlistTrack, index, durations, currentIndex, 0)}</small>
                </button>
              );
            })
          )}
        </div>

        <div className="winamp-playlist-footer">
          <strong>{formatTime(currentTime)}/{durationLabel}</strong>
        </div>
      </section>
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
  const [isMobile, setIsMobile] = useState(false);
  const [eqEnabled, setEqEnabled] = useState(true);
  const [eqGains, setEqGains] = useState(DEFAULT_EQ_GAINS);
  const [eqPanelOpen, setEqPanelOpen] = useState(true);

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
    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const syncMobileMode = () => {
      const matches = mediaQuery.matches;
      setIsMobile(matches);
      if (matches) {
        setIsMinimized(true);
        setDocked(null);
        setMiniPosition(null);
      }
    };

    syncMobileMode();
    mediaQuery.addEventListener('change', syncMobileMode);
    return () => mediaQuery.removeEventListener('change', syncMobileMode);
  }, []);

  useEffect(() => {
    const keepMiniInViewport = () => {
      setMiniPosition((position) => {
        if (!position || !miniRef.current) return position;
        const width = miniRef.current.offsetWidth || 292;
        const height = miniRef.current.offsetHeight || 240;
        return {
          x: clamp(position.x, 0, Math.max(0, window.innerWidth - width)),
          y: clamp(position.y, 0, Math.max(0, window.innerHeight - height)),
        };
      });
    };

    window.addEventListener('resize', keepMiniInViewport);
    window.addEventListener('orientationchange', keepMiniInViewport);
    return () => {
      window.removeEventListener('resize', keepMiniInViewport);
      window.removeEventListener('orientationchange', keepMiniInViewport);
    };
  }, []);

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

    if (isPlaying) {
      ensureAudioGraph(audio, eqGains, eqEnabled)
        .then(() => audio.play())
        .catch(() => setIsPlaying(false));
    }
  }, [currentTrack]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const graph = audioGraphs.get(audioRef.current);
    if (graph) applyEqSettings(graph, eqGains, eqEnabled);
  }, [eqEnabled, eqGains]);

  const setTrackDuration = useCallback((filename, seconds) => {
    setDurations((currentDurations) => {
      if (!filename || currentDurations[filename]) return currentDurations;
      return {
        ...currentDurations,
        [filename]: seconds ? formatTime(seconds) : '--:--',
      };
    });
  }, []);

  const play = useCallback(async () => {
    if (!audioRef.current || !currentTrack) return;
    try {
      await ensureAudioGraph(audioRef.current, eqGains, eqEnabled);
      await audioRef.current.play();
      setIsPlaying(true);
      setAudioError('');
    } catch {
      setIsPlaying(false);
      setAudioError('This track could not start. If it is from Google Flow, use a direct audio file URL or download/export it locally.');
    }
  }, [currentTrack, eqEnabled, eqGains]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  }, []);

  const seek = useCallback((percent) => {
    const audio = audioRef.current;
    if (!audio?.duration) return;
    audio.currentTime = percent * audio.duration;
    setProgress(percent);
    setCurrentTime(percent * audio.duration);
  }, []);

  const previous = useCallback(() => {
    if (!tracks.length) return;
    if (audioRef.current?.currentTime > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    setTrackIndex((index) => (index - 1 + tracks.length) % tracks.length);
  }, [tracks.length]);

  const next = useCallback(() => {
    if (!tracks.length) return;
    if (shuffle) setTrackIndex(Math.floor(Math.random() * tracks.length));
    else setTrackIndex((index) => (index + 1) % tracks.length);
  }, [shuffle, tracks.length]);

  const selectTrack = (index) => {
    setTrackIndex(index);
    setIsPlaying(true);
  };

  const setEqGain = useCallback((index, gain) => {
    setEqGains((currentGains) => currentGains.map((currentGain, gainIndex) => (
      gainIndex === index ? clamp(gain, -12, 12) : currentGain
    )));
  }, []);

  const resetEq = useCallback(() => {
    setEqGains(DEFAULT_EQ_GAINS);
  }, []);

  const minimize = useCallback(() => {
    setIsMinimized(true);
    setDocked(null);
  }, []);

  const restoreFullPlayer = useCallback(() => {
    if (isMobile) return;
    setIsMinimized(false);
    setDocked(null);
  }, [isMobile]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isKeyboardControlTarget(event.target)) return;

      const shortcut = event.code || event.key;

      switch (shortcut) {
        case 'Space':
        case 'KeyK':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          previous();
          break;
        case 'ArrowRight':
          event.preventDefault();
          next();
          break;
        case 'ArrowUp':
          event.preventDefault();
          setIsMuted(false);
          setVolume((value) => clamp(value + 0.05, 0, 1));
          break;
        case 'ArrowDown':
          event.preventDefault();
          setVolume((value) => clamp(value - 0.05, 0, 1));
          break;
        case 'KeyM':
          event.preventDefault();
          setIsMuted((value) => !value);
          break;
        case 'KeyF':
          event.preventDefault();
          if (isMinimized) restoreFullPlayer();
          else minimize();
          break;
        case 'MediaPlayPause':
          event.preventDefault();
          togglePlay();
          break;
        case 'MediaTrackPrevious':
          event.preventDefault();
          previous();
          break;
        case 'MediaTrackNext':
          event.preventDefault();
          next();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMinimized, next, previous, restoreFullPlayer, togglePlay]);

  const onMiniTitlePointerDown = useCallback((event) => {
    if (isMobile) return;
    if (event.target.tagName === 'BUTTON') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const rect = miniRef.current.getBoundingClientRect();
    miniDragOffset.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    miniDragging.current = true;
    setIsDraggingMini(true);
    setDocked(null);
  }, [isMobile]);

  const onMiniTitlePointerMove = useCallback((event) => {
    if (!miniDragging.current) return;
    event.preventDefault();
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

    if (!isMobile && closestSide[1] <= SNAP_PX) {
      setDocked(closestSide[0]);
      return;
    }

    setMiniPosition({ x, y });
  }, [isMobile]);

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
          {!isMobile && (
            <VisualMode
              track={currentTrack}
              playing={isPlaying}
              audioRef={audioRef}
              visualMode={visualMode}
              eqGains={eqGains}
              eqEnabled={eqEnabled}
            />
          )}
          {docked ? (
            <DockedMiniHandle
              side={docked}
              playing={isPlaying}
              onRestore={() => setDocked(null)}
              onPrevious={previous}
              onNext={next}
              onToggle={togglePlay}
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
              shuffle={shuffle}
              repeat={repeat}
              eqEnabled={eqEnabled}
              eqGains={eqGains}
              eqPanelOpen={eqPanelOpen}
              audioRef={audioRef}
              onSeek={seek}
              onVolumeChange={setVolume}
              onToggle={togglePlay}
              onStop={stop}
              onPrevious={previous}
              onNext={next}
              onToggleShuffle={() => setShuffle((value) => !value)}
              onToggleRepeat={() => setRepeat((value) => !value)}
              onToggleEq={() => setEqEnabled((value) => !value)}
              onToggleEqPanel={() => setEqPanelOpen((value) => !value)}
              onEqGainChange={setEqGain}
              onEqReset={resetEq}
              onRestore={restoreFullPlayer}
              onSelect={selectTrack}
              onTogglePlaylist={() => setMiniPlaylistOpen((value) => !value)}
              onVisualModeChange={setVisualMode}
              onTitlePointerDown={onMiniTitlePointerDown}
              onTitlePointerMove={onMiniTitlePointerMove}
              onTitlePointerUp={onMiniTitlePointerUp}
              playerRef={miniRef}
              canOpenFullPlayer={!isMobile}
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
          </div>
        </div>

        <div className="full-player-actions">
          <button type="button" onClick={minimize}>
            <span>Mini Player</span>
            <strong>Return to Floating Winamp Mini</strong>
          </button>
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
        durations={durations}
      />
        </>
      )}
    </main>
  );
}
