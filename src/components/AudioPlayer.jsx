import React, { useEffect, useState, useRef, useCallback } from 'react';
import tracks from '../audioData.json';

const LCD_FONT = '"Courier New", "Lucida Console", monospace';
const SNAP_PX = 80; // pixels from edge to trigger snap

function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ─── EQ Bars ─── */
function EQBars({ playing, count = 20, height = 28 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height }}>
      {Array.from({ length: count }, (_, i) => {
        const seed = ((i * 7 + 3) % 10) / 10;
        return (
          <div key={i} style={{
            flex: 1,
            borderRadius: '1px 1px 0 0',
            background: playing ? 'linear-gradient(to top, #00ff41, #aaff00, #ffff00)' : 'rgba(0,255,65,0.15)',
            height: playing ? `${30 + seed * 70}%` : '15%',
            animation: playing ? `eq${i % 5} ${0.4 + seed * 0.6}s ease-in-out ${i * 0.03}s infinite alternate` : 'none',
            transition: 'height 0.4s ease',
            boxShadow: playing ? '0 0 4px #00ff41' : 'none',
          }} />
        );
      })}
      <style>{`
        @keyframes eq0{from{height:20%}to{height:95%}}
        @keyframes eq1{from{height:35%}to{height:80%}}
        @keyframes eq2{from{height:15%}to{height:100%}}
        @keyframes eq3{from{height:50%}to{height:75%}}
        @keyframes eq4{from{height:25%}to{height:90%}}
      `}</style>
    </div>
  );
}

/* ─── Docked Edge Handle ─── */
function DockedHandle({ side, playing, onClick, onPrev, onNext }) {
  const isVertical = side === 'left' || side === 'right';
  const bars = [0.5, 0.8, 1.0, 0.7, 0.6];

  const pulseStyle = {
    display: 'flex',
    flexDirection: isVertical ? 'column' : 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: '8px 6px',
  };
  
  const handleAction = (action, e) => {
    e.stopPropagation();
    action();
  };

  const btnStyle = {
    background: 'none', border: 'none', color: '#FF6A00', cursor: 'pointer',
    fontSize: '0.75rem', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'color 0.2s, text-shadow 0.2s, transform 0.2s', outline: 'none'
  };
  const hoverOn = (e) => { 
    e.currentTarget.style.color = '#ffffff'; 
    e.currentTarget.style.textShadow = '0 0 8px #FF6A00'; 
    e.currentTarget.style.transform = 'scale(1.1)';
  };
  const hoverOff = (e) => { 
    e.currentTarget.style.color = '#FF6A00'; 
    e.currentTarget.style.textShadow = 'none'; 
    e.currentTarget.style.transform = 'scale(1)';
  };

  return (
    <div
      onClick={onClick}
      title="Click to restore player"
      style={{
        position: 'fixed',
        zIndex: 9001,
        cursor: 'pointer',
        ...(side === 'left'   && { left: 0, top: '50%', transform: 'translateY(-50%)' }),
        ...(side === 'right'  && { right: 0, top: '50%', transform: 'translateY(-50%)' }),
        ...(side === 'top'    && { top: 0, left: '50%', transform: 'translateX(-50%)' }),
        ...(side === 'bottom' && { bottom: 0, left: '50%', transform: 'translateX(-50%)' }),
        background: 'rgba(8, 12, 8, 0.9)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(0,255,65,0.3)',
        borderRadius: side === 'left'   ? '0 8px 8px 0'
                     : side === 'right'  ? '8px 0 0 8px'
                     : side === 'top'    ? '0 0 8px 8px'
                     : '8px 8px 0 0',
        boxShadow: playing
          ? '0 0 16px rgba(0,255,65,0.4), 0 0 32px rgba(0,255,65,0.15)'
          : '0 4px 20px rgba(0,0,0,0.5)',
        transition: 'box-shadow 0.5s ease',
        animation: playing ? 'handleBreath 1.2s ease-in-out infinite alternate' : 'none',
      }}
    >
      <div style={pulseStyle}>
        <button
          title="Previous Track"
          onClick={(e) => handleAction(onPrev, e)}
          onMouseOver={hoverOn} onMouseOut={hoverOff}
          style={btnStyle}
        >
          {isVertical ? '▲' : '◀'}
        </button>

        {bars.map((h, i) => (
          <div key={i} style={{
            width: isVertical ? `${h * 24}px` : '4px',
            height: isVertical ? '4px' : `${h * 24}px`,
            borderRadius: '2px',
            background: playing
              ? `linear-gradient(${isVertical ? 'to right' : 'to top'}, #00ff41, #aaff00)`
              : 'rgba(0,255,65,0.2)',
            transformOrigin: isVertical 
                ? (side === 'left' ? 'left center' : 'right center') 
                : (side === 'top' ? 'center top' : 'center bottom'),
            transform: playing ? 'none' : `scale${isVertical ? 'X' : 'Y'}(0.3)`,
            animation: playing
              ? `eqScale${isVertical ? 'X' : 'Y'}${i % 5} ${0.4 + i * 0.15}s ease-in-out ${i * 0.1}s infinite alternate`
              : 'none',
            transition: 'background 0.4s ease, transform 0.4s ease',
            boxShadow: playing ? '0 0 6px #00ff41' : 'none',
          }} />
        ))}

        <button
          title="Next Track"
          onClick={(e) => handleAction(onNext, e)}
          onMouseOver={hoverOn} onMouseOut={hoverOff}
          style={btnStyle}
        >
          {isVertical ? '▼' : '▶'}
        </button>

      </div>
      <style>{`
        @keyframes handleBreath {
          from { box-shadow: 0 0 10px rgba(0,255,65,0.3); }
          to   { box-shadow: 0 0 24px rgba(0,255,65,0.7), 0 0 48px rgba(0,255,65,0.2); }
        }
        @keyframes eqScaleY0{from{transform:scaleY(0.2)}to{transform:scaleY(1)}}
        @keyframes eqScaleY1{from{transform:scaleY(0.4)}to{transform:scaleY(0.8)}}
        @keyframes eqScaleY2{from{transform:scaleY(0.15)}to{transform:scaleY(1)}}
        @keyframes eqScaleY3{from{transform:scaleY(0.5)}to{transform:scaleY(0.75)}}
        @keyframes eqScaleY4{from{transform:scaleY(0.25)}to{transform:scaleY(0.9)}}
        
        @keyframes eqScaleX0{from{transform:scaleX(0.2)}to{transform:scaleX(1)}}
        @keyframes eqScaleX1{from{transform:scaleX(0.4)}to{transform:scaleX(0.8)}}
        @keyframes eqScaleX2{from{transform:scaleX(0.15)}to{transform:scaleX(1)}}
        @keyframes eqScaleX3{from{transform:scaleX(0.5)}to{transform:scaleX(0.75)}}
        @keyframes eqScaleX4{from{transform:scaleX(0.25)}to{transform:scaleX(0.9)}}
      `}</style>
    </div>
  );
}

/* ─── Marquee ─── */
function Marquee({ text, playing }) {
  return (
    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', fontFamily: LCD_FONT, fontSize: '0.72rem', color: '#00ff41', textShadow: '0 0 6px #00ff41', letterSpacing: '0.06em' }}>
      <span style={{ display: 'inline-block', paddingLeft: '100%', animation: playing ? 'marquee 10s linear infinite' : 'none' }}>
        {text.toUpperCase()}
      </span>
      <style>{`@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}`}</style>
    </div>
  );
}

/* ─── Slider ─── */
function WinSlider({ value, onChange, color = '#00ff41' }) {
  const ref = useRef(null);
  const handle = useCallback((e) => {
    const rect = ref.current.getBoundingClientRect();
    onChange(clamp((e.clientX - rect.left) / rect.width, 0, 1));
  }, [onChange]);
  return (
    <div ref={ref}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handle(e); }}
      onPointerMove={e => { if (e.buttons) handle(e); }}
      style={{ position: 'relative', height: '10px', borderRadius: '3px', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(0,255,65,0.2)', cursor: 'pointer', flex: 1 }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${value * 100}%`, background: `linear-gradient(90deg,${color}99,${color})`, borderRadius: '3px', boxShadow: `0 0 6px ${color}`, transition: 'width 0.1s linear' }} />
      <div style={{ position: 'absolute', top: '50%', left: `${value * 100}%`, transform: 'translate(-50%,-50%)', width: '12px', height: '12px', borderRadius: '2px', background: '#c0c0c0', border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 1px 3px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
    </div>
  );
}

/* ─── Control Button ─── */
function WinBtn({ onClick, title, children, active }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onPointerLeave={() => setPressed(false)}
      style={{
        background: pressed ? 'linear-gradient(135deg,#1a1a1a,#2a2a2a)' : 'linear-gradient(135deg,#3a3a3a,#252525)',
        border: pressed ? '1px solid rgba(0,255,65,0.5)' : '1px solid rgba(255,255,255,0.15)',
        borderRadius: '3px', color: active ? '#00ff41' : '#aaa', cursor: 'pointer',
        fontSize: '0.65rem', fontFamily: LCD_FONT, letterSpacing: '0.05em',
        padding: '5px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
        transition: 'all 0.1s',
        boxShadow: pressed ? 'inset 0 1px 3px rgba(0,0,0,0.6)' : '0 1px 2px rgba(0,0,0,0.4)',
        textShadow: active ? '0 0 6px #00ff41' : 'none', flexShrink: 0,
      }}
    >{children}</button>
  );
}

/* ─── Playlist Panel ─── */
function Playlist({ tracks, currentIndex, onSelect, isOpen, onToggle }) {
  return (
    <div style={{ borderTop: '1px solid rgba(0,255,65,0.1)' }}>
      {/* Toggle row */}
      <button
        onClick={onToggle}
        title={isOpen ? 'Close Playlist' : 'Open Playlist'}
        style={{
          width: '100%', background: 'rgba(0,255,65,0.04)', border: 'none',
          borderBottom: isOpen ? '1px solid rgba(0,255,65,0.1)' : 'none',
          color: '#00aa2c', cursor: 'pointer', fontFamily: LCD_FONT,
          fontSize: '0.62rem', letterSpacing: '0.1em', padding: '6px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          transition: 'background 0.2s',
        }}
      >
        <span>▤ PLAYLIST ({tracks.length})</span>
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.25s', display: 'inline-block' }}>▾</span>
      </button>

      {/* Track list */}
      {isOpen && (
        <div style={{ maxHeight: '120px', overflowY: 'auto', padding: '4px 0' }}>
          {tracks.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'rgba(0,255,65,0.4)', fontSize: '0.6rem', fontFamily: LCD_FONT, letterSpacing: '0.08em' }}>
              NO TRACKS — DROP FILES IN /public/assets/audio/
            </div>
          ) : tracks.map((t, i) => (
            <div
              key={i}
              onClick={() => onSelect(i)}
              title={t.title.toUpperCase()}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 10px', cursor: 'pointer',
                background: i === currentIndex ? 'rgba(0,255,65,0.1)' : 'transparent',
                borderLeft: i === currentIndex ? '2px solid #00ff41' : '2px solid transparent',
                transition: 'background 0.15s',
              }}
            >
              <span style={{ fontSize: '0.58rem', color: i === currentIndex ? '#00ff41' : 'rgba(0,255,65,0.35)', fontFamily: LCD_FONT, minWidth: '18px', textShadow: i === currentIndex ? '0 0 6px #00ff41' : 'none' }}>
                {i === currentIndex ? '▶' : `${i + 1}.`}
              </span>
              <span style={{ flex: 1, fontSize: '0.63rem', color: i === currentIndex ? '#00ff41' : 'rgba(0,255,65,0.65)', fontFamily: LCD_FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: i === currentIndex ? '0 0 6px #00ff41' : 'none' }}>
                {t.title.toUpperCase()}
              </span>
            </div>
          ))}
          <style>{`
            div::-webkit-scrollbar { width: 4px; }
            div::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
            div::-webkit-scrollbar-thumb { background: rgba(0,255,65,0.3); border-radius: 2px; }
          `}</style>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════════ */
export default function AudioPlayer() {
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState(null);       // { x, y } or null = default top-left
  const [docked, setDocked] = useState(null); // 'left'|'right'|'top'|'bottom'|null

  const audioRef = useRef(null);
  const playerRef = useRef(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const hasTracks = tracks.length > 0;
  const currentTrack = hasTracks ? tracks[trackIndex] : null;

  // Delayed appearance
  useEffect(() => {
    const t = setTimeout(() => setIsVisible(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    };
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      if (repeat) { audio.currentTime = 0; audio.play(); }
      else if (shuffle) setTrackIndex(Math.floor(Math.random() * tracks.length));
      else if (trackIndex < tracks.length - 1) setTrackIndex(i => i + 1);
      else setIsPlaying(false);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
    };
  }, [repeat, shuffle, trackIndex]);

  // Load track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.src = currentTrack.src;
    audio.volume = volume;
    audio.muted = isMuted;
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIndex]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (audioRef.current) audioRef.current.muted = isMuted; }, [isMuted]);

  const play  = async () => { try { await audioRef.current?.play(); setIsPlaying(true); } catch { /**/ } };
  const pause = ()       => { audioRef.current?.pause(); setIsPlaying(false); };
  const togglePlay = () => isPlaying ? pause() : play();

  const seek = useCallback((pct) => {
    const audio = audioRef.current;
    if (!audio?.duration) return;
    audio.currentTime = pct * audio.duration;
    setProgress(pct);
    setCurrentTime(pct * audio.duration);
  }, []);

  const prev = () => {
    if (audioRef.current?.currentTime > 3) audioRef.current.currentTime = 0;
    else setTrackIndex(i => (i - 1 + tracks.length) % tracks.length);
  };
  const next = () => shuffle
    ? setTrackIndex(Math.floor(Math.random() * tracks.length))
    : setTrackIndex(i => (i + 1) % tracks.length);
  const stop = () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIsPlaying(false); setProgress(0); setCurrentTime(0);
  };

  const selectTrack = (i) => {
    setTrackIndex(i);
    setIsPlaying(true);
    setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
  };

  /* ── Drag ── */
  const onTitlePointerDown = useCallback((e) => {
    if (e.target.tagName === 'BUTTON') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = playerRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragging.current = true;
    setIsDragging(true);
    setDocked(null); // un-dock when dragging starts
  }, []);

  const onTitlePointerMove = useCallback((e) => {
    if (!dragging.current) return;
    const pw = playerRef.current?.offsetWidth  || 280;
    const ph = playerRef.current?.offsetHeight || 200;
    const x = clamp(e.clientX - dragOffset.current.x, 0, window.innerWidth  - pw);
    const y = clamp(e.clientY - dragOffset.current.y, 0, window.innerHeight - ph);
    setPos({ x, y });
  }, []);

  const onTitlePointerUp = useCallback((e) => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    const pw = playerRef.current?.offsetWidth  || 280;
    const ph = playerRef.current?.offsetHeight || 200;
    const x = clamp(e.clientX - dragOffset.current.x, 0, window.innerWidth  - pw);
    const y = clamp(e.clientY - dragOffset.current.y, 0, window.innerHeight - ph);
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Snap detection — closest edge wins
    const toLeft   = x;
    const toRight  = W - (x + pw);
    const toTop    = y;
    const toBottom = H - (y + ph);
    const minDist  = Math.min(toLeft, toRight, toTop, toBottom);

    if (minDist <= SNAP_PX) {
      if (minDist === toLeft)   setDocked('left');
      else if (minDist === toRight)  setDocked('right');
      else if (minDist === toTop)    setDocked('top');
      else                           setDocked('bottom');
    }
  }, []);

  /* ── Docked: render handle only ── */
  if (docked) {
    return (
      <>
        {currentTrack && <audio ref={audioRef} preload="auto" />}
        <DockedHandle side={docked} playing={isPlaying} onClick={() => setDocked(null)} onPrev={prev} onNext={next} />
      </>
    );
  }

  /* ── Position ── */
  const posStyle = pos
    ? { left: pos.x, top: pos.y, right: 'auto' }
    : { top: '28px', left: '28px', right: 'auto' };

  return (
    <>
      {currentTrack && <audio ref={audioRef} preload="auto" />}

      <div
        id="winamp-player"
        ref={playerRef}
        style={{
          position: 'fixed',
          ...posStyle,
          zIndex: 9000,
          width: isMinimized ? '220px' : '280px',
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(-16px) scale(0.96)',
          transition: 'opacity 0.6s ease, transform 0.6s ease, width 0.3s ease',
          fontFamily: LCD_FONT,
          background: 'rgba(8, 12, 8, 0.88)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(0,255,65,0.2)',
          borderRadius: '6px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(0,255,65,0.08)',
        }}
      >
        {isDragging && (
          <div style={{
            position: 'absolute',
            top: '-32px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(8, 12, 8, 0.9)',
            border: '1px solid rgba(0,255,65,0.5)',
            color: '#00ff41',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '0.6rem',
            fontFamily: LCD_FONT,
            letterSpacing: '0.1em',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 8px rgba(0,255,65,0.2)',
            zIndex: 9002,
            animation: 'fadeIn 0.2s ease-out'
          }}>
            DRAG TO EDGE TO DOCK
          </div>
        )}
        <style>{`@keyframes fadeIn { from { opacity: 0; transform: translate(-50%, 4px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
        
        {/* ── Title Bar ── */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '5px 8px',
            background: 'linear-gradient(90deg, #00aa2c, #004d14)',
            borderBottom: '1px solid rgba(0,255,65,0.15)',
            borderRadius: '6px 6px 0 0',
            cursor: 'grab', userSelect: 'none',
          }}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
        >
          <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#e0ffe8', letterSpacing: '0.12em', textShadow: '0 0 8px #00ff41' }}>
            ◈ MUSICPLAYER
          </span>
          <div style={{ display: 'flex', gap: '5px' }}>
            <button
              onClick={() => setIsMinimized(m => !m)}
              title={isMinimized ? 'Restore' : 'Minimize'}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#aaa', cursor: 'pointer', borderRadius: '2px', width: '14px', height: '14px', fontSize: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            >
              {isMinimized ? '▲' : '▬'}
            </button>
          </div>
        </div>

        {!isMinimized && (
          <>
            {/* ── LCD ── */}
            <div style={{ margin: '8px 8px 0', background: '#001a05', border: '1px solid rgba(0,255,65,0.25)', borderRadius: '3px', padding: '8px 10px', boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.8)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '1.4rem', color: '#00ff41', textShadow: '0 0 10px #00ff41, 0 0 20px #00aa2c', letterSpacing: '0.1em', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(currentTime)}
                </span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.55rem', color: '#00aa2c', letterSpacing: '0.1em' }}>
                    {hasTracks ? `${trackIndex + 1}/${tracks.length}` : '—/—'}
                  </div>
                  <div style={{ fontSize: '0.55rem', color: '#00aa2c', letterSpacing: '0.05em' }}>
                    {fmt(duration)}
                  </div>
                </div>
              </div>
              <Marquee text={currentTrack ? currentTrack.title : 'NO TRACKS — ADD .MP3 TO /public/assets/audio/'} playing={isPlaying} />
              <div style={{ marginTop: '6px', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <div style={{ flexGrow: 1 }}>
                  <EQBars playing={isPlaying} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'right', paddingBottom: '2px' }}>
                  <span style={{ fontSize: '0.55rem', color: isPlaying ? '#00ff41' : '#00aa2c', fontFamily: LCD_FONT, letterSpacing: '0.05em', textShadow: isPlaying ? '0 0 4px #00ff41' : 'none' }}>
                    {hasTracks ? '320 KBPS' : '--- KBPS'}
                  </span>
                  <span style={{ fontSize: '0.55rem', color: isPlaying ? '#00ff41' : '#00aa2c', fontFamily: LCD_FONT, letterSpacing: '0.05em', textShadow: isPlaying ? '0 0 4px #00ff41' : 'none' }}>
                    {hasTracks ? '44 KHZ' : '-- KHZ'}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Seek ── */}
            <div style={{ padding: '8px 10px 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <WinSlider value={progress} onChange={seek} color="#00ff41" />
            </div>

            {/* ── Volume ── */}
            <div style={{ padding: '2px 10px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.6rem', color: '#00aa2c', letterSpacing: '0.08em', flexShrink: 0 }}>VOL</span>
              <WinSlider value={volume} onChange={setVolume} color="#aaff00" />
              <button
                onClick={() => setIsMuted(m => !m)}
                title={isMuted ? 'Unmute' : 'Mute'}
                style={{
                  background: isMuted ? 'rgba(255,80,0,0.2)' : 'none',
                  border: `1px solid ${isMuted ? 'rgba(255,80,0,0.5)' : 'rgba(0,255,65,0.3)'}`,
                  color: isMuted ? '#ff5000' : '#00aa2c', borderRadius: '3px',
                  cursor: 'pointer', fontSize: '0.55rem', padding: '2px 6px',
                  letterSpacing: '0.05em', transition: 'all 0.2s', flexShrink: 0,
                  fontWeight: 'bold', fontFamily: LCD_FONT,
                }}
                onMouseOver={e => { if(!isMuted) { e.currentTarget.style.color = '#00ff41'; e.currentTarget.style.borderColor = 'rgba(0,255,65,0.8)'; e.currentTarget.style.boxShadow = '0 0 4px rgba(0,255,65,0.3)'; } }}
                onMouseOut={e => { if(!isMuted) { e.currentTarget.style.color = '#00aa2c'; e.currentTarget.style.borderColor = 'rgba(0,255,65,0.3)'; e.currentTarget.style.boxShadow = 'none'; } }}
              >
                {isMuted ? 'MUTED' : 'MUTE'}
              </button>
            </div>

            {/* ── Transport ── */}
            <div style={{ padding: '4px 8px 4px', display: 'flex', gap: '4px', justifyContent: 'center' }}>
              <WinBtn onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} active={isPlaying}>
                <span style={{ fontSize: '0.85rem' }}>{isPlaying ? '⏸' : '▶'}</span>
                {isPlaying ? 'PAUS' : 'PLAY'}
              </WinBtn>
              <WinBtn onClick={stop} title="Stop">
                <span style={{ fontSize: '0.85rem' }}>⏹</span>
                STOP
              </WinBtn>
              <WinBtn onClick={prev} title="Previous">
                <span style={{ fontSize: '0.85rem' }}>⏮</span>
                PREV
              </WinBtn>
              <WinBtn onClick={next} title="Next">
                <span style={{ fontSize: '0.85rem' }}>⏭</span>
                NEXT
              </WinBtn>
            </div>

            {/* ── Mode toggles (above playlist) ── */}
            <div style={{ padding: '4px 8px', display: 'flex', gap: '4px' }}>
              <WinBtn onClick={() => setShuffle(s => !s)} title="Shuffle" active={shuffle}>
                {shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF'}
              </WinBtn>
              <WinBtn onClick={() => setRepeat(r => !r)} title="Repeat one" active={repeat}>
                {repeat ? 'REPEAT ON' : 'REPEAT OFF'}
              </WinBtn>
            </div>

            {/* ── Collapsible Playlist ── */}
            <Playlist
              tracks={tracks}
              currentIndex={trackIndex}
              onSelect={selectTrack}
              isOpen={playlistOpen}
              onToggle={() => setPlaylistOpen(o => !o)}
            />
          </>
        )}

        {/* ── Minimized strip ── */}
        {isMinimized && (
          <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <WinBtn onClick={togglePlay} active={isPlaying} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? '⏸' : '▶'}
            </WinBtn>
            <span
              title={currentTrack ? currentTrack.title.toUpperCase() : ''}
              style={{ flex: 1, fontSize: '0.62rem', color: '#00ff41', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 0 5px #00ff41' }}
            >
              {currentTrack ? currentTrack.title.toUpperCase() : 'NO TRACKS'}
            </span>
            <span style={{ fontSize: '0.6rem', color: '#00aa2c', flexShrink: 0 }}>{fmt(currentTime)}</span>
          </div>
        )}
      </div>
    </>
  );
}
