import type { AppSettings } from '@/types';

interface HeaderProps {
  settings: AppSettings;
  isProjectActive?: boolean;
  projectTitle?: string;
  onOpenSettings: () => void;
  onOpenFilterSettings: () => void;
  onOpenVfxUpdater?: () => void;
  onOpenConsole?: () => void;
  onCloseProject?: () => void;
  onReset: () => void;
  addDebugLog: (msg: string) => void;
  onToggleMinimize?: () => void;
}

export function Header({
  settings,
  isProjectActive = false,
  projectTitle,
  onOpenSettings,
  onOpenFilterSettings,
  onOpenVfxUpdater,
  onOpenConsole,
  onCloseProject,
  onReset,
  addDebugLog,
}: HeaderProps) {
  const handleResetClick = () => {
    if (isProjectActive) {
      if (onCloseProject) {
        onCloseProject();
      } else if (window.confirm('Discard current workspace and return to the main menu?')) {
        addDebugLog('Workspace reset confirmed');
        onReset();
      }
    } else {
      onReset();
    }
  };

  return (
    <header
      className="relative flex items-center justify-between px-4 h-12 border-2 transition-all duration-150 select-none shadow-md"
      style={{
        backgroundColor: 'var(--bg-3)',
        borderColor: 'var(--bg-2)',
        height: '48px',
        minHeight: '48px',
      }}
    >
      {/* Left: Active Workspace / Navigation */}
      <div className="flex items-center gap-3">
        {isProjectActive ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleResetClick}
              title="Close current project and return to main menu"
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded border transition-all duration-150 hover:shadow"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                borderColor: 'rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span>Back to Menu</span>
            </button>
            {projectTitle && (
              <span
                className="hidden sm:inline-block text-xs font-mono px-2 py-0.5 rounded border border-gray-700/50 max-w-[260px] truncate"
                style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-2)' }}
                title={projectTitle}
              >
                {projectTitle}
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Right: Quick Action Controls & Console */}
      <div className="flex items-center gap-2">
        {/* Prominent Live Console Button */}
        {onOpenConsole && (
          <button
            type="button"
            onClick={onOpenConsole}
            title="Open Live Diagnostic Console"
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-bold rounded border transition-all hover:brightness-125 hover:shadow"
            style={{
              backgroundColor: 'rgba(6, 182, 212, 0.12)',
              borderColor: 'rgba(6, 182, 212, 0.4)',
              color: '#22d3ee',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span>Console</span>
          </button>
        )}

        {/* VFX Updater Tool */}
        {onOpenVfxUpdater && (
          <button
            type="button"
            title="VFX Updater"
            onClick={onOpenVfxUpdater}
            className="p-1.5 rounded transition-colors hover:bg-white/10"
            style={{ color: '#60a5fa' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        )}

        {/* Filter Settings */}
        <button
          type="button"
          title="Filter Dictionary & Parser Settings"
          onClick={onOpenFilterSettings}
          className="p-1.5 rounded transition-colors hover:bg-white/10 text-gray-400 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 13.5V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m12-3V3.75m0 9.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 3.75V16.5m-6-9V3.75m0 3.75a1.5 1.5 0 0 1 0 3m0-3a1.5 1.5 0 0 0 0 3m0 9.75V10.5" />
          </svg>
        </button>

        {/* App Settings */}
        <button
          type="button"
          title="Settings"
          onClick={onOpenSettings}
          className="relative p-1.5 rounded transition-colors hover:bg-white/10 text-gray-400 hover:text-white"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {!settings.usmapPath && (
            <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
          )}
        </button>

        {/* Workspace Reset Button */}
        <button
          type="button"
          title="Reset Workspace"
          onClick={handleResetClick}
          className="p-1.5 rounded transition-colors hover:bg-white/10 text-gray-400 hover:text-red-400"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
