import { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  ConnectionState,
  createAudioAnalyser,
} from "livekit-client";
import "./App.css";

const STATUS_LABELS = {
  idle: "Touch the orb to begin",
  connecting: "Establishing connection…",
  listening: "I'm listening…",
  thinking: "Processing…",
  speaking: "Agent speaking…",
  error: "Connection lost — tap to retry",
};

// ── Sparkline chart ────────────────────────────────────────────────────────
function Sparkline({ data, isUp }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 260, h = 55;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 8 - ((v - min) / range) * (h - 16);
    return `${x},${y}`;
  }).join(" ");
  const color = isUp ? "#00e8c6" : "#f87171";
  return (
    <svg className="crypto-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${isUp}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Crypto card ────────────────────────────────────────────────────────────
function CryptoCard({ data, onClose }) {
  const isUp = data.change >= 0;
  return (
    <div className={`crypto-card ${isUp ? "crypto-up" : "crypto-down"}`}>
      <button className="crypto-close" onClick={onClose}>✕</button>
      <div className="crypto-header">
        <span className="crypto-symbol">{data.symbol}</span>
        <span className="crypto-name">{data.name}</span>
      </div>
      <div className="crypto-price">
        ${data.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className={`crypto-change ${isUp ? "up" : "down"}`}>
        {isUp ? "▲" : "▼"} {Math.abs(data.change).toFixed(2)}%
        <span className="crypto-period"> 24h</span>
      </div>
      <Sparkline data={data.sparkline} isUp={isUp} />
      <div className="crypto-meta">
        <div className="crypto-meta-item">
          <span className="crypto-meta-label">Mkt Cap</span>
          <span className="crypto-meta-value">${(data.marketCap / 1e9).toFixed(1)}B</span>
        </div>
        <div className="crypto-meta-item">
          <span className="crypto-meta-label">24h Vol</span>
          <span className="crypto-meta-value">${(data.volume / 1e9).toFixed(1)}B</span>
        </div>
        <div className="crypto-meta-item">
          <span className="crypto-meta-label">Rank</span>
          <span className="crypto-meta-value">#{data.rank}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [agentState, setAgentState] = useState("idle");
  const [transcript, setTranscript] = useState([]);
  const [isMuted, setIsMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [cryptoCards, setCryptoCards] = useState([]);

  const roomRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const sessionTimerRef = useRef(null);
  const audioAnimRef = useRef(null);
  const thinkTimerRef = useRef(null);
  const agentStateRef = useRef("idle");

  const updateAgentState = useCallback((s) => {
    agentStateRef.current = s;
    setAgentState(s);
  }, []);

  // Unlock browser audio on first click
  useEffect(() => {
    const unlock = () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) new AC().resume();
      window.removeEventListener("click", unlock);
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const startAudioAnalyser = useCallback((track) => {
    cancelAnimationFrame(audioAnimRef.current);
    const analyser = createAudioAnalyser(track, { fftSize: 256 });
    const tick = () => {
      setAudioLevel(analyser.calculateVolume());
      audioAnimRef.current = requestAnimationFrame(tick);
    };
    audioAnimRef.current = requestAnimationFrame(tick);
  }, []);

  const doDisconnect = useCallback(() => {
    clearInterval(sessionTimerRef.current);
    clearTimeout(thinkTimerRef.current);
    cancelAnimationFrame(audioAnimRef.current);
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    updateAgentState("idle");
    setIsConnected(false);
    setAudioLevel(0);
    setSessionTime(0);
    setIsMuted(false);
  }, [updateAgentState]);

  const removeCard = useCallback((id) => {
    setCryptoCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleOrbClick = useCallback(async () => {
    const current = agentStateRef.current;
    if (current === "connecting") return;
    if (current !== "idle" && current !== "error") {
      doDisconnect();
      return;
    }

    try {
      updateAgentState("connecting");

      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) await new AC().resume();

      const res = await fetch(
        import.meta.env.VITE_TOKEN_URL || "http://localhost:8000/token",
        { headers: { "ngrok-skip-browser-warning": "true" } }
      );
      if (!res.ok) throw new Error("Token fetch failed");
      const { token, url } = await res.json();

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      roomRef.current = room;

      room.on(RoomEvent.Connected, async () => {
        setIsConnected(true);
        updateAgentState("listening");
        const AC2 = window.AudioContext || window.webkitAudioContext;
        if (AC2) await new AC2().resume();
        sessionTimerRef.current = setInterval(() => setSessionTime((t) => t + 1), 1000);
        try {
          await room.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          });
        } catch (e) { console.error("Mic error:", e); }
      });

      room.on(RoomEvent.Disconnected, () => {
        clearInterval(sessionTimerRef.current);
        clearTimeout(thinkTimerRef.current);
        cancelAnimationFrame(audioAnimRef.current);
        roomRef.current = null;
        updateAgentState("idle");
        setIsConnected(false);
        setAudioLevel(0);
        setSessionTime(0);
      });

      room.on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Reconnecting) updateAgentState("connecting");
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        clearTimeout(thinkTimerRef.current);
        const agentSpeaking = speakers.some((s) => !s.isLocal);
        const userSpeaking = speakers.some((s) => s.isLocal);
        if (agentSpeaking) updateAgentState("speaking");
        else if (userSpeaking) updateAgentState("listening");
        else thinkTimerRef.current = setTimeout(() => updateAgentState("thinking"), 600);
      });

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === "audio" && !participant.isLocal) {
          const audioEl = track.attach();
          audioEl.volume = 1.0;
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);
          startAudioAnalyser(track);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (!participant.isLocal) {
          track.detach().forEach((el) => el.remove());
          cancelAnimationFrame(audioAnimRef.current);
          setAudioLevel(0);
        }
      });

      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        const isAgent = participant && !participant.isLocal;
        const finals = segments.filter((s) => s.final);
        if (!finals.length) return;
        const text = finals.map((s) => s.text).join(" ").trim();
        if (!text) return;
        setTranscript((prev) => [...prev, { role: isAgent ? "agent" : "user", text }]);
      });

      // Receive crypto card data from agent
      room.on(RoomEvent.DataReceived, (data) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(data));
          if (msg.type === "crypto_data") {
            setCryptoCards((prev) => {
              const filtered = prev.filter((c) => c.symbol !== msg.data.symbol);
              return [{ ...msg.data, id: Date.now() }, ...filtered].slice(0, 4);
            });
          }
        } catch (_) {}
      });

      await room.connect(url, token);
    } catch (err) {
      console.error("Connection error:", err);
      updateAgentState("error");
      roomRef.current = null;
    }
  }, [doDisconnect, startAudioAnalyser, updateAgentState]);

  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;
    const newMuted = !isMuted;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!newMuted);
    setIsMuted(newMuted);
  }, [isMuted]);

  const formatTime = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="app">
      <div className="bg-layer">
        <div className="nebula nebula-1" />
        <div className="nebula nebula-2" />
        <div className="nebula nebula-3" />
      </div>
      <Particles count={22} />

      <header className="header">
        <div className="logo">
          <span className="logo-mark">◈</span>
          <span className="logo-text">AURA</span>
        </div>
        <div className="header-right">
          {isConnected && (
            <div className="session-badge">
              <span className="session-dot" />
              <span className="session-time">{formatTime(sessionTime)}</span>
            </div>
          )}
          <button
            className={`transcript-toggle ${showTranscript ? "active" : ""}`}
            onClick={() => setShowTranscript((v) => !v)}
          >≡</button>
        </div>
      </header>

      {/* Crypto cards */}
      {cryptoCards.length > 0 && (
        <div className="crypto-grid">
          {cryptoCards.map((card) => (
            <CryptoCard key={card.id} data={card} onClose={() => removeCard(card.id)} />
          ))}
        </div>
      )}

      <main className="stage">
        <div className={`rings rings--${agentState}`}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="ring" style={{ "--ring-index": i }} />
          ))}
        </div>

        <button className={`orb orb--${agentState}`} onClick={handleOrbClick} aria-label="Toggle voice agent">
          <div className="orb-inner"><OrbIcon state={agentState} /></div>
          <div className="orb-glow" />
          <div className="orb-surface" />
        </button>

        {(agentState === "listening" || agentState === "speaking") && (
          <WaveformBars level={audioLevel} state={agentState} />
        )}

        <div className={`status-label status--${agentState}`}>
          <span className="status-text">{STATUS_LABELS[agentState]}</span>
        </div>

        {isConnected && (
          <div className="controls">
            <button className={`ctrl-btn ${isMuted ? "ctrl-btn--active" : ""}`} onClick={toggleMute}>
              {isMuted ? "⊘" : "⊕"}
              <span className="ctrl-label">{isMuted ? "Unmute" : "Mute"}</span>
            </button>
            <button className="ctrl-btn ctrl-btn--end" onClick={doDisconnect}>
              ✕<span className="ctrl-label">End</span>
            </button>
          </div>
        )}
      </main>

      <div className={`transcript-panel ${showTranscript ? "transcript-panel--open" : ""}`}>
        <div className="transcript-header">
          <span>Transcript</span>
          <button className="close-btn" onClick={() => setShowTranscript(false)}>✕</button>
        </div>
        <div className="transcript-body">
          {transcript.length === 0 ? (
            <p className="transcript-empty">Conversation will appear here…</p>
          ) : (
            transcript.map((entry, i) => (
              <div key={i} className={`msg msg--${entry.role}`}>
                <span className="msg-role">{entry.role === "agent" ? "AURA" : "YOU"}</span>
                <p className="msg-text">{entry.text}</p>
              </div>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>

      {showTranscript && <div className="overlay" onClick={() => setShowTranscript(false)} />}
    </div>
  );
}

function OrbIcon({ state }) {
  const icons = {
    idle: { icon: "◈", cls: "" }, connecting: { icon: "⟳", cls: "orb-icon--spin" },
    listening: { icon: "♦", cls: "orb-icon--pulse" }, thinking: { icon: "⋯", cls: "" },
    speaking: { icon: "◉", cls: "orb-icon--wave" }, error: { icon: "⚠", cls: "" },
  };
  const { icon, cls } = icons[state] || icons.idle;
  return <span className={`orb-icon ${cls}`}>{icon}</span>;
}

function WaveformBars({ level, state }) {
  const bars = 28;
  return (
    <div className={`waveform waveform--${state}`}>
      {Array.from({ length: bars }).map((_, i) => {
        const center = bars / 2;
        const dist = Math.abs(i - center) / center;
        const height = Math.max(4, (1 - dist * 0.6) * level * 48 + 4);
        return <div key={i} className="wave-bar"
          style={{ "--bar-h": `${height}px`, "--bar-delay": `${(i * 40) % 300}ms` }} />;
      })}
    </div>
  );
}

function Particles({ count }) {
  const particles = useRef(
    Array.from({ length: count }, (_, i) => ({
      id: i, x: Math.random() * 100, y: Math.random() * 100,
      size: Math.random() * 3 + 1, dur: Math.random() * 12 + 8,
      delay: Math.random() * -15, drift: (Math.random() - 0.5) * 60,
    }))
  ).current;
  return (
    <div className="particles" aria-hidden>
      {particles.map((p) => (
        <div key={p.id} className="particle" style={{
          left: `${p.x}%`, top: `${p.y}%`,
          width: `${p.size}px`, height: `${p.size}px`,
          "--dur": `${p.dur}s`, "--delay": `${p.delay}s`, "--drift": `${p.drift}px`,
        }} />
      ))}
    </div>
  );
}
