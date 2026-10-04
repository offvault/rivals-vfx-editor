import type { SessionEntry, RvfxpPresetV2, RvfxpRecipe } from '@/types';

export interface RvfxpImportModalProps {
  filePath: string;
  presetV2?: RvfxpPresetV2 | null;
  sessionData: SessionEntry[];
  detectedHeroId: string | null;
  detectedHeroName: string | null;
  currentLoadedHeroId: string | null;
  onApplyExactMatch: () => void;
  onApplyRecipeFresh: (recipe?: RvfxpRecipe) => void;
  onClose: () => void;
}

export function RvfxpImportModal({
  filePath,
  presetV2,
  sessionData,
  detectedHeroId,
  detectedHeroName,
  currentLoadedHeroId,
  onApplyExactMatch,
  onApplyRecipeFresh,
  onClose,
}: RvfxpImportModalProps) {
  const fileName = filePath.split(/[\\/]/).pop() || 'preset.rvfxp';
  const paramCount = sessionData.length;
  const isHeroMismatch = detectedHeroId && currentLoadedHeroId && detectedHeroId !== currentLoadedHeroId;
  const isV2 = !!presetV2 && presetV2.version === 2;
  const recipe = presetV2?.recipe;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="w-full max-w-xl border-2 p-6 shadow-2xl space-y-5"
        style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--accent-main)' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start border-b pb-3" style={{ borderColor: 'var(--bg-1)' }}>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold" style={{ color: 'var(--accent-main)' }}>
                Import Project Preset (.rvfxp)
              </h3>
              <span
                className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-none"
                style={{
                  backgroundColor: isV2 ? 'var(--accent-green)' : 'var(--bg-1)',
                  color: 'var(--text-1)',
                }}
              >
                {isV2 ? 'Recipe V2 (Patch-Proof)' : 'Legacy V1'}
              </span>
            </div>
            <p className="text-xs font-mono mt-0.5 text-gray-300">
              {fileName} ({paramCount} color parameters)
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Hero Context & Recipe Info */}
        <div className="p-3 border text-xs space-y-2" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-3)' }}>Preset Target:</span>
            <span className="font-bold text-white">
              {detectedHeroName || (detectedHeroId ? `Hero ID ${detectedHeroId}` : 'Generic / Multi-Asset')}
            </span>
          </div>

          {currentLoadedHeroId && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-3)' }}>Currently Open in Editor:</span>
              <span className="font-mono text-gray-300">Hero ID {currentLoadedHeroId}</span>
            </div>
          )}

          {/* Recipe details if V2 */}
          {recipe && (
            <div className="pt-2 border-t space-y-1.5" style={{ borderColor: 'var(--bg-1)' }}>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-3)' }}>Recipe Mode:</span>
                <span className="font-semibold uppercase tracking-wider text-[var(--accent-main)]">
                  {recipe.mode}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-3)' }}>Recipe Palette:</span>
                <div className="flex items-center gap-1.5">
                  {recipe.masterColor && (
                    <div
                      className="w-4 h-4 border border-gray-600 rounded-none"
                      style={{ backgroundColor: recipe.masterColor }}
                      title={`Master: ${recipe.masterColor}`}
                    />
                  )}
                  {recipe.enemyColor && (
                    <div
                      className="w-4 h-4 border border-gray-600 rounded-none"
                      style={{ backgroundColor: recipe.enemyColor }}
                      title={`Enemy Inverted: ${recipe.enemyColor}`}
                    />
                  )}
                  {recipe.shufflePalette?.map((c, i) => (
                    <div
                      key={i}
                      className="w-3.5 h-3.5 border border-gray-600 rounded-none"
                      style={{ backgroundColor: c }}
                      title={`Palette ${i + 1}: ${c}`}
                    />
                  ))}
                </div>
              </div>
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
          Select how you want to apply this preset:
        </p>

        {/* Action Buttons */}
        <div className="space-y-3">
          {/* Option 1: Patch-Proof Recipe Re-Application */}
          <button
            type="button"
            onClick={() => onApplyRecipeFresh(recipe)}
            disabled={!detectedHeroId}
            className="w-full p-3.5 border text-left transition-colors hover:brightness-125 group flex flex-col gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--accent-main)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[var(--accent-main)]">
                1. Re-Apply Recipe onto Fresh Game Extraction (Patch-Proof)
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5" style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}>
                RECOMMENDED
              </span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
              Freshly extracts clean assets directly from current game containers for {detectedHeroName || `Hero ${detectedHeroId}`}, including any new game files added in recent patches, and calculates the color recipe cleanly across all existing and newly added parameters.
            </p>
          </button>

          {/* Option 2: Exact Match Old Saved Parameters Only */}
          <button
            type="button"
            onClick={onApplyExactMatch}
            className="w-full p-3.5 border text-left transition-colors hover:brightness-125 group flex flex-col gap-1.5"
            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold group-hover:text-[var(--accent-main)]" style={{ color: 'var(--text-1)' }}>
                2. Exact Match Old Saved Parameters Only
              </span>
              <span className="text-xs font-mono opacity-50">Direct Apply</span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-4)' }}>
              Applies only the exact saved parameter values onto currently loaded assets with matching filenames and parameter names. Leaves any other parameters unmodified.
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

