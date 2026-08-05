import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PANEL_SNAP_PX = 34;
const audioGraphs = new WeakMap();
const EQ_BANDS = [70, 180, 320, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const DEFAULT_EQ_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const BUILT_IN_EQ_PRESETS = {
  None: DEFAULT_EQ_GAINS,
  'Bass Boost': [8, 7, 5, 2, 0, -1, -2, -2, -1, 0],
  Electronica: [6, 5, 2, 0, -2, 3, 5, 6, 5, 4],
  Disco: [5, 4, 1, -2, -1, 2, 4, 5, 4, 3],
  Rock: [6, 4, 2, -1, -2, 2, 4, 5, 4, 3],
  Classical: [0, 0, 0, 1, 2, 2, 1, 1, 2, 3],
  Classic: [4, 3, 2, 1, 0, 1, 2, 3, 3, 2],
};
const EQ_GAIN_MULTIPLIER = 1.75;
const EQ_PRESETS_STORAGE_KEY = 'rynell-player-eq-presets';
const CUSTOM_TITLES_STORAGE_KEY = 'rynell-player-custom-titles';
const DELETED_TRACKS_STORAGE_KEY = 'rynell-player-deleted-tracks';
const FAVORITE_TRACKS_STORAGE_KEY = 'rynell-player-favorite-tracks';
const LAST_TRACK_STORAGE_KEY = 'rynell-player-last-track';
const PLAYBACK_POSITION_STORAGE_KEY = 'rynell-player-playback-position';
const PANEL_POSITIONS_STORAGE_KEY = 'rynell-player-panel-positions';
const PANEL_SIZES_STORAGE_KEY = 'rynell-player-panel-sizes';
const LIBRARY_SIZE_STORAGE_KEY = 'rynell-player-library-size';
const STORAGE_CONSENT_KEY = 'rynell-player-storage-consent';
const playerBrand = 'RYNELL PLAYER';
const EMPTY_PANEL_OFFSETS = { eq: null, playlist: null };
const DEFAULT_LIBRARY_SIZE = { width: 420, height: null };
const MIN_LIBRARY_WIDTH = 360;
const MIN_LIBRARY_HEIGHT = 420;
const MIN_PLAYLIST_WIDTH = 260;
const MIN_PLAYLIST_HEIGHT = 190;
const STORAGE_CONSENT_VERSION = 1;
const DEFAULT_STORAGE_CONSENT = {
  version: STORAGE_CONSENT_VERSION,
  necessary: true,
  preferences: false,
  playback: false,
  library: false,
  acceptedAt: '',
};

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const parseDurationLabel = (label) => {
  if (typeof label !== 'string') return 0;
  const parts = label.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => (total * 60) + part, 0);
};

const sortFavoritesFirst = (items, getTrack = (item) => item) => (
  [...items].sort((a, b) => {
    const aFavorite = getTrack(a).favorite ? 1 : 0;
    const bFavorite = getTrack(b).favorite ? 1 : 0;
    return bFavorite - aFavorite;
  })
);

const isPanelDetached = (position) => Boolean(position);

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

const getLibraryTitle = (track) => {
  if (track?.displayTitle) return track.displayTitle;
  const mix = track?.mix || track?.version;
  const titleParts = [track?.title, mix && `(${mix})`, track?.artist && `by ${track.artist}`].filter(Boolean);
  return titleParts.join(' ');
};

const getTrackTitle = (track) => getLibraryTitle(track) || track?.title || 'No Tracks Loaded';

const getLibraryDetails = (track) => {
  const source = track?.source === 'google-flow' ? 'Google Flow' : track?.filename;
  return [source, track?.key, track?.bpm && `${track.bpm} BPM`].filter(Boolean).join(' / ');
};

const shuffleIndexes = (length, currentIndex = -1) => {
  const indexes = Array.from({ length }, (_, index) => index).filter((index) => index !== currentIndex);

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  return indexes;
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
  const now = graph.audioContext.currentTime;
  graph.filters.forEach((filter, index) => {
    const targetGain = enabled ? (gains[index] || 0) * EQ_GAIN_MULTIPLIER : 0;
    filter.gain.cancelScheduledValues(now);
    filter.gain.setTargetAtTime(targetGain, now, 0.015);
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
    const compressor = audioContext.createDynamicsCompressor();
    const filters = EQ_BANDS.map((frequency, index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = index === 0 || index === EQ_BANDS.length - 1 ? 0.7 : 1.35;
      filter.gain.value = 0;
      return filter;
    });

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    compressor.threshold.value = -8;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.18;

    source.connect(filters[0]);
    filters.forEach((filter, index) => {
      const nextNode = filters[index + 1] || analyser;
      filter.connect(nextNode);
    });
    analyser.connect(compressor);
    compressor.connect(audioContext.destination);

    const graph = { analyser, audioContext, compressor, filters };
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
    <div
      className="slider-field"
      aria-label={label}
      onPointerDown={(event) => {
        if (!sliderRef.current) return;
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
    >
      <div
        ref={sliderRef}
        className="slider-track"
        role="slider"
        aria-label={label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(value * 100)}
        tabIndex="0"
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
  const title = getTrackTitle(track);

  return (
    <div className="cover-stage" data-playing={playing}>
      {track?.cover ? (
        <img src={track.cover} alt={`${title} cover art`} />
      ) : (
        <div className="generated-cover" aria-label={`${title} cover fallback`}>
          <span>{title.slice(0, 2).toUpperCase() || 'MP'}</span>
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
  const title = getTrackTitle(track);

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
        <h1>{title || 'Musicplayer'}</h1>
        <p>{playing ? `${visualMode} visual locked to playback` : 'Ready for signal'}</p>
      </div>
    </section>
  );
}

function WinampWindowBar({
  title,
  children,
  quiet = false,
  hint,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}) {
  return (
    <div
      className={`winamp-window-bar${quiet ? ' is-quiet' : ''}`}
      title={hint}
      onDoubleClick={onDoubleClick}
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

function PanelDragHandle({ panel, label, detached = false, onPointerDown, onPointerMove, onPointerUp }) {
  const hint = detached ? `Drag ${label}. Double-click title bar to reattach.` : `Drag ${label} to detach.`;
  return (
    <button
      type="button"
      className="winamp-panel-drag-handle"
      aria-label={`Move ${label}`}
      title={hint}
      onPointerDown={(event) => (panel ? onPointerDown(panel, event) : onPointerDown(event))}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
  );
}

function ResizeHandle({ label, axis = 'both', onPointerDown, onPointerMove, onPointerUp }) {
  return (
    <button
      type="button"
      className="panel-resize-handle"
      data-axis={axis}
      aria-label={`Resize ${label}`}
      title={`Resize ${label}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
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
  panelOffsets,
  activePanel,
  panelSizes,
  playlistOpen,
  durations,
  volume,
  visualMode,
  shuffle,
  repeat,
  eqEnabled,
  eqGains,
  eqPanelOpen,
  eqPresets,
  activeEqPreset,
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
  onEqPresetLoad,
  onEqPresetSave,
  onRestore,
  onSelect,
  onEditTitle,
  onDeleteTrack,
  onToggleFavorite,
  onTogglePlaylist,
  onVisualModeChange,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
  onPanelPointerDown,
  onPanelPointerMove,
  onPanelPointerUp,
  onPanelReattach,
  onPanelResizePointerDown,
  onPanelResizePointerMove,
  onPanelResizePointerUp,
  playerRef,
  canOpenFullPlayer,
}) {
  const playerDetached = canOpenFullPlayer && Boolean(panelOffsets.eq || panelOffsets.playlist);
  const style = !playerDetached && position ? { left: position.x, top: position.y } : undefined;
  const playerStyle = playerDetached && position ? {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: activePanel === 'player' ? 8 : 7,
  } : undefined;
  const getPanelStyle = (panel) => {
    if (!canOpenFullPlayer) return undefined;
    const panelPosition = panelOffsets[panel];
    if (!panelPosition) {
      const panelSize = panelSizes[panel];
      return panelSize ? { height: panelSize.height } : undefined;
    }
    return {
      position: 'fixed',
      left: panelPosition.x,
      top: panelPosition.y,
      width: panelPosition.width,
      height: panelPosition.height,
      zIndex: activePanel === panel ? 8 : 6,
    };
  };
  const getPanelSlotStyle = (panel) => {
    if (!canOpenFullPlayer) return undefined;
    const panelPosition = panelOffsets[panel];
    if (panelPosition) return { width: panelPosition.width };
    return undefined;
  };
  const bitrate = track?.bitrate || (track?.source === 'google-flow' ? 'FLOW' : '320');
  const format = track?.format || 'AUDIO';
  const trackTitle = getTrackTitle(track).toUpperCase();
  const marqueeRef = useRef(null);
  const marqueeTextRef = useRef(null);
  const [titleOverflowing, setTitleOverflowing] = useState(false);
  const playlistTracks = useMemo(() => (
    sortFavoritesFirst(tracks.map((playlistTrack, index) => ({ playlistTrack, index })), (item) => item.playlistTrack)
  ), [tracks]);

  useEffect(() => {
    const marquee = marqueeRef.current;
    const text = marqueeTextRef.current;
    if (!marquee || !text) return undefined;

    const syncOverflow = () => {
      const overflowWidth = Math.max(0, text.scrollWidth - marquee.clientWidth);
      setTitleOverflowing(overflowWidth > 2);
      text.style.setProperty('--scroll-distance', `${overflowWidth}px`);
    };

    syncOverflow();
    const resizeObserver = new ResizeObserver(syncOverflow);
    resizeObserver.observe(marquee);
    resizeObserver.observe(text);
    return () => resizeObserver.disconnect();
  }, [trackTitle]);

  return (
    <aside ref={playerRef} className="winamp-mini" data-skin="classic" style={style} aria-label="Floating Winamp miniplayer">
      <section
        className="winamp-panel winamp-player-panel"
        style={playerStyle}
        data-detached={playerDetached}
        data-moving={activePanel === 'player'}
        aria-label="Rynell player"
      >
        <PanelDragHandle
          label="player"
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
        />
        <WinampWindowBar
          title={playerBrand}
          quiet
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
            <div className="winamp-marquee" ref={marqueeRef} data-overflowing={titleOverflowing}>
              <span ref={marqueeTextRef} data-overflowing={titleOverflowing}>{trackTitle}</span>
            </div>
            <div className="winamp-tech-row">
              <span>{bitrate} kbps</span>
              <span>{format}</span>
              <span>{track?.key || 'stereo'}</span>
              <strong>{track?.bpm ? `${track.bpm} BPM` : durationLabel}</strong>
            </div>
          </div>
        </div>

        <div className="winamp-bottom-row">
          <div className="winamp-slider-row">
            <label className="winamp-slider-control">
              <span>SONG</span>
              <Slider label="Song position" value={progress} onChange={onSeek} />
            </label>
            <label className="winamp-slider-control">
              <span>VOL</span>
              <Slider label="Volume" value={volume} onChange={onVolumeChange} />
              <strong>{Math.round(volume * 100)}</strong>
            </label>
          </div>

          <div className="winamp-controls">
            <button type="button" onClick={onPrevious} title="Previous track">
              <WinampTransportIcon type="previous" />
            </button>
            <button type="button" onClick={onToggle} title={playing ? 'Pause' : 'Play'} data-active={playing}>
              <WinampTransportIcon type={playing ? 'pause' : 'play'} />
            </button>
            <button type="button" onClick={onStop} title="Stop">
              <WinampTransportIcon type="stop" />
            </button>
            <button type="button" onClick={onNext} title="Next track">
              <WinampTransportIcon type="next" />
            </button>
            <WinampLedButton active={shuffle} onClick={onToggleShuffle}>SHUFFLE</WinampLedButton>
            <WinampLedButton active={repeat} onClick={onToggleRepeat}>REPEAT</WinampLedButton>
          </div>
        </div>
      </section>

      <div className="winamp-panel-slot" style={getPanelSlotStyle('eq')} data-empty={isPanelDetached(panelOffsets.eq)}>
        <section
          className="winamp-panel winamp-eq-panel"
          style={getPanelStyle('eq')}
          data-detached={canOpenFullPlayer && isPanelDetached(panelOffsets.eq)}
          data-moving={activePanel === 'eq'}
          aria-label="Winamp equalizer"
        >
          <PanelDragHandle
            panel="eq"
            label="equalizer"
            detached={canOpenFullPlayer && isPanelDetached(panelOffsets.eq)}
            onPointerDown={onPanelPointerDown}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
          />
          <WinampWindowBar
            title="RYNELL EQUALIZER"
            hint={isPanelDetached(panelOffsets.eq) ? 'Drag to move. Double-click to reattach equalizer.' : 'Drag to detach equalizer.'}
            onDoubleClick={() => onPanelReattach('eq')}
            onPointerDown={(event) => onPanelPointerDown('eq', event)}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
          >
          <WinampLedButton active={eqEnabled} onClick={onToggleEq}>ON</WinampLedButton>
          <WinampLedButton active={eqPanelOpen} onClick={onToggleEqPanel}>EQ</WinampLedButton>
          <select
            className="winamp-preset-select"
            value={activeEqPreset}
            onChange={(event) => {
              if (event.target.value) onEqPresetLoad(event.target.value);
            }}
            aria-label="Load EQ preset"
          >
            <option value="">PRESET</option>
            {Object.keys(BUILT_IN_EQ_PRESETS).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            {Object.keys(eqPresets).length > 0 && <option value="" disabled>-- SAVED --</option>}
            {Object.keys(eqPresets).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button type="button" onClick={onEqPresetSave}>SAVE</button>
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
                min="-15"
                max="15"
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
      </div>

      <div className="winamp-panel-slot" style={getPanelSlotStyle('playlist')} data-empty={isPanelDetached(panelOffsets.playlist)}>
        <section
          className="winamp-panel winamp-playlist-panel"
          style={getPanelStyle('playlist')}
          data-detached={canOpenFullPlayer && isPanelDetached(panelOffsets.playlist)}
          data-moving={activePanel === 'playlist'}
          aria-label="Winamp playlist"
        >
          <PanelDragHandle
            panel="playlist"
            label="playlist"
            detached={canOpenFullPlayer && isPanelDetached(panelOffsets.playlist)}
            onPointerDown={onPanelPointerDown}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
          />
          <WinampWindowBar
            title="RYNELL PLAYLIST"
            hint={isPanelDetached(panelOffsets.playlist) ? 'Drag to move. Double-click to reattach playlist.' : 'Drag to detach playlist.'}
            onDoubleClick={() => onPanelReattach('playlist')}
            onPointerDown={(event) => onPanelPointerDown('playlist', event)}
            onPointerMove={onPanelPointerMove}
            onPointerUp={onPanelPointerUp}
          >
          <WinampLedButton active={playlistOpen} onClick={onTogglePlaylist} aria-expanded={playlistOpen}>PL</WinampLedButton>
        </WinampWindowBar>

        <div className="winamp-vis-row" aria-label="Visualizer mode">
          <span>VISUALS</span>
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
            playlistTracks.map(({ playlistTrack, index }) => {
              const isActive = index === currentIndex;
              return (
                <div
                  key={playlistTrack.filename}
                  className="winamp-song-row"
                  data-active={isActive}
                  data-favorite={playlistTrack.favorite}
                  role="listitem"
                >
                  <button type="button" className="winamp-song-select" onClick={() => onSelect(index)}>
                    <span>{playlistTrack.favorite ? 'FAV' : `${index + 1}.`}</span>
                    <strong>{getTrackTitle(playlistTrack)}</strong>
                    <small>{getPlaylistDuration(playlistTrack, index, durations, currentIndex, 0)}</small>
                  </button>
                  <span className="winamp-song-actions">
                    <button
                      type="button"
                      aria-pressed={playlistTrack.favorite}
                      data-active={playlistTrack.favorite}
                      onClick={() => onToggleFavorite(playlistTrack)}
                      title={`${playlistTrack.favorite ? 'Remove favorite' : 'Favorite'} ${getTrackTitle(playlistTrack)}`}
                    >
                      Fav
                    </button>
                    <button type="button" onClick={() => onEditTitle(playlistTrack)} title={`Edit title for ${getTrackTitle(playlistTrack)}`}>
                      Edit
                    </button>
                    <button type="button" onClick={() => onDeleteTrack(playlistTrack)} title={`Hide ${getTrackTitle(playlistTrack)} from library`}>
                      Hide
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="winamp-playlist-footer" />
        {canOpenFullPlayer && (
          <ResizeHandle
            label="playlist"
            axis={isPanelDetached(panelOffsets.playlist) ? 'both' : 'vertical'}
            onPointerDown={(event) => onPanelResizePointerDown('playlist', event)}
            onPointerMove={onPanelResizePointerMove}
            onPointerUp={onPanelResizePointerUp}
          />
        )}
        </section>
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

function readLocalStorageJson(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    return JSON.parse(window.localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorageJson(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function StorageConsentModal() {
  const [consent, setConsent] = useState(() => readLocalStorageJson(STORAGE_CONSENT_KEY, null));
  const [draft, setDraft] = useState(() => ({
    ...DEFAULT_STORAGE_CONSENT,
    ...readLocalStorageJson(STORAGE_CONSENT_KEY, {}),
  }));
  const [open, setOpen] = useState(() => {
    const storedConsent = readLocalStorageJson(STORAGE_CONSENT_KEY, null);
    return storedConsent?.version !== STORAGE_CONSENT_VERSION;
  });

  const saveConsent = useCallback((choices) => {
    const nextConsent = {
      ...DEFAULT_STORAGE_CONSENT,
      ...choices,
      necessary: true,
      version: STORAGE_CONSENT_VERSION,
      acceptedAt: new Date().toISOString(),
    };
    writeLocalStorageJson(STORAGE_CONSENT_KEY, nextConsent);
    setConsent(nextConsent);
    setDraft(nextConsent);
    setOpen(false);
  }, []);

  const toggleDraft = (key) => {
    setDraft((choices) => ({ ...choices, [key]: !choices[key] }));
  };

  return (
    <>
      <button className="storage-console-trigger" type="button" onClick={() => setOpen(true)}>
        PRIVACY
      </button>

      {open && (
        <div className="storage-modal-backdrop" role="presentation">
          <section
            className="storage-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="storage-modal-title"
          >
            <div className="storage-modal-header">
              <span aria-hidden="true">SYS-LOCAL</span>
              <button type="button" onClick={() => saveConsent(consent || draft)} aria-label="Close privacy settings">x</button>
            </div>

            <div className="storage-modal-body">
              <div>
                <p className="eyebrow">Storage permissions</p>
                <h2 id="storage-modal-title">Local Data Console</h2>
                <p>
                  This player uses browser local storage for playback recovery, panel layout, EQ presets, favorites,
                  deleted tracks, and custom titles. No third-party tracking is wired into this app.
                </p>
              </div>

              <div className="storage-category-list">
                <label className="storage-category" data-locked="true">
                  <input type="checkbox" checked readOnly />
                  <span>
                    <strong>Required system memory</strong>
                    <small>Needed to save your storage decision and keep the interface usable.</small>
                  </span>
                </label>

                <label className="storage-category">
                  <input
                    type="checkbox"
                    checked={draft.preferences}
                    onChange={() => toggleDraft('preferences')}
                  />
                  <span>
                    <strong>Interface preferences</strong>
                    <small>Remembers panel layout, mini-player state, skin-like controls, and EQ choices.</small>
                  </span>
                </label>

                <label className="storage-category">
                  <input
                    type="checkbox"
                    checked={draft.playback}
                    onChange={() => toggleDraft('playback')}
                  />
                  <span>
                    <strong>Playback continuity</strong>
                    <small>Restores the last track and playback position after a reload.</small>
                  </span>
                </label>

                <label className="storage-category">
                  <input
                    type="checkbox"
                    checked={draft.library}
                    onChange={() => toggleDraft('library')}
                  />
                  <span>
                    <strong>Library personalization</strong>
                    <small>Keeps favorites, renamed tracks, and hidden tracks on this device.</small>
                  </span>
                </label>
              </div>
            </div>

            <div className="storage-modal-actions">
              <button type="button" onClick={() => saveConsent(DEFAULT_STORAGE_CONSENT)}>
                Reject optional
              </button>
              <button type="button" onClick={() => saveConsent(draft)}>
                Save choices
              </button>
              <button
                className="storage-primary-action"
                type="button"
                onClick={() => saveConsent({
                  preferences: true,
                  playback: true,
                  library: true,
                })}
              >
                Accept all
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Playlist({
  tracks,
  currentIndex,
  playing,
  query,
  onQueryChange,
  onSelect,
  onEditTitle,
  onDeleteTrack,
  onToggleFavorite,
  liveDuration,
  durations,
  style,
  resizable,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
}) {
  const filteredTracks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchingTracks = tracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => {
        if (!normalizedQuery) return true;
        const haystack = [getTrackTitle(track), track.title, track.mix, track.version, track.format, track.bpm, track.key, track.filename]
          .concat(track.source, track.flowUrl)
          .concat(track.favorite ? 'favorite fav' : '')
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      });
    return sortFavoritesFirst(matchingTracks, (item) => item.track);
  }, [tracks, query]);

  return (
    <aside className="library-view" style={style} aria-label="Library playlist">
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
              <div
                className="track-row"
                key={track.filename}
                data-active={isActive}
                data-favorite={track.favorite}
                role="listitem"
              >
                <button
                  className="track-select"
                  type="button"
                  onClick={() => onSelect(index)}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className="track-number">{isActive && playing ? 'PLAY' : String(index + 1).padStart(2, '0')}</span>
                  <span className="track-thumb">
                    {track.cover ? <img src={track.cover} alt="" /> : <span>{getTrackTitle(track).slice(0, 1)}</span>}
                  </span>
                  <span className="track-main">
                    <strong>{getTrackTitle(track)}</strong>
                    <small>{getLibraryDetails(track)}</small>
                  </span>
                </button>
                <span className="track-tags">
                  {track.favorite && <span>FAV</span>}
                  {track.source === 'google-flow' && <span>FLOW</span>}
                  <span>{track.format || 'AUDIO'}</span>
                  <span>{getPlaylistDuration(track, index, durations, currentIndex, liveDuration)}</span>
                </span>
                <span className="track-actions">
                  <button
                    type="button"
                    aria-pressed={track.favorite}
                    data-active={track.favorite}
                    onClick={() => onToggleFavorite(track)}
                    title={`${track.favorite ? 'Remove favorite' : 'Favorite'} ${getTrackTitle(track)}`}
                  >
                    Fav
                  </button>
                  <button type="button" onClick={() => onEditTitle(track)} title={`Edit title for ${getTrackTitle(track)}`}>
                    Edit
                  </button>
                  <button type="button" onClick={() => onDeleteTrack(track)} title={`Hide ${getTrackTitle(track)} from library`}>
                    Hide
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
      {resizable && (
        <ResizeHandle
          label="library"
          axis="vertical"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      )}
    </aside>
  );
}

export default function AudioPlayer({ tracks: catalogTracks = [] }) {
  const [trackIndex, setTrackIndex] = useState(() => {
    const lastTrack = readLocalStorageJson(LAST_TRACK_STORAGE_KEY, null);
    if (!lastTrack?.filename) return 0;
    return Math.max(0, catalogTracks.findIndex((track) => track.filename === lastTrack.filename));
  });
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
  const [isDraggingMini, setIsDraggingMini] = useState(false);
  const [miniPlaylistOpen, setMiniPlaylistOpen] = useState(true);
  const [visualMode, setVisualMode] = useState('candy');
  const [isMobile, setIsMobile] = useState(false);
  const [librarySize, setLibrarySize] = useState(() => {
    const storedSize = readLocalStorageJson(LIBRARY_SIZE_STORAGE_KEY, DEFAULT_LIBRARY_SIZE);
    const width = Number(storedSize.width);
    const height = Number(storedSize.height);
    return {
      width: Number.isFinite(width) ? clamp(width, MIN_LIBRARY_WIDTH, 720) : DEFAULT_LIBRARY_SIZE.width,
      height: Number.isFinite(height) ? Math.max(MIN_LIBRARY_HEIGHT, height) : DEFAULT_LIBRARY_SIZE.height,
    };
  });
  const [panelOffsets, setPanelOffsets] = useState(() => {
    const storedPositions = readLocalStorageJson(PANEL_POSITIONS_STORAGE_KEY, {});
    const normalizePanelPosition = (position) => {
      if (!position) return null;
      const x = Number(position.x);
      const y = Number(position.y);
      const width = Number(position.width);
      const height = Number(position.height);
      if (![x, y, width, height].every(Number.isFinite)) return null;
      return { x, y, width, height };
    };
    return {
      eq: normalizePanelPosition(storedPositions.eq),
      playlist: normalizePanelPosition(storedPositions.playlist),
    };
  });
  const [panelSizes, setPanelSizes] = useState(() => {
    const storedSizes = readLocalStorageJson(PANEL_SIZES_STORAGE_KEY, {});
    const normalizePanelSize = (size) => {
      if (!size) return null;
      const width = Number(size.width);
      const height = Number(size.height);
      if (![width, height].every(Number.isFinite)) return null;
      return {
        width: Math.max(MIN_PLAYLIST_WIDTH, width),
        height: Math.max(MIN_PLAYLIST_HEIGHT, height),
      };
    };
    return {
      playlist: normalizePanelSize(storedSizes.playlist),
    };
  });
  const [activePanel, setActivePanel] = useState('');
  const [eqEnabled, setEqEnabled] = useState(true);
  const [eqGains, setEqGains] = useState(DEFAULT_EQ_GAINS);
  const [eqPanelOpen, setEqPanelOpen] = useState(true);
  const [activeEqPreset, setActiveEqPreset] = useState('');
  const [customTitles, setCustomTitles] = useState(() => readLocalStorageJson(CUSTOM_TITLES_STORAGE_KEY, {}));
  const [deletedTracks, setDeletedTracks] = useState(() => readLocalStorageJson(DELETED_TRACKS_STORAGE_KEY, []));
  const [favoriteTracks, setFavoriteTracks] = useState(() => readLocalStorageJson(FAVORITE_TRACKS_STORAGE_KEY, []));
  const [eqPresets, setEqPresets] = useState(() => {
    return readLocalStorageJson(EQ_PRESETS_STORAGE_KEY, {});
  });

  const audioRef = useRef(null);
  const miniRef = useRef(null);
  const miniDragging = useRef(false);
  const miniDragOffset = useRef({ x: 0, y: 0 });
  const panelDragging = useRef(null);
  const panelResizing = useRef(null);
  const libraryResizing = useRef(null);
  const shuffleQueue = useRef([]);
  const deletedTrackSet = useMemo(() => new Set(deletedTracks), [deletedTracks]);
  const favoriteTrackSet = useMemo(() => new Set(favoriteTracks), [favoriteTracks]);
  const tracks = useMemo(() => (
    catalogTracks
      .filter((track) => !deletedTrackSet.has(track.filename))
      .map((track) => {
        const customTitle = customTitles[track.filename];
        return {
          ...track,
          favorite: favoriteTrackSet.has(track.filename),
          ...(customTitle ? { displayTitle: customTitle } : {}),
        };
      })
  ), [catalogTracks, customTitles, deletedTrackSet, favoriteTrackSet]);
  const hasTracks = tracks.length > 0;
  const currentTrack = hasTracks ? tracks[trackIndex] : null;
  const hasDetachedPanels = Boolean(panelOffsets.eq || panelOffsets.playlist);
  const renderedPanelOffsets = isMobile ? EMPTY_PANEL_OFFSETS : panelOffsets;
  const shellStyle = !isMinimized && !isMobile
    ? { gridTemplateColumns: `minmax(0, 1fr) ${librarySize.width}px` }
    : undefined;
  const libraryStyle = !isMobile
    ? { height: librarySize.height ? `${librarySize.height}px` : undefined }
    : undefined;

  useEffect(() => {
    if (trackIndex > tracks.length - 1) setTrackIndex(0);
  }, [trackIndex, tracks.length]);

  useEffect(() => {
    if (!tracks.length) {
      setIsPlaying(false);
      setTrackIndex(0);
    }
  }, [tracks.length]);

  useEffect(() => {
    shuffleQueue.current = shuffleQueue.current.filter((index) => index < tracks.length && index !== trackIndex);
  }, [trackIndex, tracks.length]);

  useEffect(() => {
    if (!currentTrack?.filename) return;
    writeLocalStorageJson(LAST_TRACK_STORAGE_KEY, { filename: currentTrack.filename });
  }, [currentTrack]);

  useEffect(() => {
    writeLocalStorageJson(PANEL_POSITIONS_STORAGE_KEY, panelOffsets);
  }, [panelOffsets]);

  useEffect(() => {
    writeLocalStorageJson(PANEL_SIZES_STORAGE_KEY, panelSizes);
  }, [panelSizes]);

  useEffect(() => {
    writeLocalStorageJson(LIBRARY_SIZE_STORAGE_KEY, librarySize);
  }, [librarySize]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const syncMobileMode = () => {
      const matches = mediaQuery.matches;
      setIsMobile(matches);
      if (matches) {
        setIsMinimized(true);
        setMiniPosition(null);
      }
    };

    syncMobileMode();
    mediaQuery.addEventListener('change', syncMobileMode);
    return () => mediaQuery.removeEventListener('change', syncMobileMode);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    panelDragging.current = null;
    setActivePanel('');
  }, [isMobile]);

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

  const getNextShuffledIndex = useCallback((currentIndex = trackIndex) => {
    if (tracks.length <= 1) return currentIndex;
    shuffleQueue.current = shuffleQueue.current.filter((index) => index < tracks.length && index !== currentIndex);
    if (shuffleQueue.current.length === 0) {
      shuffleQueue.current = shuffleIndexes(tracks.length, currentIndex);
    }
    return shuffleQueue.current.shift() ?? currentIndex;
  }, [trackIndex, tracks.length]);

  useEffect(() => {
    if (!shuffle) shuffleQueue.current = [];
  }, [shuffle]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
      if (currentTrack?.filename) {
        writeLocalStorageJson(PLAYBACK_POSITION_STORAGE_KEY, {
          filename: currentTrack.filename,
          time: audio.currentTime,
        });
      }
    };
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (repeat) {
        audio.currentTime = 0;
        audio.play();
        return;
      }

      if (shuffle) {
        setTrackIndex((index) => getNextShuffledIndex(index));
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
  }, [currentTrack, getNextShuffledIndex, repeat, shuffle, trackIndex, tracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    audio.src = currentTrack.src;
    const savedPosition = readLocalStorageJson(PLAYBACK_POSITION_STORAGE_KEY, null);
    const savedTime = savedPosition?.filename === currentTrack.filename ? Math.max(0, Number(savedPosition.time) || 0) : 0;
    const applySavedPosition = () => {
      if (!savedTime || !Number.isFinite(audio.duration)) return;
      const nextTime = clamp(savedTime, 0, Math.max(0, audio.duration - 0.4));
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
      setProgress(audio.duration ? nextTime / audio.duration : 0);
    };
    setProgress(0);
    setCurrentTime(savedTime);
    setDuration(0);
    setAudioError('');
    audio.addEventListener('loadedmetadata', applySavedPosition, { once: true });

    if (isPlaying) {
      ensureAudioGraph(audio, eqGains, eqEnabled)
        .then(() => audio.play())
        .catch(() => setIsPlaying(false));
    }
    return () => audio.removeEventListener('loadedmetadata', applySavedPosition);
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
    if (!audio) return;
    const audioDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const fallbackDuration = duration || parseDurationLabel(currentTrack?.duration);
    const seekDuration = audioDuration || fallbackDuration;
    if (!seekDuration) return;
    const nextTime = percent * seekDuration;
    audio.currentTime = nextTime;
    setProgress(percent);
    setCurrentTime(nextTime);
  }, [currentTrack, duration]);

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
    if (shuffle) setTrackIndex((index) => getNextShuffledIndex(index));
    else setTrackIndex((index) => (index + 1) % tracks.length);
  }, [getNextShuffledIndex, shuffle, tracks.length]);

  const toggleShuffle = useCallback(() => {
    if (shuffle) {
      setShuffle(false);
      shuffleQueue.current = [];
      return;
    }

    setShuffle(true);
    if (tracks.length > 1) {
      setTrackIndex((index) => getNextShuffledIndex(index));
    }
  }, [getNextShuffledIndex, shuffle, tracks.length]);

  const selectTrack = (index) => {
    setTrackIndex(index);
    setIsPlaying(true);
  };

  const editTrackTitle = useCallback((track) => {
    if (!track?.filename) return;
    const currentTitle = getTrackTitle(track);
    const nextTitle = window.prompt('Edit track title:', currentTitle)?.trim();
    if (!nextTitle) return;

    setCustomTitles((currentTitles) => {
      const nextTitles = { ...currentTitles };
      if (nextTitle === track.displayTitle || nextTitle === track.title) delete nextTitles[track.filename];
      else nextTitles[track.filename] = nextTitle;
      window.localStorage.setItem(CUSTOM_TITLES_STORAGE_KEY, JSON.stringify(nextTitles));
      return nextTitles;
    });
  }, []);

  const deleteTrack = useCallback((track) => {
    if (!track?.filename) return;
    const title = getTrackTitle(track);
    if (!window.confirm(`Hide "${title}" from this library? The audio file will stay in the assets folder.`)) return;

    setDeletedTracks((currentDeletedTracks) => {
      if (currentDeletedTracks.includes(track.filename)) return currentDeletedTracks;
      const nextDeletedTracks = [...currentDeletedTracks, track.filename];
      window.localStorage.setItem(DELETED_TRACKS_STORAGE_KEY, JSON.stringify(nextDeletedTracks));
      return nextDeletedTracks;
    });

    setCustomTitles((currentTitles) => {
      if (!currentTitles[track.filename]) return currentTitles;
      const nextTitles = { ...currentTitles };
      delete nextTitles[track.filename];
      window.localStorage.setItem(CUSTOM_TITLES_STORAGE_KEY, JSON.stringify(nextTitles));
      return nextTitles;
    });

    setFavoriteTracks((currentFavoriteTracks) => {
      if (!currentFavoriteTracks.includes(track.filename)) return currentFavoriteTracks;
      const nextFavoriteTracks = currentFavoriteTracks.filter((filename) => filename !== track.filename);
      window.localStorage.setItem(FAVORITE_TRACKS_STORAGE_KEY, JSON.stringify(nextFavoriteTracks));
      return nextFavoriteTracks;
    });

    setTrackIndex((index) => clamp(index, 0, Math.max(0, tracks.length - 2)));
  }, [tracks.length]);

  const toggleFavorite = useCallback((track) => {
    if (!track?.filename) return;
    setFavoriteTracks((currentFavoriteTracks) => {
      const nextFavoriteTracks = currentFavoriteTracks.includes(track.filename)
        ? currentFavoriteTracks.filter((filename) => filename !== track.filename)
        : [...currentFavoriteTracks, track.filename];
      window.localStorage.setItem(FAVORITE_TRACKS_STORAGE_KEY, JSON.stringify(nextFavoriteTracks));
      return nextFavoriteTracks;
    });
  }, []);

  const setEqGain = useCallback((index, gain) => {
    setActiveEqPreset('');
    setEqGains((currentGains) => currentGains.map((currentGain, gainIndex) => (
      gainIndex === index ? clamp(gain, -15, 15) : currentGain
    )));
  }, []);

  const loadEqPreset = useCallback((name) => {
    const preset = BUILT_IN_EQ_PRESETS[name] || eqPresets[name];
    if (Array.isArray(preset) && preset.length === EQ_BANDS.length) {
      setEqGains(preset.map((gain) => clamp(Number(gain) || 0, -15, 15)));
      setActiveEqPreset(name);
      setEqEnabled(true);
    }
  }, [eqPresets]);

  const saveEqPreset = useCallback(() => {
    const fallbackName = `Preset ${Object.keys(eqPresets).length + 1}`;
    const name = window.prompt('Save EQ preset as:', fallbackName)?.trim();
    if (!name) return;

    setEqPresets((currentPresets) => {
      const nextPresets = {
        ...currentPresets,
        [name]: eqGains,
      };
      window.localStorage.setItem(EQ_PRESETS_STORAGE_KEY, JSON.stringify(nextPresets));
      setActiveEqPreset(name);
      return nextPresets;
    });
  }, [eqGains, eqPresets]);

  const minimize = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const restoreFullPlayer = useCallback(() => {
    if (isMobile) return;
    setIsMinimized(false);
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
    if (event.target.tagName === 'BUTTON' && !event.target.closest('.winamp-panel-drag-handle')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const dragElement = hasDetachedPanels
      ? event.currentTarget.closest('.winamp-player-panel')
      : miniRef.current;
    const rect = (dragElement || miniRef.current).getBoundingClientRect();
    miniDragOffset.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    miniDragging.current = true;
    setIsDraggingMini(true);
    setActivePanel('player');
  }, [hasDetachedPanels, isMobile]);

  const onMiniTitlePointerMove = useCallback((event) => {
    if (!miniDragging.current) return;
    event.preventDefault();
    const dragElement = hasDetachedPanels
      ? event.currentTarget.closest('.winamp-player-panel')
      : miniRef.current;
    const width = dragElement?.offsetWidth || 320;
    const height = dragElement?.offsetHeight || 190;
    const x = clamp(event.clientX - miniDragOffset.current.x, 0, window.innerWidth - width);
    const y = clamp(event.clientY - miniDragOffset.current.y, 0, window.innerHeight - height);
    setMiniPosition({ x, y });
  }, [hasDetachedPanels]);

  const onMiniTitlePointerUp = useCallback((event) => {
    if (!miniDragging.current) return;
    miniDragging.current = false;
    setIsDraggingMini(false);
    setActivePanel('');

    const dragElement = hasDetachedPanels
      ? event.currentTarget.closest('.winamp-player-panel')
      : miniRef.current;
    const width = dragElement?.offsetWidth || 320;
    const height = dragElement?.offsetHeight || 190;
    const x = clamp(event.clientX - miniDragOffset.current.x, 0, window.innerWidth - width);
    const y = clamp(event.clientY - miniDragOffset.current.y, 0, window.innerHeight - height);
    setMiniPosition({ x, y });
  }, [hasDetachedPanels]);

  const onPanelPointerDown = useCallback((panel, event) => {
    if (isMobile) return;
    if (event.target.closest('.winamp-window-tools')) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panelElement = event.currentTarget.closest('.winamp-panel');
    const rect = panelElement?.getBoundingClientRect();
    const homeRect = panelElement?.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const origin = panelOffsets[panel] || {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    panelDragging.current = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      home: {
        x: homeRect?.left ?? rect.left,
        y: homeRect?.top ?? rect.top,
        width: homeRect?.width ?? rect.width,
        height: homeRect?.height ?? rect.height,
      },
    };
    setPanelOffsets((offsets) => ({
      ...offsets,
      [panel]: origin,
    }));
    setActivePanel(panel);
  }, [isMobile, panelOffsets]);

  const onPanelPointerMove = useCallback((event) => {
    const drag = panelDragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const nextOffset = {
      x: drag.origin.x + event.clientX - drag.startX,
      y: drag.origin.y + event.clientY - drag.startY,
      width: drag.origin.width,
      height: drag.origin.height,
    };
    setPanelOffsets((offsets) => ({
      ...offsets,
      [drag.panel]: nextOffset,
    }));
  }, []);

  const onPanelPointerUp = useCallback((event) => {
    const drag = panelDragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    panelDragging.current = null;

    setPanelOffsets((offsets) => {
      const position = offsets[drag.panel] || drag.origin;
      const shouldSnapHome = Math.hypot(position.x - drag.home.x, position.y - drag.home.y) <= PANEL_SNAP_PX;
      return {
        ...offsets,
        [drag.panel]: shouldSnapHome ? null : position,
      };
    });
    setActivePanel('');

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onPanelReattach = useCallback((panel) => {
    if (isMobile) return;
    panelDragging.current = null;
    panelResizing.current = null;
    setActivePanel('');
    setPanelOffsets((offsets) => ({
      ...offsets,
      [panel]: null,
    }));
  }, [isMobile]);

  const onPanelResizePointerDown = useCallback((panel, event) => {
    if (isMobile) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panelElement = event.currentTarget.closest('.winamp-panel');
    const rect = panelElement?.getBoundingClientRect();
    if (!rect) return;
    const origin = panelOffsets[panel] || {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    const detached = Boolean(panelOffsets[panel]);
    panelResizing.current = {
      panel,
      detached,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
    };
    if (detached) {
      setPanelOffsets((offsets) => ({
        ...offsets,
        [panel]: origin,
      }));
    }
    setActivePanel(panel);
  }, [isMobile, panelOffsets]);

  const onPanelResizePointerMove = useCallback((event) => {
    const resize = panelResizing.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const maxWidth = Math.max(MIN_PLAYLIST_WIDTH, window.innerWidth - resize.origin.x);
    const maxHeight = Math.max(MIN_PLAYLIST_HEIGHT, window.innerHeight - resize.origin.y);
    const nextSize = {
      width: clamp(resize.origin.width + event.clientX - resize.startX, MIN_PLAYLIST_WIDTH, maxWidth),
      height: clamp(resize.origin.height + event.clientY - resize.startY, MIN_PLAYLIST_HEIGHT, maxHeight),
    };

    if (resize.detached) {
      setPanelOffsets((offsets) => ({
        ...offsets,
        [resize.panel]: {
          ...resize.origin,
          ...nextSize,
        },
      }));
      return;
    }

    setPanelSizes((sizes) => ({
      ...sizes,
      [resize.panel]: {
        width: resize.origin.width,
        height: nextSize.height,
      },
    }));
  }, []);

  const onPanelResizePointerUp = useCallback((event) => {
    const resize = panelResizing.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    panelResizing.current = null;
    setActivePanel('');

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onLibraryResizePointerDown = useCallback((event) => {
    if (isMobile) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.closest('.library-view')?.getBoundingClientRect();
    if (!rect) return;
    libraryResizing.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: {
        width: rect.width,
        height: rect.height,
      },
    };
  }, [isMobile]);

  const onLibraryResizePointerMove = useCallback((event) => {
    const resize = libraryResizing.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const maxHeight = Math.max(MIN_LIBRARY_HEIGHT, window.innerHeight - 36);
    setLibrarySize({
      width: resize.origin.width,
      height: clamp(resize.origin.height + event.clientY - resize.startY, MIN_LIBRARY_HEIGHT, maxHeight),
    });
  }, []);

  const onLibraryResizePointerUp = useCallback((event) => {
    const resize = libraryResizing.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    libraryResizing.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const durationProbes = tracks.map((track) => (
    <DurationProbe key={track.filename} track={track} onDuration={setTrackDuration} />
  ));

  return (
    <main className={`player-shell${isMinimized ? ' is-minimized' : ''}`} style={shellStyle}>
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
      <StorageConsentModal />

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
              panelOffsets={renderedPanelOffsets}
              panelSizes={panelSizes}
              activePanel={activePanel}
              playlistOpen={miniPlaylistOpen}
              durations={durations}
              volume={volume}
              visualMode={visualMode}
              shuffle={shuffle}
              repeat={repeat}
              eqEnabled={eqEnabled}
              eqGains={eqGains}
              eqPanelOpen={eqPanelOpen}
              eqPresets={eqPresets}
              activeEqPreset={activeEqPreset}
              audioRef={audioRef}
              onSeek={seek}
              onVolumeChange={setVolume}
              onToggle={togglePlay}
              onStop={stop}
              onPrevious={previous}
              onNext={next}
              onToggleShuffle={toggleShuffle}
              onToggleRepeat={() => setRepeat((value) => !value)}
              onToggleEq={() => setEqEnabled((value) => !value)}
              onToggleEqPanel={() => setEqPanelOpen((value) => !value)}
              onEqGainChange={setEqGain}
              onEqPresetLoad={loadEqPreset}
              onEqPresetSave={saveEqPreset}
              onRestore={restoreFullPlayer}
              onSelect={selectTrack}
              onEditTitle={editTrackTitle}
              onDeleteTrack={deleteTrack}
              onToggleFavorite={toggleFavorite}
              onTogglePlaylist={() => setMiniPlaylistOpen((value) => !value)}
              onVisualModeChange={setVisualMode}
              onTitlePointerDown={onMiniTitlePointerDown}
              onTitlePointerMove={onMiniTitlePointerMove}
              onTitlePointerUp={onMiniTitlePointerUp}
              onPanelPointerDown={onPanelPointerDown}
              onPanelPointerMove={onPanelPointerMove}
              onPanelPointerUp={onPanelPointerUp}
              onPanelReattach={onPanelReattach}
              onPanelResizePointerDown={onPanelResizePointerDown}
              onPanelResizePointerMove={onPanelResizePointerMove}
              onPanelResizePointerUp={onPanelResizePointerUp}
              playerRef={miniRef}
              canOpenFullPlayer={!isMobile}
            />
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
              <h2>{getTrackTitle(currentTrack)}</h2>
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
              <button type="button" onClick={toggleShuffle} aria-pressed={shuffle} data-active={shuffle}>
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
        onEditTitle={editTrackTitle}
        onDeleteTrack={deleteTrack}
        onToggleFavorite={toggleFavorite}
        liveDuration={duration}
        durations={durations}
        style={libraryStyle}
        resizable={!isMobile}
        onResizePointerDown={onLibraryResizePointerDown}
        onResizePointerMove={onLibraryResizePointerMove}
        onResizePointerUp={onLibraryResizePointerUp}
      />
        </>
      )}
    </main>
  );
}
