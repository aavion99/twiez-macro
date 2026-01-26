import { useState, useEffect, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable as enableAutostart, disable as disableAutostart, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Play,
  Square,
  Sparkles,
  ShieldCheck,
  SwitchCamera,
  Bolt,
  Languages,
  X,
  MousePointer2,
  Wand2,
  Gauge,
  KeySquare,
  LayoutDashboard,
  Settings,
  Minus,
  Maximize2,
  Info,
  ChevronDown,
} from "lucide-react";
import "./App.css";

// Simple Tauri detection
const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

type MacroButton = "left" | "right" | "middle";

type MacroSettings = {
  min_cps: number;
  max_cps: number;
  button: MacroButton;
  middle_button: boolean;
  keyboard_enabled: boolean;
  keyboard_key?: number | null;
  randomization: number;
  safe_mode: boolean;
  tray_mode: boolean;
  startup_on_boot: boolean;
  hotkey?: string | null;
  activation_mode: "hold" | "toggle";
  activation_key: string;
  click_limit_enabled: boolean;
  click_limit: number;
  duty_cycle: number;
  randomize_cps: boolean;
  discord_enabled: boolean;
  language: string;
};

type MacroStatus = {
  running: boolean;
  armed: boolean;
  min_cps: number;
  max_cps: number;
  button: MacroButton;
  keyboard_enabled: boolean;
  randomization: number;
  click_limit_enabled: boolean;
  click_limit: number;
  duty_cycle: number;
};

const defaultSettings: MacroSettings = {
  min_cps: 8,
  max_cps: 20,
  button: "left",
  middle_button: false,
  keyboard_enabled: false,
  keyboard_key: null,
  randomization: 0.18,
  safe_mode: true,
  tray_mode: true,
  startup_on_boot: false,
  hotkey: "F6",
  activation_mode: "toggle",
  activation_key: "F6",
  click_limit_enabled: false,
  click_limit: 0,
  duty_cycle: 0.5,
  randomize_cps: false,
  discord_enabled: false,
  language: "en",
};

type Route = "dashboard" | "settings";

function App() {
  const [route, setRoute] = useState<Route>("dashboard");
  const [settings, setSettings] = useState<MacroSettings>(defaultSettings);
  const [status, setStatus] = useState<MacroStatus>({
    running: false,
    armed: false,
    min_cps: defaultSettings.min_cps,
    max_cps: defaultSettings.max_cps,
    button: defaultSettings.button,
    keyboard_enabled: defaultSettings.keyboard_enabled,
    randomization: defaultSettings.randomization,
    click_limit_enabled: defaultSettings.click_limit_enabled,
    click_limit: defaultSettings.click_limit,
    duty_cycle: defaultSettings.duty_cycle,
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [language, setLanguage] = useState<"tr" | "en">("en");
  const [autostartOn, setAutostartOn] = useState(false);
  const [isRecordingKey, setIsRecordingKey] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    invoke<MacroSettings>("load_persisted_settings")
      .then((saved) => {
        setSettings(saved);
      })
      .catch(() => {
        /* ignore */
      });

    const unlisten = listen<MacroStatus>("macro://status", (event) => {
      setStatus(event.payload);
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    isEnabled().then(setAutostartOn).catch(() => setAutostartOn(false));
  }, []);

  // Disable context menu and F12
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      // Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J
      if (e.ctrlKey && e.shiftKey && ['I', 'C', 'J'].includes(e.key.toUpperCase())) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  // Load persisted settings on startup
  useEffect(() => {
    console.log("Loading persisted settings on startup...");
    invoke<MacroSettings>('load_persisted_settings')
      .then((loaded) => {
        console.log('Loaded persisted settings:', loaded);
        setSettings(loaded);
        if (loaded.language && (loaded.language === 'tr' || loaded.language === 'en')) {
          setLanguage(loaded.language as 'tr' | 'en');
        }
        if (loaded.startup_on_boot !== undefined) {
             setAutostartOn(loaded.startup_on_boot);
             if (loaded.startup_on_boot) {
                 enableAutostart();
             } else {
                 disableAutostart();
             }
        }
      })
      .catch((err) => {
        console.error('Failed to load settings (not in Tauri or error):', err);
      });
  }, []);

  // Debounce timer for settings updates
  const settingsTimerRef = useRef<number | null>(null);

  const pushSettings = (next: MacroSettings) => {
    console.log("pushSettings called, settings:", next.min_cps, next.max_cps);
    setSettings(next);
    
    // Clear previous timer
    if (settingsTimerRef.current) {
      clearTimeout(settingsTimerRef.current);
    }
    
    // Debounce: only send to backend after 500ms of no changes
    settingsTimerRef.current = window.setTimeout(() => {
      invoke<MacroSettings>("update_settings", { payload: next })
        .then(() => console.log("Settings updated successfully:", next.min_cps, next.max_cps))
        .catch((err) => {
          console.error("Settings update failed (not in Tauri or error):", err);
        });
    }, 500);
  };

  const handleStartStop = async () => {
    setBusy(true);
    try {
      if (status.running || status.armed) {
        const nextStatus = await invoke<MacroStatus>("stop_macro");
        setStatus(nextStatus);
      } else {
        // Check activation mode
        if (settings.activation_mode === "hold") {
          setToast(language === "tr" 
            ? `${settings.activation_key} tuşuna basılı tutarak makroyu başlatın` 
            : `Hold ${settings.activation_key} to start macro`);
          
          // Even in hold mode, we should arm the system if not already armed? 
          // Actually hold mode implies we just listen. 
          // Let's just arm it anyway so hotkeys work.
          console.log("Arming for HOLD mode...");
          await invoke<MacroSettings>("update_settings", { payload: settings });
          const nextStatus = await invoke<MacroStatus>("start_macro"); // This just arms it now
          setStatus(nextStatus);
          setBusy(false);
          return;
        }
        
        console.log("Starting macro with settings:", settings);
        
        // CRITICAL: Force settings sync to backend before starting
        console.log("Syncing settings to backend before start...");
        await invoke<MacroSettings>("update_settings", { payload: settings });
        // Small delay to ensure backend processes the update
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const nextStatus = await invoke<MacroStatus>("start_macro");
        setStatus(nextStatus);
      }
    } catch (err) {
      console.error(err);
      setToast("Macro başlatılırken bir sorun oluştu");
    } finally {
      setBusy(false);
    }
  };

  const toggleAutostart = async (next: boolean) => {
    try {
      if (next) await enableAutostart();
      else await disableAutostart();
      setAutostartOn(next);
    } catch (err) {
      console.error(err);
      setToast(language === "tr" ? "Otomatik başlatma ayarlanamadı" : "Failed to set autostart");
    }
  };

  const t = (key: string) => {
    const tr: Record<string, string> = {
      title: "Oyuncular için Gelişmiş Macro Sistemi",
      subtitle: "Minecraft, tarayıcı ve tüm pencerelerde global, doğal akış.",
      macro: "Mouse Macro",
      macroEngine: "Macro Kontrol Merkezi",
      mouseBtn: "Mouse butonu",
      mouseBtnLeft: "Sol",
      mouseBtnMiddle: "Orta",
      mouseBtnRight: "Sağ",
      keyboard: "Klavye macro",
      cpsWindow: "CPS aralığı",
      random: "Rastgeleleştirme",
      start: "Başlat",
      stop: "Durdur",
      settings: "Ayarlar",
      presence: "Görünürlük & güvenlik",
      startup: "Windows açılışında başlat",
      tray: "Tepsi modu",
      safe: "Güvenli mod",
      hotkey: "Kısayol",
      activationKey: "Aktivasyon tuşu",
      activationMode: "Aktivasyon modu",
      hold: "Basılı tut",
      toggle: "Aç/Kapa",
      clickLimit: "Tıklama limiti",
      duty: "Çalışma döngüsü",
      randomizeCps: "CPS rastgele",
      language: "Dil",
      profile: "Profil",
      compact: "Düzen",
      compactDesc: "Daha sıkı, masaüstü odaklı görünüm.",
      keyboardHint: "İsteğe bağlı: Boşluk tuşuna hafif dokunuşlar.",
      cpsHint: "Ani patlama yok, akış sabit.",
      randomHint: "Deseni doğal gösterir.",
      dutyHint: "Yüksek = daha az bekleme.",
      macroStatus: "Macro Durumu",
      statusRunning: "Aktif olarak çalışıyor",
      statusIdle: "Başlatmak için butona tıklayın",
      statusArmed: "Tuşa basılmaya hazır",
      statusHold: "Başlatmak için tuşa basılı tutun",
      dismiss: "Kapat",
      infoRandomization: "Tıklamalar arasındaki gecikmeyi rastgele değiştirerek insan eliyle yapılmış gibi doğal görünmesini sağlar. Anti-cheat sistemlerine yakalanmama şansını artırır.",
      infoDutyCycle: "Tıklama süresi (basılı tutma) ile bekleme süresi arasındaki oranı ayarlar. %50, eşit sürede basılı tutma ve bekleme demektir. Yüksek değerler daha agresif tıklama sağlar.",
      infoClickLimit: "Belirlenen tıklama sayısına ulaştığında makroyu otomatik olarak durdurur. AFK bırakırken belirli bir işlem sayısı için kullanışlıdır.",
      infoRandomizeCPS: "CPS değerini sabit tutmak yerine, Min ve Max CPS değerleri arasında sürekli değiştirir. Bu, daha doğal ve tespit edilmesi zor bir tıklama profili oluşturur.",
      pressAnyKey: "Bir tuşa basın...",
      dashboard: "Kontrol Paneli",
      infoActivationKey: "Makronun çalışmasını başlatacağınız veya durduracağınız tuş.",
      infoActivationMode: "Aç/Kapa: Bir kere basınca çalışır, tekrar basınca durur. Basılı Tut: Sadece tuşa basılı tuttuğunuz sürece çalışır.",
    };
    const en: Record<string, string> = {
      title: "Advanced Macro System for Gamers",
      subtitle: "Glassy, global, works in Minecraft, browsers, every window.",
      macro: "Mouse Macro",
      macroEngine: "Macro Engine",
      mouseBtn: "Mouse button",
      mouseBtnLeft: "Left",
      mouseBtnMiddle: "Middle",
      mouseBtnRight: "Right",
      keyboard: "Keyboard macro",
      cpsWindow: "CPS window",
      random: "Randomization",
      start: "Start",
      stop: "Stop",
      settings: "Settings",
      presence: "Presence & safety",
      startup: "Launch on Windows startup",
      tray: "Tray mode",
      safe: "Safe mode",
      hotkey: "Hotkey",
      activationKey: "Activation key",
      activationMode: "Activation mode",
      hold: "Hold",
      toggle: "Toggle",
      clickLimit: "Click limit",
      duty: "Duty cycle",
      randomizeCps: "Randomize CPS",
      language: "Language",
      profile: "Profile",
      compact: "Layout",
      compactDesc: "Tighter, desktop-focused view.",
      keyboardHint: "Optional: light taps on spacebar.",
      cpsHint: "No sudden bursts, flow is steady.",
      randomHint: "Makes pattern look natural.",
      dutyHint: "Higher = less idle time.",
      clickLimitDesc: "Stop after N clicks.",
      randomizeCpsDesc: "Vary between Min/Max.",
      macroStatus: "Macro Status",
      statusRunning: "Actively running",
      statusIdle: "Click button to start",
      statusArmed: "Ready for hotkey",
      statusHold: "Hold key to start",
      dismiss: "Dismiss",
      infoRandomization: "Randomizes the delay between clicks to mimic human behavior. Increases the chance of bypassing anti-cheat systems.",
      infoDutyCycle: "Adjusts the ratio between click press duration and release time. 50% means equal press and release time. Higher values provide more aggressive clicking.",
      infoClickLimit: "Automatically stops the macro after reaching the specified limit. Useful for performing a set number of actions while AFK.",
      infoRandomizeCPS: "Constantly varies the CPS between Min and Max values instead of keeping it fixed. Creates a more natural and harder-to-detect clicking profile.",
      pressAnyKey: "Press any key...",
      dashboard: "Dashboard",
      infoActivationKey: "The key that starts or stops the macro execution.",
      infoActivationMode: "Toggle: Runs when pressed and released. Hold: Runs only while the key is held down.",
    };
    return (language === "tr" ? tr : en)[key] || key;
  };

  return (
    <div className="frame">
      <div className="sidebar">
        <div className="brand">
          <img src="/twiez.png" alt="Twiez Macro" className="logo-img" />
          <div>
            <div className="brand-name">Twiez Macro</div>
            <div className="brand-sub">Global macro</div>
          </div>
        </div>
        <nav className="nav">
          <NavItem
            icon={<LayoutDashboard size={16} />}
            label={t("dashboard")}
            active={route === "dashboard"}
            onClick={() => setRoute("dashboard")}
          />
          <NavItem
            icon={<Settings size={16} />}
            label={t("settings")}
            active={route === "settings"}
            onClick={() => setRoute("settings")}
          />
        </nav>
        <button 
          onClick={async () => {
            try {
              await invoke('open_url', { url: 'https://github.com/twiez' });
            } catch (err) {
              console.error('Failed to open URL:', err);
            }
          }}
          className="sidebar-github"
          type="button"
        >
          <img src="/GitHub_Invertocat_Black.svg" alt="GitHub" className="github-icon" />
          <span>GitHub</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="external-icon">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </button>
      </div>

      <div className="page">
        <div className="bg-glow" />
        <div className="bg-glow-2" />

        <div className="titlebar" data-tauri-drag-region>
          <div className="titlebar-left" data-tauri-drag-region>
            <span className="app-title">Twiez Macro</span>
          </div>
          <div className="titlebar-controls">
            <button
              type="button"
              className="tb-btn"
              aria-label="Minimize"
              onClick={() => {
                // Tauri window controls – assume desktop context
                getCurrentWindow().minimize();
              }}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="tb-btn"
              aria-label="Maximize"
              onClick={() => {
                getCurrentWindow().toggleMaximize();
              }}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              className="tb-btn close"
              aria-label="Close"
              onClick={() => {
                getCurrentWindow().close();
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="content">
          <header className="hero">
            <div className="hero-top">
              <div className="hero-headline">
                <h1>{t("title")}</h1>
                <p>{t("subtitle")}</p>
              </div>

            </div>
          </header>

          <main className="grid">
        {route === "dashboard" ? (
        <>
        <section className="card glass main-controls">
          <div className="card-head">
            <div>
              <p className="eyebrow">{t("macroEngine")}</p>
              <h2>{t("macro")}</h2>
            </div>
          </div>

          <div className="controls-grid">
            <div className="control">
              <div className="control-head">
                <MousePointer2 size={18} />
                <span>{t("mouseBtn")}</span>
              </div>
              <div className="segmented">
                {(["left", "middle", "right"] as MacroButton[]).map((btn) => (
                  <button
                    key={btn}
                    className={settings.button === btn ? "segment active" : "segment"}
                    onClick={() => pushSettings({ ...settings, button: btn })}
                  >
                    {btn === "left" ? t("mouseBtnLeft") : btn === "right" ? t("mouseBtnRight") : t("mouseBtnMiddle")}
                  </button>
                ))}
              </div>
            </div>



            <div className="control span-2">
              <div className="control-head">
                <Wand2 size={18} />
                <span>{t("cpsWindow")}</span>
              </div>
              <div className="slider-row">
                <div className="slider-block">
                  <label>Min CPS</label>
                  <input
                    type="range"
                    min={4}
                    max={20}
                    value={settings.min_cps}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      const next = { ...settings, min_cps: Math.min(value, settings.max_cps) };
                      pushSettings(next);
                    }}
                  />
                  <span className="value">{settings.min_cps}</span>
                </div>
                <div className="slider-block">
                  <label>Max CPS</label>
                  <input
                    type="range"
                    min={settings.min_cps}
                    max={100}
                    value={settings.max_cps}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      const next = { ...settings, max_cps: Math.max(value, settings.min_cps) };
                      pushSettings(next);
                    }}
                  />
                  <span className="value">{settings.max_cps}</span>
                </div>
              </div>

            </div>

            <div className="control span-2 advanced-grid">
              <AdvancedSlider
                icon={<Sparkles size={16} />}
                label={t("random")}
                value={settings.randomization}
                min={0}
                max={0.45}
                step={0.01}
                onChange={(value) => pushSettings({ ...settings, randomization: value })}
                pill={`${(settings.randomization * 100).toFixed(0)}%`}
                onInfo={() => setToast(t("infoRandomization"))}
              />
              <AdvancedSlider
                icon={<SwitchCamera size={16} />}
                label={t("duty")}
                value={settings.duty_cycle}
                min={0.1}
                max={0.9}
                step={0.05}
                onChange={(value) => pushSettings({ ...settings, duty_cycle: value })}
                pill={`${(settings.duty_cycle * 100).toFixed(0)}%`}
                onInfo={() => setToast(t("infoDutyCycle"))}
              />
              <AdvancedToggle
                icon={<Gauge size={16} />}
                title={t("clickLimit")}
                description=""
                checked={settings.click_limit_enabled}
                onToggle={(checked) => pushSettings({ ...settings, click_limit_enabled: checked })}
                extra={
                  settings.click_limit_enabled && (
                    <div className="select-chip">
                      <input
                        type="number"
                        className="number-input"
                        value={settings.click_limit}
                        onChange={(e) =>
                          pushSettings({ ...settings, click_limit: Math.max(0, Number(e.target.value)) })
                        }
                      />
                    </div>
                  )
                }
                onInfo={() => setToast(t("infoClickLimit"))}
              />
              <AdvancedToggle
                icon={<Sparkles size={16} />}
                title={t("randomizeCps")}
                description=""
                checked={settings.randomize_cps}
                onToggle={(checked) => pushSettings({ ...settings, randomize_cps: checked })}
                onInfo={() => setToast(t("infoRandomizeCPS"))}
              />
            </div>

            <div className="control span-2 advanced-grid">
              <div className="advanced">
                <div className="advanced-head">
                  <span className="adv-icon">
                    <KeySquare size={16} />
                  </span>
                  <div className="adv-text">
                    <div className="adv-label">
                      {t("activationKey")}
                      <InfoButton onClick={() => setToast(t("infoActivationKey"))} />
                    </div>
                  </div>
                  <button
                    className={isRecordingKey ? "key-recorder recording" : "key-recorder"}
                    onClick={() => setIsRecordingKey(true)}
                    onKeyDown={(e) => {
                      if (isRecordingKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                        pushSettings({ ...settings, activation_key: key, hotkey: key });
                        setIsRecordingKey(false);
                      }
                    }}
                    onMouseDown={(e) => {
                      if (isRecordingKey && (e.button === 3 || e.button === 4)) {
                        e.preventDefault();
                        e.stopPropagation();
                        const key = e.button === 3 ? "XButton1" : "XButton2";
                        pushSettings({ ...settings, activation_key: key, hotkey: key });
                        setIsRecordingKey(false);
                      }
                    }}
                    onBlur={() => setIsRecordingKey(false)}
                    type="button"
                  >
                    {isRecordingKey ? t("pressAnyKey") : settings.activation_key || "F6"}
                  </button>
                </div>
              </div>

              <AdvancedSelect
                icon={<KeySquare size={16} />}
                label={t("activationMode")}
                value={settings.activation_mode}
                options={["toggle", "hold"]}
                labels={{ toggle: t("toggle"), hold: t("hold") }}
                onChange={(value) => pushSettings({ ...settings, activation_mode: value as "toggle" | "hold" })}
                onInfo={() => setToast(t("infoActivationMode"))}
              />
            </div>
          </div>
        </section>
        <section className="card glass action-card">
          <div className="action-card-content">

            <button
              className={status.running || status.armed ? "cta stop" : "cta"}
              onClick={handleStartStop}
              disabled={busy}
            >
              {status.running || status.armed ? <Square size={20} /> : <Play size={20} />}
              {status.running || status.armed ? t("stop") : t("start")}
            </button>
          </div>
        </section>
        </>
        ) : (
          <section className="card glass secondary span-2">
            <div className="card-head">
              <div>
                <p className="eyebrow">{t("settings")}</p>
                <h2>{t("presence")}</h2>
              </div>
            </div>

            <div className="stack">
              <SettingRow
                icon={<Languages size={16} />}
                title={t("language")}
                description={language === "tr" ? "Türkçe" : "English"}
                checked={false}
                customRight={
                  <div className="segmented tiny">
                    {(["tr", "en"] as const).map((lng) => (
                      <button
                        key={lng}
                        className={language === lng ? "segment active" : "segment"}
                        onClick={() => {
                          setLanguage(lng);
                          pushSettings({ ...settings, language: lng });
                        }}
                        type="button"
                      >
                        {lng.toUpperCase()}
        </button>
                    ))}
                  </div>
                }
              />
              <SettingRow
                icon={<Bolt size={16} />}
                title={t("startup")}
                description={language === "tr" ? "Windows açılışında otomatik başlat." : "Launch on Windows startup."}
                checked={autostartOn}
                onToggle={(checked) => {
                  toggleAutostart(checked);
                  pushSettings({ ...settings, startup_on_boot: checked });
                }}
              />
              <SettingRow
                icon={<img src="/discord-icon-svgrepo-com.svg" alt="Discord" style={{ width: 16, height: 16 }} />}
                title="Discord RPC"
                description={language === "tr" ? "Discord durumunda 'Twiez Macro' göster." : "Show 'Twiez Macro' in Discord status."}
                checked={settings.discord_enabled}
                onToggle={(checked) => pushSettings({ ...settings, discord_enabled: checked })}
              />
              <SettingRow
                icon={<SwitchCamera size={16} />}
                title={t("tray")}
                description={language === "tr" ? "Tepside çalış, gizli kal." : "Run in tray when hidden."}
                checked={settings.tray_mode}
                onToggle={(checked) => pushSettings({ ...settings, tray_mode: checked })}
              />
              <SettingRow
                icon={<ShieldCheck size={16} />}
                title={t("safe")}
                description={language === "tr" ? "Anında durdurma güvenliği." : "Instant stop safety."}
                checked={settings.safe_mode}
                onToggle={(checked) => pushSettings({ ...settings, safe_mode: checked })}
              />
            </div>
          </section>
        )}
          </main>
        </div>

      {toast && (
        <div className="toast">
          {toast}
          <button onClick={() => setToast(null)}>{t("dismiss")}</button>
        </div>
      )}
      </div>
    </div>
  );
}

type SettingRowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onToggle?: (next: boolean) => void;
  readOnly?: boolean;
  customRight?: ReactNode;
};

function SettingRow({ icon, title, description, checked, onToggle, readOnly, customRight }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div className="setting-icon">{icon}</div>
      <div className="setting-copy">
        <div className="setting-title">{title}</div>
        <div className="setting-desc">{description}</div>
      </div>
      {customRight}
      {onToggle ? (
        <label className="toggle">
          <input
            type="checkbox"
            checked={checked}
            readOnly={readOnly}
            disabled={readOnly}
            onChange={(e) => onToggle?.(e.target.checked)}
          />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </label>
      ) : null}
    </div>
  );
}

type AdvancedSliderProps = {
  icon: ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  hint?: string;
  pill?: string;
  onInfo?: () => void;
};

function AdvancedSlider({ icon, label, value, min, max, step = 1, onChange, hint, pill, onInfo }: AdvancedSliderProps) {
  return (
    <div className="advanced">
      <div className="advanced-head">
        <span className="adv-icon">{icon}</span>
        <div className="adv-text">
          <div className="adv-label">
            {label}
            {onInfo && (
              <button
                type="button"
                className="info-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onInfo();
                }}
              >
                <Info size={12} />
              </button>
            )}
          </div>
          {hint && <div className="adv-hint">{hint}</div>}
        </div>
        {pill && <span className="pill ghost">{pill}</span>}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

type AdvancedToggleProps = {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onToggle: (next: boolean) => void;
  extra?: ReactNode;
  onInfo?: () => void;
};

function AdvancedToggle({ icon, title, description, checked, onToggle, extra, onInfo }: AdvancedToggleProps) {
  return (
    <div className="advanced">
      <div className="advanced-head">
        <span className="adv-icon">{icon}</span>
        <div className="adv-text">
          <div className="adv-label">
            {title}
            {onInfo && (
              <button
                type="button"
                className="info-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onInfo();
                }}
              >
                <Info size={12} />
              </button>
            )}
          </div>
          <div className="adv-hint">{description}</div>
        </div>
        {extra}
        <label className="toggle">
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </label>
      </div>
    </div>
  );
}

type AdvancedSelectProps = {
  icon: ReactNode;
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
  onInfo?: () => void;
};

function AdvancedSelect({ icon, label, value, options, onChange, labels, onInfo }: AdvancedSelectProps) {
  return (
    <div className="advanced">
      <div className="advanced-head">
        <span className="adv-icon">{icon}</span>
        <div className="adv-text">
          <div className="adv-label">
            {label}
            {onInfo && <InfoButton onClick={onInfo} />}
          </div>
        </div>
        <div className="select-chip">
          <select value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {labels?.[opt] ?? opt}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </div>
    </div>
  );
}

type NavItemProps = { icon: ReactNode; label: string; active?: boolean; onClick?: () => void };
function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button className={active ? "nav-item active" : "nav-item"} onClick={onClick} type="button">
      <span className="nav-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
type InfoButtonProps = { onClick: () => void };
function InfoButton({ onClick }: InfoButtonProps) {
  return (
    <button className="info-btn" onClick={onClick} type="button">
      <Info size={12} />
    </button>
  );
}

export default App;
