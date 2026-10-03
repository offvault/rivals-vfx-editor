import { useEffect, useRef } from 'react';
import type { AppSettings, CacheInfo } from '@/types';
import { ToggleSwitch } from '@/components/ui';
import * as tauri from '@/services/tauri';

/** Read-only path field scrolled to its tail, which is the part that identifies it. */
function PathField({ value, placeholder }: { value: string; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      readOnly
      placeholder={placeholder}
      title={value}
      className="flex-grow px-3 py-2 rounded-none text-sm"
      style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-3)' }}
    />
  );
}

interface SettingsModalProps {
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  heroBrowserCacheInfo: CacheInfo;
  vfxCacheInfo: CacheInfo;
  manualCacheInfo: CacheInfo;
  onClose: () => void;
  onClearHeroBrowserCache: () => void;
  onClearVfxCache: () => void;
  onClearManualCache: () => void;
}

export function SettingsModal({
  settings,
  setSettings,
  heroBrowserCacheInfo,
  vfxCacheInfo,
  manualCacheInfo,
  onClose,
  onClearHeroBrowserCache,
  onClearVfxCache,
  onClearManualCache,
}: SettingsModalProps) {
  const UI_SCALE_OPTIONS = [
    { value: 0.8, label: '80%' },
    { value: 0.9, label: '90%' },
    { value: 0.95, label: '95%' },
    { value: 1.0, label: '100%' },
    { value: 1.1, label: '110%' },
    { value: 1.25, label: '125%' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      {/* maxHeight is inline, not max-h-[90vh]: the vendored tailwind build has no
          arbitrary-value utilities, so that class generates no CSS at all. */}
      <div className="w-full max-w-md flex flex-col shadow-xl border-2 relative group" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-2)', maxHeight: '90vh' }}>
        <div className="absolute inset-0 border-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" style={{ borderColor: 'var(--accent-main)', zIndex: 10 }}></div>
        <div className="flex justify-between items-center p-6 pb-0 flex-shrink-0">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transform hover:scale-125 transition-transform duration-200" style={{ color: 'var(--text-2)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>

        <div className="space-y-6 flex-1 min-h-0 overflow-y-auto p-6">
          {/* Usmap Path */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              .usmap File Path
            </label>
            <div className="flex gap-2">
              <PathField
                value={settings.usmapPath || ''}
                placeholder="No .usmap file selected"
              />
              <button
                onClick={async () => {
                  const path = await tauri.openDialog({
                    filters: [{ name: 'Usmap', extensions: ['usmap'] }],
                    multiple: false,
                    title: 'Select .usmap mapping file',
                  });
                  if (path) {
                    console.debug('[SettingsModal] Setting usmap path:', path);
                    await tauri.setUsmapPath(path as string);
                    setSettings(prev => ({ ...prev, usmapPath: path as string }));
                  }
                }}
                className="px-4 py-2 font-medium rounded-none"
                style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
              >
                Browse
              </button>
            </div>
            <button
              onClick={async () => {
                try {
                  const status = await tauri.fetchLatestUsmap();
                  if (status.file_path) {
                    setSettings(prev => ({ ...prev, usmapPath: status.file_path! }));
                  }
                } catch (e) {
                  console.error('[SettingsModal] Failed to pull usmap:', e);
                }
              }}
              className="w-full mt-2 px-4 py-2 text-sm font-medium rounded-none"
              style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-2)' }}
            >
              Pull Latest .usmap
            </button>
          </div>

          {/* Game Paks Path */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              Game Paks Directory
            </label>
            <div className="flex gap-2">
              <PathField
                value={settings.paksPath || ''}
                placeholder="No Paks directory selected"
              />
              <button
                onClick={async () => {
                  const path = await tauri.openDialog({
                    directory: true,
                    multiple: false,
                    title: 'Select Marvel Rivals Paks directory',
                  });
                  if (path) {
                    console.debug('[SettingsModal] Setting paks path:', path);
                    await tauri.setPaksPath(path as string);
                    setSettings(prev => ({ ...prev, paksPath: path as string }));
                  }
                }}
                className="px-4 py-2 font-medium rounded-none"
                style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
              >
                Browse
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>
              Path to the game's Paks folder
            </p>
          </div>

          {/* UI Scale */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              App UI Scale
            </label>
            <div className="flex flex-wrap gap-1">
              {UI_SCALE_OPTIONS.map(option => {
                const isSelected = (settings.uiScale ?? 1) === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={async () => {
                      const scale = option.value;
                      try {
                        console.debug('[SettingsModal] Setting UI scale:', scale);
                        await tauri.applyWebviewUiScale(scale);
                        await tauri.setUiScale(scale);
                        setSettings(prev => ({ ...prev, uiScale: scale }));
                      } catch (err) {
                        console.error('[SettingsModal] Failed to set UI scale:', err);
                      }
                    }}
                    className="px-2 py-1 text-xs font-medium rounded-none border leading-none"
                    style={{
                      backgroundColor: isSelected ? 'var(--accent-main)' : 'var(--bg-2)',
                      color: isSelected ? 'var(--bg-4)' : 'var(--text-3)',
                      borderColor: isSelected ? 'var(--accent-main)' : 'var(--bg-1)',
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hero Browser Cache */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              Hero Browser Cache
            </label>
            <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'var(--bg-2)' }}>
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>
                {heroBrowserCacheInfo.fileCount} files ({(heroBrowserCacheInfo.totalSizeBytes / 1024 / 1024).toFixed(1)} MB)
              </span>
              <button
                onClick={onClearHeroBrowserCache}
                className="px-3 py-1 text-sm font-medium rounded-none"
                style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-2)' }}
              >
                Clear
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>Icons, roster data, and localization files</p>
          </div>

          {/* VFX Cache */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              VFX Materials Cache
            </label>
            <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'var(--bg-2)' }}>
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>
                {vfxCacheInfo.fileCount} files ({(vfxCacheInfo.totalSizeBytes / 1024 / 1024).toFixed(1)} MB)
              </span>
              <button
                onClick={onClearVfxCache}
                className="px-3 py-1 text-sm font-medium rounded-none"
                style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-2)' }}
              >
                Clear
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>Extracted hero VFX assets and converted JSON files</p>
          </div>

          {/* Manual Extraction Cache */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-2)' }}>
              Manual Extraction Cache
            </label>
            <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'var(--bg-2)' }}>
              <span className="text-sm" style={{ color: 'var(--text-3)' }}>
                {manualCacheInfo.fileCount} files ({(manualCacheInfo.totalSizeBytes / 1024 / 1024).toFixed(1)} MB)
              </span>
              <button
                onClick={onClearManualCache}
                className="px-3 py-1 text-sm font-medium rounded-none"
                style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-2)' }}
              >
                Clear
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>Container asset index and manually extracted assets</p>
          </div>

          {/* Open Cache Folder */}
          <div className="flex justify-end">
            <button
              onClick={() => tauri.openCacheFolder()}
              className="px-3 py-1 text-sm font-medium rounded-none flex items-center gap-1"
              style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-3)' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              Open Cache Folder
            </button>
          </div>

          {/* Pak-Ready Directory Structure Toggle */}
          <ToggleSwitch
            label="Pak-Ready Directory Structure (Marvel/Content/...)"
            enabled={settings.pakReadyStructure ?? true}
            setEnabled={async (val) => {
              console.debug('[SettingsModal] Setting pakReadyStructure:', val);
              await tauri.setPakReadyStructure(val);
              setSettings(prev => ({ ...prev, pakReadyStructure: val }));
            }}
          />

          {/* Auto Clear Cache Toggle */}
          <ToggleSwitch
            label="Auto Clear VFX Cache on Exit"
            enabled={settings.autoClearCache}
            setEnabled={async (val) => {
              console.debug('[SettingsModal] Setting autoClearCache:', val);
              await tauri.setAutoClearCache(val);
              setSettings(prev => ({ ...prev, autoClearCache: val }));
            }}
          />
        </div>

        <div className="p-6 pt-0 text-center flex-shrink-0">
          <button
            onClick={onClose}
            className="px-8 py-2 font-medium rounded-none"
            style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
