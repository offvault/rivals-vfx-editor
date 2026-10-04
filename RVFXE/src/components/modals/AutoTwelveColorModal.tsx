import { useState } from 'react';
import type { ColorParam, RGBA, UassetSourceMap, RvfxpPresetV2 } from '@/types';
import * as tauri from '@/services/tauri';
import { hexToRgba, applyColorToParam, isEnemyParameter } from '@/utils/color';
import { setNestedValue, getPakReadyRelativePath } from '@/utils/helpers';

export interface AutoTwelveColorModalProps {
  heroId: string;
  heroName: string;
  colorParams: ColorParam[];
  originalFiles: Record<string, any>;
  uassetSourceMap: UassetSourceMap;
  preserveIntensity: boolean;
  ignoreGrayscale: boolean;
  onClose: () => void;
  addDebugLog: (msg: string) => void;
}

interface ColorTheme {
  name: string;
  key: string;
  hex: string;
  enemyHex: string;
}

const DEFAULT_THEMES: ColorTheme[] = [
  { name: 'Crimson Red', key: 'Red', hex: '#FF1744', enemyHex: '#00E5FF' },
  { name: 'Blaze Orange', key: 'Orange', hex: '#FF6D00', enemyHex: '#2979FF' },
  { name: 'Solar Yellow', key: 'Yellow', hex: '#FFD600', enemyHex: '#651FFF' },
  { name: 'Acid Lime', key: 'Lime', hex: '#AEEA00', enemyHex: '#D500F9' },
  { name: 'Emerald Green', key: 'Green', hex: '#00E676', enemyHex: '#FF4081' },
  { name: 'Teal Mint', key: 'Teal', hex: '#1DE9B6', enemyHex: '#FF1744' },
  { name: 'Electric Cyan', key: 'Cyan', hex: '#00E5FF', enemyHex: '#FF6D00' },
  { name: 'Cobalt Blue', key: 'Blue', hex: '#2979FF', enemyHex: '#FF9100' },
  { name: 'Royal Purple', key: 'Purple', hex: '#7C4DFF', enemyHex: '#FFD600' },
  { name: 'Deep Magenta', key: 'Magenta', hex: '#D500F9', enemyHex: '#AEEA00' },
  { name: 'Neon Pink', key: 'Pink', hex: '#FF4081', enemyHex: '#00E676' },
  { name: 'Ghost Silver', key: 'Silver', hex: '#E0E0E0', enemyHex: '#FF3D00' },
];

export function AutoTwelveColorModal({
  heroId,
  heroName,
  colorParams,
  originalFiles,
  uassetSourceMap,
  preserveIntensity,
  ignoreGrayscale,
  onClose,
  addDebugLog,
}: AutoTwelveColorModalProps) {
  const [themes, setThemes] = useState<ColorTheme[]>(DEFAULT_THEMES);
  const [outputDir, setOutputDir] = useState<string>('');
  const [targetFormat, setTargetFormat] = useState<'iostore' | 'raw_uassets'>('iostore');
  const [compressOodle, setCompressOodle] = useState(true);
  const [createZip, setCreateZip] = useState(true);
  const [bundleAll12, setBundleAll12] = useState(true);
  const [exportRvfxp, setExportRvfxp] = useState(true);
  const [pakReady, setPakReady] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);

  const cleanHeroName = heroName.replace(/\s+/g, '_');

  const handleSelectOutput = async () => {
    try {
      const selected = await tauri.openDialog({
        directory: true,
        multiple: false,
        title: 'Select Destination Folder for 12 Mod Packs (e.g. Done/)',
      });
      if (selected) {
        setOutputDir(selected as string);
      }
    } catch (e) {
      console.error('Failed to select output folder:', e);
    }
  };

  const handleGenerateAll = async () => {
    if (!outputDir) {
      alert('Please select an output folder first.');
      return;
    }

    if (colorParams.length === 0) {
      alert('No parameters loaded to generate mods from.');
      return;
    }

    setIsGenerating(true);
    setProgressPercent(0);
    addDebugLog(`Starting 12-Color Pack generation for ${heroName} (${themes.length} variants)...`);

    try {
      const totalThemes = themes.length;
      const allContainerFiles: string[] = [];

      for (let t = 0; t < totalThemes; t++) {
        const theme = themes[t];
        const modFolderName = `${cleanHeroName}_${theme.key}VFX`;
        setCurrentStep(`[${t + 1}/${totalThemes}] Generating ${theme.name}...`);
        setProgressPercent(Math.round(((t) / totalThemes) * 100));

        // Prepare modified files
        const themeModifiedFiles: Record<string, any> = {};
        for (const keyPath of Object.keys(originalFiles)) {
          themeModifiedFiles[keyPath] = structuredClone(originalFiles[keyPath]);
        }

        const themeRgb = hexToRgba(theme.hex);
        const enemyRgb = hexToRgba(theme.enemyHex);
        const themeSessionData: { relativePath: string; paramName: string; rgba: RGBA }[] = [];

        // Apply recoloring per param
        for (const param of colorParams) {
          const isEnemy = isEnemyParameter(param);
          let newRgba: RGBA;

          if (isEnemy) {
            newRgba = applyColorToParam(param.rgba, enemyRgb, {
              preserveIntensity,
              ignoreGrayscale,
            });
          } else {
            newRgba = applyColorToParam(param.rgba, themeRgb, {
              preserveIntensity,
              ignoreGrayscale,
            });
          }

          themeSessionData.push({
            relativePath: param.relativePath.replace(/\.json$/i, ''),
            paramName: param.paramName,
            rgba: newRgba,
          });

          const targetFile = themeModifiedFiles[param.relativePath];
          if (targetFile) {
            setNestedValue(targetFile, param.path, newRgba);
          }
        }

        // Write modified JSONs to disk
        const jsonPathsForConversion: string[] = [];
        const filesToSave = Object.keys(themeModifiedFiles).filter(k => uassetSourceMap[k]?.jsonPath);

        for (const keyPath of filesToSave) {
          const sourceInfo = uassetSourceMap[keyPath];
          if (sourceInfo && sourceInfo.jsonPath) {
            const jsonContent = JSON.stringify(themeModifiedFiles[keyPath], null, 2);
            await tauri.writeTextFile(sourceInfo.jsonPath, jsonContent);

            // Universal dynamic pak-ready path resolution
            const outRelPath = pakReady
              ? getPakReadyRelativePath(keyPath, modFolderName)
              : `${modFolderName}/${keyPath.replace(/\.json$/i, '.uasset')}`;

            jsonPathsForConversion.push(`${sourceInfo.jsonPath},${outRelPath}`);
          }
        }

        // Optional Version 2 .rvfxp preset export
        if (exportRvfxp) {
          const rvfxpPreset: RvfxpPresetV2 = {
            version: 2,
            generator: 'RivalsVFXEditor',
            timestamp: new Date().toISOString(),
            recipe: {
              mode: '12color',
              masterColor: theme.hex,
              enemyColor: theme.enemyHex,
              shufflePalette: [theme.hex, theme.enemyHex],
              preserveIntensity,
              ignoreGrayscale,
              proceduralJitter: 0.35,
              brightnessMultiplier: 1.0,
              opacityValue: 1.0,
              hueShift: 0,
            },
            slots: [
              {
                slotId: `slot_${heroId}_${theme.key}`,
                heroId,
                heroName,
                customLabel: modFolderName,
                targetSubpaths: [`Characters/${heroId}`],
              },
            ],
            savedParameters: themeSessionData,
          };
          const modRootPath = `${outputDir}/${modFolderName}`;
          await tauri.writeTextFile(
            `${modRootPath}.rvfxp`,
            JSON.stringify(rvfxpPreset, null, 2)
          );
        }

        // Package into Game-Ready IoStore or Raw UAssets
        if (jsonPathsForConversion.length > 0) {
          const packageRes = await tauri.packageIostoreMod({
            mod_name: modFolderName,
            output_dir: outputDir,
            json_paths: jsonPathsForConversion,
            target_format: targetFormat,
            compress: compressOodle,
            create_zip: !bundleAll12 && createZip,
            bundle_name: bundleAll12 ? `${cleanHeroName}_12Colors_ModPack` : null,
          });

          if (packageRes.utocPath) allContainerFiles.push(packageRes.utocPath);
          if (packageRes.ucasPath) allContainerFiles.push(packageRes.ucasPath);
          if (packageRes.pakPath) allContainerFiles.push(packageRes.pakPath);
        }

        addDebugLog(`✓ Generated ${theme.name} -> ${modFolderName}`);
      }

      // If bundleAll12 is requested, create the single unified bundle .zip
      if (targetFormat === 'iostore' && createZip && bundleAll12 && allContainerFiles.length > 0) {
        setCurrentStep('Creating unified 12-Color Pack bundle zip archive...');
        const bundleArchiveName = `${cleanHeroName}_12Colors_ModPack`;
        await tauri.createBundleZip(bundleArchiveName, outputDir, allContainerFiles);
        addDebugLog(`✓ Created unified bundle: ${bundleArchiveName}.zip (${allContainerFiles.length} container files)`);
      }

      setProgressPercent(100);
      setCurrentStep('Complete! All 12 color variants generated.');
      addDebugLog(`Finished 12-Color Pack generation for ${heroName}.`);
      await tauri.openFolder(outputDir);
      alert(`Success! All 12 mod variants packaged into:\n${outputDir}`);
      onClose();
    } catch (err) {
      console.error('Failed generating 12-color pack:', err);
      addDebugLog(`Error generating 12-color pack: ${err}`);
      alert(`Error during generation: ${err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col border-2 overflow-hidden shadow-2xl"
        style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--accent-main)' }}
      >
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--bg-1)' }}>
          <div>
            <h2 className="text-xl font-bold tracking-wider" style={{ color: 'var(--accent-main)' }}>
              ⚡ Auto 12-Color Pack Generator
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Target Hero: <span className="font-bold text-white">{heroName}</span> ({heroId}) • {colorParams.length} parameters
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="text-gray-400 hover:text-white text-xl px-2 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* Destination Folder Selector */}
          <div className="p-3 border" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-2)' }}>
              Destination Folder (Output Root)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={outputDir || 'Click Browse to select where mod folders will be created...'}
                className="flex-1 px-2 py-1 text-xs font-mono border"
                style={{ backgroundColor: 'var(--bg-4)', color: outputDir ? 'var(--text-1)' : 'var(--text-4)', borderColor: 'var(--bg-1)' }}
              />
              <button
                type="button"
                onClick={handleSelectOutput}
                disabled={isGenerating}
                className="px-4 py-1 text-xs font-bold border"
                style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
              >
                Browse...
              </button>
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-4)' }}>
              Creates game-ready mod packages or asset hierarchies for all 12 color variants with enemy color inversion.
            </p>
          </div>

          {/* Packaging Target & Options */}
          <div className="space-y-2 p-3 border text-xs" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
            <div className="flex items-center justify-between font-bold text-xs" style={{ color: 'var(--accent-main)' }}>
              <span>PACKAGING TARGET & OUTPUT FORMAT</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <label className="flex items-center gap-2 p-2 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: targetFormat === 'iostore' ? 'var(--accent-main)' : 'var(--bg-1)' }}>
                <input
                  type="radio"
                  name="twelveColorTarget"
                  checked={targetFormat === 'iostore'}
                  onChange={() => setTargetFormat('iostore')}
                  className="w-4 h-4 text-[var(--accent-main)]"
                />
                <div className="leading-tight">
                  <span className="font-semibold text-white block">Game-Ready IoStore (.utoc / .ucas / .pak)</span>
                  <span className="text-[10px] text-gray-400">Directly loadable in game via mod managers</span>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: targetFormat === 'raw_uassets' ? 'var(--accent-main)' : 'var(--bg-1)' }}>
                <input
                  type="radio"
                  name="twelveColorTarget"
                  checked={targetFormat === 'raw_uassets'}
                  onChange={() => setTargetFormat('raw_uassets')}
                  className="w-4 h-4 text-[var(--accent-main)]"
                />
                <div className="leading-tight">
                  <span className="font-semibold text-white block">Raw Loose UAssets Only</span>
                  <span className="text-[10px] text-gray-400">Marvel/Content/... folder hierarchy</span>
                </div>
              </label>
            </div>

            {targetFormat === 'iostore' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <label className="flex items-center gap-2 p-1.5 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
                  <input
                    type="checkbox"
                    checked={compressOodle}
                    onChange={e => setCompressOodle(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span>Compress (Oodle Kraken)</span>
                </label>

                <label className="flex items-center gap-2 p-1.5 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
                  <input
                    type="checkbox"
                    checked={createZip}
                    onChange={e => setCreateZip(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span>Create .zip Archive</span>
                </label>

                <label className="flex items-center gap-2 p-1.5 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
                  <input
                    type="checkbox"
                    checked={bundleAll12}
                    disabled={!createZip}
                    onChange={e => setBundleAll12(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span>Bundle All 12 in 1 .zip</span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <label className="flex items-center gap-2 p-1.5 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
                <input
                  type="checkbox"
                  checked={pakReady}
                  onChange={e => setPakReady(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>Universal Pak-Ready Structure (Marvel/Content/...)</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 border cursor-pointer" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
                <input
                  type="checkbox"
                  checked={exportRvfxp}
                  onChange={e => setExportRvfxp(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span>Export Recipe V2 (.rvfxp) Presets</span>
              </label>
            </div>
          </div>

          {/* 12 Color Palette Grid */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
              12 Colorways (Hero Primary VFX + Inverted Enemy VFX)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {themes.map((theme, idx) => (
                <div
                  key={idx}
                  className="p-2 border flex items-center justify-between gap-2"
                  style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <input
                      type="color"
                      value={theme.hex}
                      onChange={e => {
                        const newHex = e.target.value;
                        const newThemes = [...themes];
                        newThemes[idx].hex = newHex;
                        setThemes(newThemes);
                      }}
                      className="w-6 h-6 p-0 border-0 rounded-none cursor-pointer flex-shrink-0"
                    />
                    <div className="truncate">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--text-1)' }}>
                        {theme.name}
                      </div>
                      <div className="text-[10px] font-mono" style={{ color: 'var(--text-4)' }}>
                        {cleanHeroName}_{theme.key}VFX
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0" title="Inverted Enemy VFX Color">
                    <span className="text-[10px] opacity-60" style={{ color: 'var(--text-4)' }}>Enemy:</span>
                    <input
                      type="color"
                      value={theme.enemyHex}
                      onChange={e => {
                        const newHex = e.target.value;
                        const newThemes = [...themes];
                        newThemes[idx].enemyHex = newHex;
                        setThemes(newThemes);
                      }}
                      className="w-5 h-5 p-0 border-0 rounded-none cursor-pointer"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Generation Progress Indicator */}
          {isGenerating && (
            <div className="p-3 border space-y-2" style={{ backgroundColor: 'var(--bg-4)', borderColor: 'var(--accent-main)' }}>
              <div className="flex justify-between text-xs font-mono">
                <span style={{ color: 'var(--accent-main)' }}>{currentStep}</span>
                <span style={{ color: 'var(--text-2)' }}>{progressPercent}%</span>
              </div>
              <div className="w-full h-2 bg-gray-800 overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{ width: `${progressPercent}%`, backgroundColor: 'var(--accent-main)' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-between items-center" style={{ borderColor: 'var(--bg-1)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 text-xs font-medium border"
            style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-3)', borderColor: 'var(--bg-1)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerateAll}
            disabled={isGenerating || !outputDir}
            className="px-6 py-2 text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
          >
            {isGenerating ? 'Generating 12 Mod Packs...' : '⚡ Generate All 12 Mod Packs'}
          </button>
        </div>
      </div>
    </div>
  );
}
