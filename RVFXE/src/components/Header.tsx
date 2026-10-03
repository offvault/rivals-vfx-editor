import { useRef, useCallback } from 'react';
import { Particles } from './ui/Particles';
import type { AppSettings } from '@/types';

interface HeaderProps {
  settings: AppSettings;
  onOpenSettings: () => void;
  onOpenFilterSettings: () => void;
  onOpenVfxUpdater?: () => void;
  onReset: () => void;
  addDebugLog: (msg: string) => void;
  onToggleMinimize: () => void;
}

export function Header({
  settings,
  onOpenSettings,
  onOpenFilterSettings,
  onOpenVfxUpdater,
  onReset,
  addDebugLog,
  onToggleMinimize,
}: HeaderProps) {
  const isMinimized = settings.isHeaderMinimized ?? false;
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pressStartTimeRef = useRef<number | null>(null);

  const shakeEffect = useCallback(() => {
    if (!resetButtonRef.current || !pressStartTimeRef.current) return;
    const elapsedTime = Date.now() - pressStartTimeRef.current;
    const progress = Math.min(elapsedTime / 2000, 1);
    const maxIntensity = 4;
    const currentIntensity = maxIntensity * progress;
    const x = (Math.random() - 0.5) * 2 * currentIntensity;
    const y = (Math.random() - 0.5) * 2 * currentIntensity;
    resetButtonRef.current.style.transform = `translate(${x}px, ${y}px)`;
    animationFrameRef.current = requestAnimationFrame(shakeEffect);
  }, []);

  const handleResetPress = () => {
    pressStartTimeRef.current = Date.now();
    animationFrameRef.current = requestAnimationFrame(shakeEffect);
    resetTimerRef.current = setTimeout(async () => {
      addDebugLog('Editor reset triggered (cache preserved)');
      onReset();
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (resetButtonRef.current) resetButtonRef.current.style.transform = 'translate(0, 0)';
    }, 2000);
  };

  const handleResetRelease = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (resetButtonRef.current) resetButtonRef.current.style.transform = 'translate(0, 0)';
  };

  return (
    <div className={`relative group border-2 particle-header ${isMinimized ? 'p-2' : 'p-4'}`} style={{ borderColor: 'var(--bg-2)' }}>
      {/* VFX Updater button */}
      {onOpenVfxUpdater && (
        <button
          title="Repak VFX Mod Updater"
          onClick={onOpenVfxUpdater}
          className="absolute top-1 p-2 rounded-full text-blue-400 hover:text-white hover:bg-blue-500/20 transition-colors z-10"
          style={{ right: '10.5rem' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
        </button>
      )}

      {/* Minimize button */}
      <button
        title={isMinimized ? "Maximize Header" : "Minimize Header"}
        onClick={onToggleMinimize}
        className="absolute top-1 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
        style={{ right: '8rem' }}
      >
        {isMinimized ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
        )}
      </button>
      {/* Advanced Filter Settings button */}
      <button
        title="Advanced Parser Settings"
        onClick={onOpenFilterSettings}
        className="absolute top-1 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
        style={{ right: '5.5rem' }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="24" height="24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" />
        </svg>
      </button>
      {/* Settings button */}
      <button
        title="Settings"
        onClick={onOpenSettings}
        className="absolute top-1 right-12 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        {!settings.usmapPath && (
          <span className="absolute top-2 right-2 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
        )}
      </button>
      {/* Reset button */}
      <button
        ref={resetButtonRef}
        title="Long press to Reset"
        className="absolute top-1 right-2 p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors z-10"
        onMouseDown={handleResetPress}
        onMouseUp={handleResetRelease}
        onMouseLeave={handleResetRelease}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
      <Particles />
      <div className="absolute inset-0 border-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" style={{ borderColor: 'var(--accent-main)', zIndex: 2 }}></div>
      <div className={`flex items-center gap-4 relative`} style={{ zIndex: 1 }}>
        <img src="./assets/saturn-logo.svg" alt="Rivals Logo" className={`${isMinimized ? 'h-6 transform scale-150 ml-2' : 'h-24'} filter brightness-0 invert transition-transform`} />
        <div className="flex items-baseline gap-3">
          <h1 className={`${isMinimized ? 'text-xl font-bold' : 'text-5xl font-normal'}`} style={{ color: 'var(--text-1)', fontFamily: isMinimized ? 'var(--font-main)' : undefined }}>Rivals VFX Editor</h1>
          <h2 className={`${isMinimized ? 'text-xs' : 'text-1xl'} font-medium`} style={{ color: 'var(--text-4)' }}>v3.5.0</h2>
        </div>
      </div>
      {!isMinimized && (
        <span className="absolute bottom-2 right-4 text-xs" style={{ color: 'var(--text-4)', zIndex: 1 }}>
          by Saturn
        </span>
      )}
    </div>
  );
}
