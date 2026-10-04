import { useState, useEffect } from 'react';
import * as tauri from '@/services/tauri';

export interface VfxUpdaterModalProps {
  initialUsmapPath: string | null;
  initialModPath?: string | null;
  onClose: () => void;
  addDebugLog: (msg: string) => void;
}

export function VfxUpdaterModal({
  initialUsmapPath,
  initialModPath,
  onClose,
  addDebugLog,
}: VfxUpdaterModalProps) {
  const [usmapPath, setUsmapPath] = useState<string>(initialUsmapPath || '');
  const [modPath, setModPath] = useState<string>(initialModPath || '');
  const [outputDir, setOutputDir] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isFetchingUsmap, setIsFetchingUsmap] = useState(false);
  const [statusLog, setStatusLog] = useState<string[]>([]);

  const appendLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setStatusLog(prev => [...prev, `[${time}] ${msg}`]);
    addDebugLog(`[VfxUpdater] ${msg}`);
  };

  useEffect(() => {
    if (initialUsmapPath) {
      appendLog(`USMAP loaded from settings: ${initialUsmapPath.split(/[\\/]/).pop()}`);
    }
  }, [initialUsmapPath]);

  const handleFetchUsmap = async () => {
    setIsFetchingUsmap(true);
    appendLog('Fetching latest USMAP from remote...');
    try {
      const status = await tauri.fetchLatestUsmap();
      if (status.file_path) {
        setUsmapPath(status.file_path);
        appendLog(`Latest USMAP downloaded (${status.file_name}). Selected.`);
      } else {
        appendLog('Fetched USMAP metadata, but no file path returned.');
      }
    } catch (err: any) {
      appendLog(`Failed to fetch latest USMAP: ${err}`);
    } finally {
      setIsFetchingUsmap(false);
    }
  };

  const handleBrowseUsmap = async () => {
    try {
      const path = await tauri.openDialog({
        filters: [{ name: 'Unreal Mappings', extensions: ['usmap'] }],
        multiple: false,
        title: 'Select .usmap file',
      });
      if (path) {
        setUsmapPath(path as string);
        appendLog(`Selected USMAP: ${(path as string).split(/[\\/]/).pop()}`);
      }
    } catch (err) {
      console.error('Failed to browse usmap:', err);
    }
  };

  const handleBrowseMod = async () => {
    try {
      const path = await tauri.openDialog({
        filters: [{ name: 'Mod Container', extensions: ['utoc', 'pak'] }],
        multiple: false,
        title: 'Select Mod File (.utoc or .pak) to update',
      });
      if (path) {
        setModPath(path as string);
        appendLog(`Selected Mod File: ${(path as string).split(/[\\/]/).pop()}`);

        // Automatically suggest the same parent directory as output if not set
        if (!outputDir) {
          const parentDir = (path as string).replace(/[\\/][^\\/]+$/, '');
          setOutputDir(parentDir);
        }
      }
    } catch (err) {
      console.error('Failed to browse mod:', err);
    }
  };

  const handleBrowseOutput = async () => {
    try {
      const path = await tauri.openDialog({
        directory: true,
        multiple: false,
        title: 'Select Output Directory for Updated Mod',
      });
      if (path) {
        setOutputDir(path as string);
        appendLog(`Selected Output Dir: ${path}`);
      }
    } catch (err) {
      console.error('Failed to browse output dir:', err);
    }
  };

  const handleUpdateMod = async () => {
    if (!modPath) {
      alert('Please select a mod file (.utoc) to update.');
      return;
    }
    if (!outputDir) {
      alert('Please select an output directory.');
      return;
    }

    setIsUpdating(true);
    appendLog(`Starting mod update for: ${modPath.split(/[\\/]/).pop()}...`);

    try {
      const result = await tauri.updateVfxMod(modPath, usmapPath || null, outputDir);
      if (result.success) {
        appendLog(`✓ ${result.message}`);
        if (result.output_path) {
          await tauri.openFolder(outputDir);
        }
        alert(result.message);
      } else {
        appendLog(`✗ Update failed: ${result.message}`);
        alert(`Update failed: ${result.message}`);
      }
    } catch (err: any) {
      appendLog(`✗ Error during update: ${err.message || err}`);
      alert(`Error updating mod: ${err.message || err}`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="w-full max-w-xl border-2 shadow-2xl flex flex-col overflow-hidden"
        style={{ backgroundColor: '#121316', borderColor: '#262930' }}
      >
        {/* Header matching Saturn / Repak VFX aesthetic */}
        <div className="p-4 border-b flex justify-between items-center" style={{ borderColor: '#262930' }}>
          <div className="flex items-center gap-2">
            <span className="text-xl font-black tracking-widest bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              REPAK VFX
            </span>
            <span className="text-xs px-2 py-0.5 font-mono rounded bg-blue-900/40 text-blue-300 border border-blue-700/50">
              UPDATER
            </span>
          </div>
          <button onClick={onClose} disabled={isUpdating} className="text-gray-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* USMAP Field */}
          <div className="space-y-1.5">
            <label className="block font-bold tracking-wider uppercase text-gray-400">
              USMAP FILE
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={usmapPath || ''}
                placeholder="No .usmap selected (fetch latest or browse)"
                className="flex-1 px-3 py-2 border font-mono truncate"
                style={{ backgroundColor: '#1a1c23', borderColor: '#2e323e', color: '#e5e7eb' }}
              />
              <button
                type="button"
                onClick={handleFetchUsmap}
                disabled={isFetchingUsmap || isUpdating}
                className="px-3 py-2 font-bold border transition-colors hover:brightness-125 disabled:opacity-50"
                style={{ backgroundColor: '#262935', borderColor: '#3b4252', color: '#88a4e6' }}
              >
                {isFetchingUsmap ? 'Fetching...' : 'Fetch'}
              </button>
              <button
                type="button"
                onClick={handleBrowseUsmap}
                disabled={isUpdating}
                className="px-3 py-2 font-bold border transition-colors hover:brightness-125"
                style={{ backgroundColor: '#262935', borderColor: '#3b4252', color: '#e5e7eb' }}
              >
                Browse
              </button>
            </div>
          </div>

          {/* Mod File Field */}
          <div className="space-y-1.5">
            <label className="block font-bold tracking-wider uppercase text-gray-400">
              MOD FILE (.UTOC)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={modPath || ''}
                placeholder="Select mod to update (.utoc)..."
                className="flex-1 px-3 py-2 border font-mono truncate"
                style={{ backgroundColor: '#1a1c23', borderColor: '#2e323e', color: '#e5e7eb' }}
              />
              <button
                type="button"
                onClick={handleBrowseMod}
                disabled={isUpdating}
                className="px-3 py-2 font-bold border transition-colors hover:brightness-125"
                style={{ backgroundColor: '#262935', borderColor: '#3b4252', color: '#e5e7eb' }}
              >
                Browse
              </button>
            </div>
          </div>

          {/* Output Directory Field */}
          <div className="space-y-1.5">
            <label className="block font-bold tracking-wider uppercase text-gray-400">
              OUTPUT DIRECTORY
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={outputDir || ''}
                placeholder="Select destination for updated mod..."
                className="flex-1 px-3 py-2 border font-mono truncate"
                style={{ backgroundColor: '#1a1c23', borderColor: '#2e323e', color: '#e5e7eb' }}
              />
              <button
                type="button"
                onClick={handleBrowseOutput}
                disabled={isUpdating}
                className="px-3 py-2 font-bold border transition-colors hover:brightness-125"
                style={{ backgroundColor: '#262935', borderColor: '#3b4252', color: '#e5e7eb' }}
              >
                Browse
              </button>
            </div>
          </div>

          {/* UPDATE MOD Action Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleUpdateMod}
              disabled={isUpdating || !modPath || !outputDir}
              className="w-full py-4 font-black tracking-widest uppercase text-sm transition-all duration-200 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed border"
              style={{
                backgroundColor: isUpdating ? '#262935' : '#1e293b',
                color: '#38bdf8',
                borderColor: '#0284c7',
              }}
            >
              {isUpdating ? 'UPDATING MOD CONTAINER...' : 'UPDATE MOD'}
            </button>
          </div>

          {/* Status / Output Log Console */}
          <div
            className="p-3 border rounded font-mono text-[11px] h-28 overflow-y-auto space-y-1"
            style={{ backgroundColor: '#0c0d10', borderColor: '#22252c', color: '#94a3b8' }}
          >
            {statusLog.length === 0 ? (
              <span className="opacity-40">Ready. Select mod file and new USMAP mapping file to proceed.</span>
            ) : (
              statusLog.map((line, i) => (
                <div key={i} className={line.includes('✓') ? 'text-green-400' : line.includes('✗') ? 'text-red-400' : ''}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t flex justify-end" style={{ borderColor: '#262930', backgroundColor: '#0f1013' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isUpdating}
            className="px-5 py-1.5 text-xs font-medium border"
            style={{ backgroundColor: '#1a1c23', color: '#94a3b8', borderColor: '#2e323e' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
