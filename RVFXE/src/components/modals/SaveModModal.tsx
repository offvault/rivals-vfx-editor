import { useState, useEffect, useMemo } from 'react';
import type { ExportMatrixOptions, ExportSlotConfig } from '@/types';

export interface SaveModModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: ExportMatrixOptions) => void;
  isBatch: boolean;
  slots: Array<{
    slotId: string;
    heroId: string;
    heroName: string;
    customLabel: string;
    bundleGroup?: string;
  }>;
  initialModName: string;
}

export function SaveModModal({
  isOpen,
  onClose,
  onConfirm,
  isBatch,
  slots,
  initialModName,
}: SaveModModalProps) {
  // Format selections
  const [exportIoStore, setExportIoStore] = useState(true);
  const [exportZip, setExportZip] = useState(true);
  const [exportRawUassets, setExportRawUassets] = useState(false);
  const [exportJson, setExportJson] = useState(false);
  const [compressOodle, setCompressOodle] = useState(true);
  const [pakReady, setPakReady] = useState(true);
  const [exportRvfxpPreset, setExportRvfxpPreset] = useState(true);

  // Per-slot configuration matrix
  const [slotConfigs, setSlotConfigs] = useState<ExportSlotConfig[]>([]);

  // Initialize or re-sync slotConfigs when modal opens or slots change
  useEffect(() => {
    if (!isOpen) return;

    if (isBatch && slots.length > 0) {
      setSlotConfigs(
        slots.map(s => ({
          slotId: s.slotId,
          heroId: s.heroId,
          heroName: s.heroName,
          customLabel: s.customLabel || s.heroName,
          exportMode: s.bundleGroup ? 'bundle' : 'solo',
          bundleGroup: s.bundleGroup || '',
        }))
      );
    } else {
      setSlotConfigs([
        {
          slotId: 'single_active',
          heroId: 'active',
          heroName: 'Active Hero',
          customLabel: initialModName || 'MyHero_VFX',
          exportMode: 'solo',
          bundleGroup: '',
        },
      ]);
    }
  }, [isOpen, isBatch, slots, initialModName]);

  // Derived bundle statistics
  const { bundleMap, soloCount, distinctBundleNames } = useMemo(() => {
    const map: Record<string, string[]> = {};
    let solos = 0;

    for (const sc of slotConfigs) {
      if (sc.exportMode === 'bundle' && sc.bundleGroup.trim()) {
        const bg = sc.bundleGroup.trim();
        if (!map[bg]) map[bg] = [];
        map[bg].push(sc.customLabel);
      } else {
        solos++;
      }
    }

    return {
      bundleMap: map,
      soloCount: solos,
      distinctBundleNames: Object.keys(map),
    };
  }, [slotConfigs]);

  if (!isOpen) return null;

  const handleUpdateSlotLabel = (slotId: string, label: string) => {
    setSlotConfigs(prev =>
      prev.map(s => (s.slotId === slotId ? { ...s, customLabel: label } : s))
    );
  };

  const handleUpdateSlotMode = (slotId: string, mode: 'solo' | 'bundle') => {
    setSlotConfigs(prev =>
      prev.map(s => {
        if (s.slotId !== slotId) return s;
        // Default bundle group if switching to bundle mode
        const defaultBundle = s.bundleGroup || distinctBundleNames[0] || 'VFX_Bundle';
        return {
          ...s,
          exportMode: mode,
          bundleGroup: mode === 'bundle' ? defaultBundle : '',
        };
      })
    );
  };

  const handleUpdateSlotBundle = (slotId: string, bundleName: string) => {
    setSlotConfigs(prev =>
      prev.map(s => (s.slotId === slotId ? { ...s, bundleGroup: bundleName } : s))
    );
  };

  // Quick Action: Set all slots to Solo
  const handleSetAllSolo = () => {
    setSlotConfigs(prev =>
      prev.map(s => ({ ...s, exportMode: 'solo', bundleGroup: '' }))
    );
  };

  // Quick Action: Bundle all slots into one group
  const handleBundleAllTogether = () => {
    const defaultName = distinctBundleNames[0] || 'AllHeroes_VFX_Bundle';
    const group = window.prompt('Enter Bundle Group Name for all slots:', defaultName);
    if (!group) return;
    const cleanGroup = group.trim().replace(/\s+/g, '_');
    setSlotConfigs(prev =>
      prev.map(s => ({
        ...s,
        exportMode: 'bundle',
        bundleGroup: cleanGroup,
      }))
    );
  };

  const handleStartExport = () => {
    if (!exportIoStore && !exportRawUassets && !exportJson && !exportRvfxpPreset) {
      alert('Please select at least one output format to export.');
      return;
    }

    onConfirm({
      exportIoStore,
      exportZip,
      exportRawUassets,
      exportJson,
      compressOodle,
      pakReady,
      slots: slotConfigs,
      exportRvfxpPreset,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 select-none">
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col border-2 shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--accent-main)' }}
      >
        {/* Header */}
        <div
          className="flex justify-between items-center p-4 border-b"
          style={{ borderColor: 'var(--bg-1)', backgroundColor: 'var(--bg-2)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-none flex items-center justify-center font-bold text-sm"
              style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
            >
              🚀
            </div>
            <div>
              <h3 className="text-base font-bold tracking-wider uppercase" style={{ color: 'var(--text-1)' }}>
                {isBatch
                  ? `Selective Export Matrix (${slotConfigs.length} Slots Loaded)`
                  : `Export Mod: ${slotConfigs[0]?.customLabel || initialModName}`}
              </h3>
              <p className="text-xs font-mono" style={{ color: 'var(--text-4)' }}>
                Select target formats, configure per-slot solo vs bundle groupings, and package mods
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Section 1: Output Formats */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider block text-[var(--accent-main)]">
              1. Target Output Formats
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {/* IoStore Mod */}
              <label
                className="flex items-start gap-2.5 p-3 border cursor-pointer transition-colors"
                style={{
                  backgroundColor: exportIoStore ? 'var(--bg-1)' : 'var(--bg-2)',
                  borderColor: exportIoStore ? 'var(--accent-main)' : 'var(--bg-1)',
                }}
              >
                <input
                  type="checkbox"
                  checked={exportIoStore}
                  onChange={e => setExportIoStore(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <div>
                  <span className="text-xs font-bold text-white block">IoStore Game Containers</span>
                  <span className="text-[10px] text-gray-400 block mt-0.5 leading-tight">
                    <code>.utoc</code> + <code>.ucas</code> + <code>.pak</code> game-ready files
                  </span>
                </div>
              </label>

              {/* Zip Archives */}
              <label
                className="flex items-start gap-2.5 p-3 border cursor-pointer transition-colors"
                style={{
                  backgroundColor: exportZip ? 'var(--bg-1)' : 'var(--bg-2)',
                  borderColor: exportZip ? 'var(--accent-main)' : 'var(--bg-1)',
                }}
              >
                <input
                  type="checkbox"
                  checked={exportZip}
                  onChange={e => setExportZip(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <div>
                  <span className="text-xs font-bold text-white block">Packaged .zip Archives</span>
                  <span className="text-[10px] text-gray-400 block mt-0.5 leading-tight">
                    Distribution archives for solo mods and multi-mod bundles
                  </span>
                </div>
              </label>

              {/* Raw Loose UAssets */}
              <label
                className="flex items-start gap-2.5 p-3 border cursor-pointer transition-colors"
                style={{
                  backgroundColor: exportRawUassets ? 'var(--bg-1)' : 'var(--bg-2)',
                  borderColor: exportRawUassets ? 'var(--accent-main)' : 'var(--bg-1)',
                }}
              >
                <input
                  type="checkbox"
                  checked={exportRawUassets}
                  onChange={e => setExportRawUassets(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <div>
                  <span className="text-xs font-bold text-white block">Raw Loose UAssets</span>
                  <span className="text-[10px] text-gray-400 block mt-0.5 leading-tight">
                    Loose <code>.uasset</code> & <code>.uexp</code> files in folder tree
                  </span>
                </div>
              </label>

              {/* JSON Dumps */}
              <label
                className="flex items-start gap-2.5 p-3 border cursor-pointer transition-colors"
                style={{
                  backgroundColor: exportJson ? 'var(--bg-1)' : 'var(--bg-2)',
                  borderColor: exportJson ? 'var(--accent-main)' : 'var(--bg-1)',
                }}
              >
                <input
                  type="checkbox"
                  checked={exportJson}
                  onChange={e => setExportJson(e.target.checked)}
                  className="mt-0.5 w-4 h-4"
                />
                <div>
                  <span className="text-xs font-bold text-white block">Clean JSON Dumps</span>
                  <span className="text-[10px] text-gray-400 block mt-0.5 leading-tight">
                    Clean JSON parameter dumps for modder inspection
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 2: Packaging & Hierarchy Settings */}
          <div
            className="p-3 border space-y-2 text-xs"
            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider block text-gray-300">
              2. Packaging & Hierarchy Options
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pakReady}
                  onChange={e => setPakReady(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Universal Pak-Ready Structure (<code>Marvel/Content/...</code>)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={compressOodle}
                  onChange={e => setCompressOodle(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Oodle (Kraken) Compression</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportRvfxpPreset}
                  onChange={e => setExportRvfxpPreset(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>Export Recipe <code>.rvfxp</code> Preset(s)</span>
              </label>
            </div>
          </div>

          {/* Section 3: Batch Export Matrix Table */}
          {isBatch && slotConfigs.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent-main)]">
                  3. Batch Matrix: Solo Mods & Bundle Groups
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSetAllSolo}
                    className="px-2.5 py-1 text-xs font-medium border transition-colors hover:bg-white/10"
                    style={{ backgroundColor: 'var(--bg-1)', borderColor: 'var(--bg-1)', color: 'var(--text-2)' }}
                  >
                    Set All Solo
                  </button>
                  <button
                    type="button"
                    onClick={handleBundleAllTogether}
                    className="px-2.5 py-1 text-xs font-medium border transition-colors hover:bg-white/10"
                    style={{ backgroundColor: 'var(--bg-1)', borderColor: 'var(--bg-1)', color: 'var(--text-2)' }}
                  >
                    Bundle All Together...
                  </button>
                </div>
              </div>

              {/* Table */}
              <div
                className="border overflow-hidden max-h-72 overflow-y-auto"
                style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}
              >
                <table className="w-full text-xs text-left">
                  <thead className="border-b" style={{ backgroundColor: 'var(--bg-1)', borderColor: 'var(--bg-2)' }}>
                    <tr>
                      <th className="py-2 px-3 font-semibold text-gray-300"># / Hero</th>
                      <th className="py-2 px-3 font-semibold text-gray-300">Mod Pack Name</th>
                      <th className="py-2 px-3 font-semibold text-gray-300">Mode</th>
                      <th className="py-2 px-3 font-semibold text-gray-300">Bundle Group Archive</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {slotConfigs.map((slot, idx) => (
                      <tr key={slot.slotId} className="hover:bg-white/5 transition-colors">
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="font-mono text-gray-500 mr-2 text-[10px]">#{idx + 1}</span>
                          <span className="font-semibold text-white">{slot.heroName}</span>
                          <span className="font-mono text-gray-500 ml-1 text-[10px]">({slot.heroId})</span>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={slot.customLabel}
                            onChange={e => handleUpdateSlotLabel(slot.slotId, e.target.value)}
                            placeholder="e.g. IronFist_Red_VFX"
                            className="w-full bg-black/40 border border-gray-700 focus:border-[var(--accent-main)] px-2 py-1 text-xs text-white outline-none font-mono"
                          />
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <div className="inline-flex border border-gray-700 rounded-none overflow-hidden text-[11px]">
                            <button
                              type="button"
                              onClick={() => handleUpdateSlotMode(slot.slotId, 'solo')}
                              className="px-2.5 py-1 font-semibold transition-colors"
                              style={{
                                backgroundColor: slot.exportMode === 'solo' ? 'var(--accent-main)' : 'var(--bg-1)',
                                color: slot.exportMode === 'solo' ? 'var(--bg-4)' : 'var(--text-4)',
                              }}
                            >
                              Solo
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateSlotMode(slot.slotId, 'bundle')}
                              className="px-2.5 py-1 font-semibold transition-colors"
                              style={{
                                backgroundColor: slot.exportMode === 'bundle' ? 'var(--accent-main)' : 'var(--bg-1)',
                                color: slot.exportMode === 'bundle' ? 'var(--bg-4)' : 'var(--text-4)',
                              }}
                            >
                              Bundle
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          {slot.exportMode === 'bundle' ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                list="bundle-suggestions"
                                value={slot.bundleGroup}
                                onChange={e => handleUpdateSlotBundle(slot.slotId, e.target.value)}
                                placeholder="e.g. FantasticDuo_VFX"
                                className="w-full bg-black/40 border border-amber-500/50 focus:border-amber-400 px-2 py-1 text-xs text-amber-200 outline-none font-mono"
                              />
                              <span className="text-gray-500 font-mono text-[10px]">.zip</span>
                            </div>
                          ) : (
                            <span className="text-gray-500 italic text-[11px]">Solo standalone mod</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id="bundle-suggestions">
                  {distinctBundleNames.map(name => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>
          ) : (
            /* Single Mod Export Form */
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent-main)] block">
                3. Mod Package Identity
              </span>
              <div className="p-3 border flex items-center gap-3" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
                <span className="text-xs font-semibold text-gray-300 whitespace-nowrap">Mod Package Name:</span>
                <input
                  type="text"
                  value={slotConfigs[0]?.customLabel || ''}
                  onChange={e => handleUpdateSlotLabel(slotConfigs[0]?.slotId || 'single_active', e.target.value)}
                  placeholder="e.g. IronFist_Red_VFX"
                  className="flex-1 bg-black/40 border border-gray-700 focus:border-[var(--accent-main)] px-3 py-1.5 text-xs text-white outline-none font-mono"
                />
              </div>
            </div>
          )}

          {/* Section 4: Live Summary Card */}
          <div
            className="p-3 border text-xs space-y-1.5"
            style={{ backgroundColor: 'var(--bg-1)', borderColor: 'var(--bg-2)' }}
          >
            <div className="flex items-center gap-2">
              <span className="font-bold text-white uppercase text-[11px] tracking-wide">📦 Packaging Output Plan:</span>
            </div>
            <div className="text-gray-300 space-y-1 pl-1">
              {isBatch ? (
                <>
                  <p>
                    • Total Mods: <strong className="text-white">{slotConfigs.length}</strong> ({soloCount} Solo Mods,{' '}
                    {distinctBundleNames.length} Bundle Archives)
                  </p>
                  {distinctBundleNames.length > 0 && (
                    <div className="pl-4 space-y-0.5 text-amber-300/90 font-mono text-[11px]">
                      {distinctBundleNames.map(bg => (
                        <p key={bg}>
                          📁 <strong>{bg}.zip</strong>: contains {bundleMap[bg].length} mods ({bundleMap[bg].join(', ')})
                        </p>
                      ))}
                    </div>
                  )}
                  {soloCount > 0 && (
                    <p className="pl-4 text-gray-400 font-mono text-[11px]">
                      📄 {soloCount} Solo Mod(s) exported individually into their own folders
                    </p>
                  )}
                </>
              ) : (
                <p>
                  • Packaging <strong>{slotConfigs[0]?.customLabel}</strong> into game container files{' '}
                  <code className="text-amber-300 font-mono text-[11px]">
                    {slotConfigs[0]?.customLabel}_9999999_P.utoc / .ucas / .pak
                  </code>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex justify-between items-center p-4 border-t"
          style={{ borderColor: 'var(--bg-1)', backgroundColor: 'var(--bg-2)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold border transition-colors hover:bg-white/10"
            style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-3)', borderColor: 'var(--bg-1)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStartExport}
            className="px-6 py-2 text-xs font-bold border transition-transform duration-150 active:scale-95 shadow-lg"
            style={{
              backgroundColor: 'var(--accent-main)',
              color: 'var(--bg-4)',
              borderColor: 'var(--accent-main)',
            }}
          >
            {isBatch ? `Package All ${slotConfigs.length} Mods` : 'Package Mod'}
          </button>
        </div>
      </div>
    </div>
  );
}
