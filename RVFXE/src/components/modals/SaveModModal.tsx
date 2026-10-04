import { useState } from 'react';

export interface SaveModModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: {
    targetFormat: 'iostore' | 'raw_uassets';
    compressOodle: boolean;
    createZip: boolean;
    pakReady: boolean;
    bundleName?: string;
  }) => void;
  isBatch: boolean;
  slotCount: number;
  initialModName: string;
  initialBundleName?: string;
}

export function SaveModModal({
  isOpen,
  onClose,
  onConfirm,
  isBatch,
  slotCount,
  initialModName,
  initialBundleName = '',
}: SaveModModalProps) {
  const [targetFormat, setTargetFormat] = useState<'iostore' | 'raw_uassets'>('iostore');
  const [compressOodle, setCompressOodle] = useState(true);
  const [createZip, setCreateZip] = useState(true);
  const [pakReady, setPakReady] = useState(true);
  const [bundleName, setBundleName] = useState(initialBundleName);
  const [enableBundle, setEnableBundle] = useState(isBatch && !!initialBundleName);

  if (!isOpen) return null;

  const handleStart = () => {
    onConfirm({
      targetFormat,
      compressOodle,
      createZip,
      pakReady,
      bundleName: enableBundle && bundleName.trim() ? bundleName.trim() : undefined,
    });
    onClose();
  };

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
              {isBatch ? `Batch Mod Export (${slotCount} Slots)` : `Export Mod: ${initialModName}`}
            </h3>
            <p className="text-xs font-mono mt-0.5 text-gray-300">
              Configure mod packaging format, compression, and distribution archive
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">
            ✕
          </button>
        </div>

        {/* Target Format Options */}
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider block text-[var(--accent-main)]">
            Target Packaging Format
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label
              className="flex items-start gap-2.5 p-3 border cursor-pointer transition-colors"
              style={{
                backgroundColor: targetFormat === 'iostore' ? 'var(--bg-1)' : 'var(--bg-2)',
                borderColor: targetFormat === 'iostore' ? 'var(--accent-main)' : 'var(--bg-1)',
              }}
            >
              <input
                type="radio"
                name="targetFormat"
                checked={targetFormat === 'iostore'}
                onChange={() => setTargetFormat('iostore')}
                className="mt-0.5"
              />
              <div>
                <span className="text-xs font-bold text-white block">Game-Ready IoStore Mod</span>
                <span className="text-[11px] text-gray-400 leading-tight block mt-0.5">
                  Outputs game container files (.utoc + .ucas + .pak companion) ready for immediate loading.
                </span>
              </div>
            </label>

            <label
              className="flex items-start gap-2.5 p-3 border cursor-pointer transition-colors"
              style={{
                backgroundColor: targetFormat === 'raw_uassets' ? 'var(--bg-1)' : 'var(--bg-2)',
                borderColor: targetFormat === 'raw_uassets' ? 'var(--accent-main)' : 'var(--bg-1)',
              }}
            >
              <input
                type="radio"
                name="targetFormat"
                checked={targetFormat === 'raw_uassets'}
                onChange={() => setTargetFormat('raw_uassets')}
                className="mt-0.5"
              />
              <div>
                <span className="text-xs font-bold text-white block">Raw Loose UAssets Only</span>
                <span className="text-[11px] text-gray-400 leading-tight block mt-0.5">
                  Saves loose .uasset & .uexp files in vanilla folder hierarchy.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Packaging Features */}
        <div className="space-y-2 p-3 border text-xs" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
          <span className="text-[11px] font-bold uppercase tracking-wider block text-gray-300">
            Packaging & Compression Options
          </span>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={pakReady}
              onChange={e => setPakReady(e.target.checked)}
              className="w-4 h-4"
            />
            <span>Universal Pak-Ready Directory Hierarchy (<code>Marvel/Content/...</code>)</span>
          </label>

          {targetFormat === 'iostore' && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={compressOodle}
                  onChange={e => setCompressOodle(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Compress with Oodle (Kraken) - recommended for small file size</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createZip}
                  onChange={e => setCreateZip(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Create Ready-to-Share <code>.zip</code> Archive</span>
              </label>
            </>
          )}

          {/* Multi-mod bundle grouping */}
          {isBatch && slotCount > 1 && (
            <div className="pt-2 border-t mt-2 border-gray-700/60 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableBundle}
                  onChange={e => setEnableBundle(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="font-semibold text-white">Bundle all queued mods into a single unified .zip</span>
              </label>

              {enableBundle && (
                <div className="flex items-center gap-2 pl-6">
                  <span className="text-gray-400 text-[11px] whitespace-nowrap">Bundle Archive Name:</span>
                  <input
                    type="text"
                    value={bundleName}
                    onChange={e => setBundleName(e.target.value)}
                    placeholder="e.g. FantasticDuo_PinkVFX"
                    className="flex-1 bg-transparent border-b border-gray-600 focus:border-[var(--accent-main)] outline-none text-xs px-2 py-0.5 text-white"
                  />
                  <span className="text-gray-400 text-xs font-mono">.zip</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium border"
            style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-3)', borderColor: 'var(--bg-1)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="px-6 py-2 text-xs font-bold border"
            style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)', borderColor: 'var(--accent-main)' }}
          >
            {isBatch ? `Package All ${slotCount} Mods` : 'Package Mod'}
          </button>
        </div>
      </div>
    </div>
  );
}
