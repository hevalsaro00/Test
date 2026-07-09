import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, SkipForward, X, Flame, Settings, Minus, Plus, Maximize, Minimize, Eye, EyeOff } from 'lucide-react';
import FlipGroup from './components/FlipGroup';

type Mode = 'focus' | 'short' | 'long';

const MODE_LABELS: Record<Mode, string> = {
  focus: 'Focus',
  short: 'Short Break',
  long: 'Long Break',
};

const DEFAULT_DURATIONS: Record<Mode, number> = { focus: 25, short: 5, long: 15 };

function loadDurations(): Record<Mode, number> {
  try {
    const saved = JSON.parse(localStorage.getItem('pomoflip-durations') || 'null');
    if (
      saved &&
      typeof saved.focus === 'number' &&
      typeof saved.short === 'number' &&
      typeof saved.long === 'number'
    ) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_DURATIONS };
}

interface ColorOption {
  id: string;
  swatch: string; // css background for the picker dot
  text?: string; // css color for digits
  rainbow?: boolean;
}

const COLORS: ColorOption[] = [
  { id: 'white', swatch: '#ffffff', text: '#f2f2f7' },
  { id: 'red', swatch: '#e0362e', text: '#e0362e' },
  { id: 'orange', swatch: '#e8930c', text: '#e8930c' },
  { id: 'green', swatch: '#2eb135', text: '#2eb135' },
  { id: 'teal', swatch: '#2eb18a', text: '#2eb18a' },
  { id: 'blue', swatch: '#0f8de8', text: '#0f8de8' },
  { id: 'purple', swatch: '#7514e8', text: '#7514e8' },
  { id: 'pink', swatch: '#f542a4', text: '#f542a4' },
  {
    id: 'rainbow',
    swatch: 'conic-gradient(#ff3b30, #ff9500, #ffd60a, #34c759, #0a84ff, #8a2be2, #ff2d92, #ff3b30)',
    rainbow: true,
  },
];

// لوحة ألوان موسّعة — تظهر عند الضغط على أيقونة كل الألوان
const EXTENDED_COLORS: string[] = [
  '#ff3b30', '#ff6b52', '#ff9500', '#ffb340', '#ffd60a', '#e8e337',
  '#a4d420', '#34c759', '#2eb18a', '#00c7be', '#30d0c8', '#32ade6',
  '#0a84ff', '#5e9bff', '#5856d6', '#7514e8', '#8a2be2', '#af52de',
  '#bf5af2', '#ff2d92', '#f542a4', '#ff6482', '#a2845e', '#8e8e93',
  '#d4a373', '#e07a5f', '#81b29a', '#f2cc8f', '#6d597a', '#b56576',
];

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export default function App() {
  const [durations, setDurations] = useState<Record<Mode, number>>(loadDurations);
  const [mode, setMode] = useState<Mode>('focus');
  const [secondsLeft, setSecondsLeft] = useState(() => loadDurations().focus * 60);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // وضع الإخفاء: يظهر الوقت فقط بدون أي أزرار أو عناصر
  const [zenMode, setZenMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [colorId, setColorId] = useState<string>(
    () => localStorage.getItem('pomoflip-color') || 'purple'
  );
  // حجم الساعة: مقياس من 50% إلى 130% (100 = الحجم الافتراضي)
  const [clockScale, setClockScale] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem('pomoflip-scale') || '100', 10);
    return Number.isFinite(saved) && saved >= 50 && saved <= 130 ? saved : 100;
  });
  const [stats, setStats] = useState<{ focusCount: number; focusMinutes: number } | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [finished, setFinished] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // عدد جلسات التركيز المكتملة منذ آخر استراحة طويلة
  const focusStreakRef = useRef(0);

  const [paletteOpen, setPaletteOpen] = useState(false);

  // دعم الألوان المخصصة: إذا كان colorId لون hex مباشر
  const color: ColorOption = colorId.startsWith('#')
    ? { id: colorId, swatch: colorId, text: colorId }
    : COLORS.find((c) => c.id === colorId) || COLORS[6];

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setStats({ focusCount: data.focusCount, focusMinutes: data.focusMinutes });
      setStatsError(false);
    } catch {
      setStatsError(true);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    localStorage.setItem('pomoflip-color', colorId);
  }, [colorId]);

  useEffect(() => {
    localStorage.setItem('pomoflip-durations', JSON.stringify(durations));
  }, [durations]);

  useEffect(() => {
    localStorage.setItem('pomoflip-scale', String(clockScale));
  }, [clockScale]);

  // تغيير مدة وضع معين من الإعدادات
  const changeDuration = (m: Mode, delta: number) => {
    setDurations((prev) => {
      const next = { ...prev, [m]: Math.min(120, Math.max(1, prev[m] + delta)) };
      // إذا كان الوضع الحالي غير شغّال، حدّث المؤقت مباشرة
      if (m === mode && !running) {
        setSecondsLeft(next[m] * 60);
      }
      return next;
    });
  };

  const resetDurations = () => {
    setDurations({ ...DEFAULT_DURATIONS });
    if (!running) setSecondsLeft(DEFAULT_DURATIONS[mode] * 60);
  };

  const playChime = useCallback((type: 'break' | 'focus' = 'focus') => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      if (type === 'break') {
        // صوت الاستراحة: جرس هادئ نازل + رنين طويل مريح
        const notes = [880, 659.25, 523.25, 392];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          const t = ctx.currentTime + i * 0.35;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.3, t + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 1.3);
        });
        // رنين ختامي طويل
        const bell = ctx.createOscillator();
        const bellGain = ctx.createGain();
        bell.type = 'sine';
        bell.frequency.value = 523.25;
        const bt = ctx.currentTime + notes.length * 0.35;
        bellGain.gain.setValueAtTime(0, bt);
        bellGain.gain.linearRampToValueAtTime(0.25, bt + 0.05);
        bellGain.gain.exponentialRampToValueAtTime(0.001, bt + 2.2);
        bell.connect(bellGain).connect(ctx.destination);
        bell.start(bt);
        bell.stop(bt + 2.3);
      } else {
        // صوت العودة للتركيز: نغمة صاعدة نشيطة
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.18);
          gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.5);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + i * 0.18);
          osc.stop(ctx.currentTime + i * 0.18 + 0.55);
        });
      }
    } catch {
      /* audio unavailable */
    }
  }, []);

  const completeSession = useCallback(async () => {
    // لما تخلص جلسة التركيز يصدر صوت الاستراحة، ولما تخلص الاستراحة يصدر صوت العودة للتركيز
    playChime(mode === 'focus' ? 'break' : 'focus');
    setFinished(true);
    setTimeout(() => setFinished(false), 4000);
    // دورة بومودورو تلقائية:
    // تركيز → استراحة قصيرة (3 مرات) → وبعد رابع جلسة تركيز → استراحة طويلة
    let next: Mode;
    if (mode === 'focus') {
      focusStreakRef.current += 1;
      if (focusStreakRef.current >= 4) {
        next = 'long';
        focusStreakRef.current = 0;
      } else {
        next = 'short';
      }
    } else {
      next = 'focus';
    }
    setMode(next);
    setSecondsLeft(durations[next] * 60);
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, duration_minutes: durations[mode] }),
      });
      fetchStats();
    } catch {
      /* ignore network errors, timer still works */
    }
  }, [mode, playChime, fetchStats, durations]);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      // فقط ننقص الوقت — الانتقال يتم في useEffect منفصل عند الوصول للصفر
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  // لما يوصل الوقت للصفر أثناء التشغيل: انتقال واحد فقط للوضع التالي
  useEffect(() => {
    if (running && secondsLeft === 0) {
      completeSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, running]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setRunning(false);
    setSecondsLeft(durations[m] * 60);
    // التبديل اليدوي يعيد الدورة من البداية
    focusStreakRef.current = 0;
  };

  const reset = () => {
    setRunning(false);
    setSecondsLeft(durations[mode] * 60);
  };

  // تخطي الجلسة الحالية والانتقال للوضع التالي (بدون تسجيلها في الإحصائيات)
  const skipSession = () => {
    // التخطي يتبع نفس دورة البومودورو (بدون احتساب الجلسة في الإحصائيات)
    let next: Mode;
    if (mode === 'focus') {
      focusStreakRef.current += 1;
      if (focusStreakRef.current >= 4) {
        next = 'long';
        focusStreakRef.current = 0;
      } else {
        next = 'short';
      }
    } else {
      next = 'focus';
    }
    playChime(next === 'focus' ? 'focus' : 'break');
    setRunning(false);
    setMode(next);
    setSecondsLeft(durations[next] * 60);
  };

  // متابعة حالة ملء الشاشة
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    } catch {
      /* fullscreen unavailable */
    }
  };

  // الضغط على الأرقام يبدّل اللون للي بعده تلقائياً
  const cycleColor = () => {
    const idx = COLORS.findIndex((c) => c.id === colorId);
    const next = COLORS[(idx + 1) % COLORS.length];
    setColorId(next.id);
  };

  const isRainbowSelected = colorId === 'rainbow';

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  const colorClass = color.rainbow ? 'rainbow-text' : '';
  const colorStyle = color.rainbow ? undefined : { color: color.text };

  useEffect(() => {
    document.title = running
      ? `${pad(minutes)}:${pad(seconds)} · PomoFlip`
      : 'PomoFlip — Flip Clock Pomodoro';
  }, [minutes, seconds, running]);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between bg-black text-white overflow-hidden"
      style={
        {
          '--flip-h': `calc(var(--flip-base) * ${clockScale / 100})`,
          '--flip-w': 'calc(var(--flip-h) * 0.98)',
          '--flip-font': 'calc(var(--flip-h) * 0.78)',
        } as React.CSSProperties
      }
    >
      {/* Top corner buttons: hide + fullscreen + settings */}
      <div className="fixed top-5 right-5 z-40 flex items-center gap-2.5">
        <button
          onClick={() => setZenMode((z) => !z)}
          aria-label={zenMode ? 'Show controls' : 'Hide everything except the clock'}
          className={`w-11 h-11 rounded-full bg-[#1c1c1e] flex items-center justify-center hover:text-white hover:bg-[#2c2c2e] transition-all duration-300 cursor-pointer ${
            zenMode ? 'text-white opacity-30 hover:opacity-100' : 'text-neutral-400'
          }`}
        >
          {zenMode ? <Eye size={19} /> : <EyeOff size={19} />}
        </button>
        {!zenMode && (
          <>
            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              className="w-11 h-11 rounded-full bg-[#1c1c1e] flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#2c2c2e] transition-all duration-300 cursor-pointer"
            >
              {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className="w-11 h-11 rounded-full bg-[#1c1c1e] flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#2c2c2e] hover:rotate-45 transition-all duration-300 cursor-pointer"
            >
              <Settings size={20} />
            </button>
          </>
        )}
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-[300px] bg-[#1c1c1e] rounded-2xl p-4 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">Timer Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
                className="w-7 h-7 rounded-full bg-[#3a3a3c] flex items-center justify-center text-neutral-300 hover:bg-[#48484a] transition-colors cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-2.5">
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                <div key={m} className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300">{MODE_LABELS[m]}</span>
                  <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full px-1.5 py-1">
                    <button
                      onClick={() => changeDuration(m, -1)}
                      aria-label={`Decrease ${MODE_LABELS[m]} duration`}
                      className="w-6 h-6 rounded-full bg-[#3a3a3c] flex items-center justify-center text-neutral-300 hover:bg-[#48484a] active:scale-95 transition-all cursor-pointer"
                    >
                      <Minus size={12} />
                    </button>
                    <span className="w-14 text-center text-sm font-bold tabular-nums">
                      {durations[m]} <span className="text-[10px] font-normal text-neutral-500">min</span>
                    </span>
                    <button
                      onClick={() => changeDuration(m, 1)}
                      aria-label={`Increase ${MODE_LABELS[m]} duration`}
                      className="w-6 h-6 rounded-full bg-[#3a3a3c] flex items-center justify-center text-neutral-300 hover:bg-[#48484a] active:scale-95 transition-all cursor-pointer"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* الألوان */}
            <div className="mt-4 pt-3.5 border-t border-[#2c2c2e]">
              <span className="text-xs font-semibold text-neutral-300 block mb-2">Color</span>
              <div className="flex flex-wrap items-center gap-2">
                {COLORS.filter((c) => !c.rainbow).map((c) => {
                  const selected = c.id === colorId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setColorId(c.id)}
                      aria-label={`Set color ${c.id}`}
                      className="relative w-7 h-7 rounded-full shrink-0 transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                      style={{ background: c.swatch }}
                    >
                      {selected && (
                        <span
                          className="absolute inset-[2px] rounded-full"
                          style={{
                            background: '#1c1c1e',
                            boxShadow: `inset 0 0 0 2px ${c.swatch}`,
                          }}
                        />
                      )}
                    </button>
                  );
                })}
                {/* أيقونة كل الألوان — تفتح اللوحة الموسّعة */}
                <button
                  onClick={() => setPaletteOpen((p) => !p)}
                  aria-label="More colors"
                  className={`relative w-7 h-7 rounded-full shrink-0 transition-transform hover:scale-110 active:scale-95 cursor-pointer ${
                    paletteOpen ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-[#1c1c1e]' : ''
                  }`}
                  style={{
                    background:
                      'conic-gradient(#ff3b30, #ff9500, #ffd60a, #34c759, #0a84ff, #8a2be2, #ff2d92, #ff3b30)',
                  }}
                >
                  {(isRainbowSelected || colorId.startsWith('#')) && !paletteOpen && (
                    <span
                      className="absolute inset-[2px] rounded-full"
                      style={{
                        background: '#1c1c1e',
                        boxShadow: 'inset 0 0 0 2px #8a2be2',
                      }}
                    />
                  )}
                </button>
              </div>

              {/* اللوحة الموسّعة */}
              {paletteOpen && (
                <div className="mt-3 bg-[#141416] rounded-xl p-3">
                  <div className="grid grid-cols-6 gap-2">
                    {/* خيار قوس قزح المتحرك */}
                    <button
                      onClick={() => setColorId('rainbow')}
                      aria-label="Rainbow animated"
                      className="relative w-7 h-7 rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                      style={{
                        background:
                          'conic-gradient(#ff3b30, #ff9500, #ffd60a, #34c759, #0a84ff, #8a2be2, #ff2d92, #ff3b30)',
                      }}
                    >
                      {isRainbowSelected && (
                        <span
                          className="absolute inset-[2px] rounded-full"
                          style={{ background: '#141416', boxShadow: 'inset 0 0 0 2px #8a2be2' }}
                        />
                      )}
                    </button>
                    {EXTENDED_COLORS.map((hex) => {
                      const selected = colorId === hex;
                      return (
                        <button
                          key={hex}
                          onClick={() => setColorId(hex)}
                          aria-label={`Set color ${hex}`}
                          className="relative w-7 h-7 rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                          style={{ background: hex }}
                        >
                          {selected && (
                            <span
                              className="absolute inset-[2px] rounded-full"
                              style={{ background: '#141416', boxShadow: `inset 0 0 0 2px ${hex}` }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {/* اختيار لون مخصص تماماً */}
                  <label className="flex items-center justify-between gap-2 mt-3 bg-[#2c2c2e] rounded-full pl-3 pr-1.5 py-1.5 cursor-pointer hover:bg-[#3a3a3c] transition-colors">
                    <span className="text-[11px] font-semibold text-neutral-300">Custom color</span>
                    <input
                      type="color"
                      value={colorId.startsWith('#') ? colorId : '#7514e8'}
                      onChange={(e) => setColorId(e.target.value)}
                      className="w-7 h-7 rounded-full border-0 bg-transparent cursor-pointer"
                      aria-label="Pick custom color"
                    />
                  </label>
                </div>
              )}
              <p className="text-[10px] text-neutral-600 mt-1.5">Tip: tap the clock digits to cycle colors</p>
            </div>

            {/* حجم الساعة */}
            <div className="mt-4 pt-3.5 border-t border-[#2c2c2e]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-neutral-300">Clock Size</span>
                <span className="text-xs font-bold tabular-nums" style={colorStyle}>
                  <span className={colorClass}>{clockScale}%</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setClockScale((s) => Math.max(50, s - 5))}
                  aria-label="Decrease clock size"
                  className="w-6 h-6 shrink-0 rounded-full bg-[#3a3a3c] flex items-center justify-center text-neutral-300 hover:bg-[#48484a] active:scale-95 transition-all cursor-pointer"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="range"
                  min={50}
                  max={130}
                  step={5}
                  value={clockScale}
                  onChange={(e) => setClockScale(parseInt(e.target.value, 10))}
                  aria-label="Clock size"
                  className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-[#2c2c2e] accent-current"
                  style={{ accentColor: color.rainbow ? '#8a2be2' : color.text }}
                />
                <button
                  onClick={() => setClockScale((s) => Math.min(130, s + 5))}
                  aria-label="Increase clock size"
                  className="w-6 h-6 shrink-0 rounded-full bg-[#3a3a3c] flex items-center justify-center text-neutral-300 hover:bg-[#48484a] active:scale-95 transition-all cursor-pointer"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="flex justify-between text-[9px] text-neutral-600 mt-1 px-8">
                <span>Small</span>
                <span>Default</span>
                <span>Large</span>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => {
                  resetDurations();
                  setClockScale(100);
                }}
                className="flex-1 py-2 rounded-full bg-[#2c2c2e] text-xs font-semibold text-neutral-300 hover:bg-[#3a3a3c] transition-colors cursor-pointer"
              >
                Reset defaults
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="flex-1 py-2 rounded-full text-xs font-bold transition-transform active:scale-95 cursor-pointer"
                style={{
                  background: color.rainbow
                    ? 'conic-gradient(#ff3b30, #ff9500, #ffd60a, #34c759, #0a84ff, #8a2be2, #ff2d92, #ff3b30)'
                    : color.text,
                  color: colorId === 'white' ? '#000' : '#fff',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar: mode tabs + stats */}
      <header className={`w-full flex flex-col items-center gap-3 pt-6 px-4 transition-opacity duration-500 ${zenMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="flex items-center gap-1 bg-[#1c1c1e] rounded-full p-1">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-4 sm:px-6 py-2 rounded-full text-sm sm:text-base font-semibold transition-all duration-200 cursor-pointer ${
                mode === m
                  ? 'bg-[#3a3a3c] text-white shadow-inner'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs sm:text-sm text-neutral-500 h-5">
          {statsError ? (
            <span className="text-neutral-600">Session stats unavailable</span>
          ) : stats === null ? (
            <span className="animate-pulse">Loading stats…</span>
          ) : (
            <>
              <Flame size={14} style={colorStyle} className={colorClass} />
              <span>
                {stats.focusCount} focus session{stats.focusCount === 1 ? '' : 's'} ·{' '}
                {stats.focusMinutes} min today
              </span>
            </>
          )}
        </div>
      </header>

      {/* Flip clock */}
      <main className="flex-1 flex flex-col items-center justify-center w-full px-4">
        <div
          className="clock-stack flex items-center justify-center gap-[3vw] sm:gap-[3.5vw] cursor-pointer select-none active:scale-[0.99] transition-transform"
          onClick={cycleColor}
          title="اضغط لتغيير اللون"
        >
          <FlipGroup value={pad(minutes)} colorClass={colorClass} colorStyle={colorStyle} />
          <FlipGroup value={pad(seconds)} colorClass={colorClass} colorStyle={colorStyle} />
        </div>

        {finished && !zenMode && (
          <div className="mt-6 text-sm sm:text-base font-semibold tracking-wide" style={colorStyle}>
            <span className={colorClass}>
              {mode === 'focus'
                ? 'Break over — back to focus!'
                : mode === 'long'
                  ? '4 sessions done — enjoy a long break!'
                  : 'Focus session complete — take a break!'}
            </span>
          </div>
        )}

        {/* Controls */}
        <div className={`flex items-center gap-4 mt-8 sm:mt-10 transition-opacity duration-500 ${zenMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <button
            onClick={reset}
            aria-label="Reset timer"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#1c1c1e] flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#2c2c2e] transition-colors cursor-pointer"
          >
            <RotateCcw size={20} />
          </button>
          <button
            onClick={() => {
              // فتح الصوت بضغطة المستخدم حتى يشتغل التنبيه لاحقاً
              try {
                if (!audioCtxRef.current) {
                  audioCtxRef.current = new (window.AudioContext ||
                    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
                }
                if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
              } catch { /* audio unavailable */ }
              setRunning((r) => !r);
            }}
            aria-label={running ? 'Pause timer' : 'Start timer'}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#1c1c1e] flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#2c2c2e] transition-colors active:scale-95 cursor-pointer"
          >
            {running ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
          </button>
          <button
            onClick={skipSession}
            aria-label="Skip session"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#1c1c1e] flex items-center justify-center text-neutral-400 hover:text-white hover:bg-[#2c2c2e] transition-colors cursor-pointer"
          >
            <SkipForward size={20} />
          </button>
        </div>
      </main>

      {/* bottom spacer */}
      <footer className="w-full pb-8" />
    </div>
  );
}
