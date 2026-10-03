import type { SessionEntry } from '@/types';

export interface RvfxpImportModalProps {
  filePath: string;
  sessionData: SessionEntry[];
  detectedHeroId: string | null;
  detectedHeroName: string | null;
  currentLoadedHeroId: string | null;
  onApplyCurrent: () => void;
  onFreshReimport: () => void;
  onClose: () => void;
}

export function RvfxpImportModal({
  filePath,
  sessionData,
  detectedHeroId,
  detectedHeroName,
  currentLoadedHeroId,
  onApplyCurrent,
  onFreshReimport,
  onClose,
}: RvfxpImportModalProps) {
  const fileName = filePath.split(/[\\/]/).pop() || 'preset.rvfxp';
  const paramCount = sessionData.length;
  const isHeroMismatch = detectedHeroId && currentLoadedHeroId && detectedHeroId !== currentLoadedHeroId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="w-full max-w-lg border-2 p-6 shadow-2xl space-y-5"
        style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--accent-main)' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start border-b pb-3" style={{ borderColor: 'var(--bg-1)' }}>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--accent-main)' }}>
              Import Project Preset (.rvfxp)
            </h3>
            <p className="text-xs font-mono mt-0.5 text-gray-300">
              {fileName} ({paramCount} color parameters)
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Hero Context */}
        <div className="p-3 border text-xs space-y-1" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-3)' }}>Preset Target:</span>
            <span className="font-bold text-white">
              {detectedHeroName || (detectedHeroId ? `Hero ID ${detectedHeroId}` : 'Generic / Unknown')}
            </span>
          </div>
          {currentLoadedHeroId && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-3)' }}>Currently Open in Editor:</span>
              <span className="font-mono text-gray-300">Hero ID {currentLoadedHeroId}</span>
            </div>
          )}
          {isHeroMismatch && (
            <p className="text-[11px] pt-1" style={{ color: 'var(--accent-warning, #f59e0b)' }}>
              ⚠️ Note: The preset appears to belong to hero {detectedHeroId}, but hero {currentLoadedHeroId} is currently open.
            </p>
          )}
        </div>

        {/* Choice Explanation */}
        <p className="text-xs" style={{ color: 'var(--text-2)' }}>
          How would you like to apply this preset?
        </p>

        {/* Action Buttons */}
        <div className="space-y-3">
          {/* Option 1 */}
          <button
            type="button"
            onClick={onApplyCurrent}
            className="w-full p-3 border text-left transition-colors hover:brightness-125 group flex flex-col gap-1"
            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold group-hover:text-[var(--accent-main)]" style={{ color: 'var(--text-1)' }}>
                1. Apply to Current Asset Parameters
              </span>
              <span className="text-xs font-mono opacity-50">Instant</span>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>
              Updates only the exact matching parameters on your currently loaded assets. Keeps your other unsaved modifications intact.
            </p>
          </button>

          {/* Option 2 */}
          <button
            type="button"
            onClick={onFreshReimport}
            disabled={!detectedHeroId}
            className="w-full p-3 border text-left transition-colors hover:brightness-125 group flex flex-col gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--accent-main)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[var(--accent-main)]">
                2. Fresh Game Re-extract & Apply Preset
              </span>
              <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent-main)' }}>Recommended</span>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>
              Freshly extracts clean original assets directly from game containers for {detectedHeroName || `Hero ${detectedHeroId}`}, clearing any dirty state, and cleanly applies all preset parameters on top.
            </p>
          </button>
        </div>

        {/* Cancel */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium border"
            style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-3)', borderColor: 'var(--bg-1)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
