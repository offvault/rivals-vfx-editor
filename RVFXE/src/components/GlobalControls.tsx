import type { ColorParam, RGBA, RGBNormalized } from '@/types';
import { ToggleSwitch } from '@/components/ui';

interface GlobalControlsProps {
  masterColor: string;
  setMasterColor: (c: string) => void;
  hueShiftValue: number;
  setHueShiftValue: (v: number) => void;
  useFiveColors: boolean;
  shuffleColors: string[];
  onShuffleColorChange: (index: number, color: string) => void;
  onAddShuffleColor: () => void;
  onRemoveShuffleColor: (index: number) => void;
  onSetShufflePaletteCount: (count: number) => void;
  isProceduralShuffle: boolean;
  setIsProceduralShuffle: (val: boolean) => void;
  proceduralJitter: number;
  setProceduralJitter: (val: number) => void;
  preserveIntensity: boolean;
  setPreserveIntensity: (v: boolean) => void;
  ignoreGrayscale: boolean;
  setIgnoreGrayscale: (v: boolean) => void;
  brightnessMultiplier: number;
  setBrightnessMultiplier: (v: number) => void;
  opacityValue: number;
  setOpacityValue: (v: number) => void;
  selectedCount: number;
  onApplyMasterColor: () => void;
  onApplyHueShift: () => void;
  onApplyShuffle: () => void;
  onApplyBrightnessMultiplier: () => void;
  onApplyOpacity: () => void;
  // Batch Mode props
  isBatchMode?: boolean;
  batchCount?: number;
  applyToAllBatch?: boolean;
  setApplyToAllBatch?: (val: boolean) => void;
  onOpenTwelveColorModal?: () => void;
}

export function GlobalControls({
  masterColor, setMasterColor,
  hueShiftValue, setHueShiftValue,
  shuffleColors, onShuffleColorChange,
  onAddShuffleColor, onRemoveShuffleColor, onSetShufflePaletteCount,
  isProceduralShuffle, setIsProceduralShuffle,
  proceduralJitter, setProceduralJitter,
  preserveIntensity, setPreserveIntensity,
  ignoreGrayscale, setIgnoreGrayscale,
  brightnessMultiplier, setBrightnessMultiplier,
  opacityValue, setOpacityValue,
  selectedCount,
  onApplyMasterColor, onApplyHueShift, onApplyShuffle, onApplyBrightnessMultiplier, onApplyOpacity,
  isBatchMode, batchCount = 0, applyToAllBatch = false, setApplyToAllBatch,
  onOpenTwelveColorModal,
}: GlobalControlsProps) {
  const isDisabled = selectedCount === 0;

  return (
    <div className="flex flex-col space-y-6 global-controls">
      {/* Batch Mode Indicator & Sync Switch */}
      {isBatchMode && batchCount > 1 && (
        <div className="p-3 border-2 mb-1" style={{ borderColor: 'var(--accent-main)', backgroundColor: 'var(--bg-2)' }}>
          <div className="flex justify-between items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent-main)' }}>
                Batch Mode ({batchCount} Heroes)
              </span>
              <p className="text-xs" style={{ color: 'var(--text-4)' }}>Sync edits across all queued hero slots</p>
            </div>
            {setApplyToAllBatch && (
              <ToggleSwitch label="Sync All" enabled={applyToAllBatch} setEnabled={setApplyToAllBatch} />
            )}
          </div>
        </div>
      )}

      {/* Single Color */}
      <div className="space-y-2">
        <h3 className="text-lg font-medium" style={{ color: 'var(--text-2)' }}>Single Color</h3>
        <div className="flex items-center space-x-4">
          <div className="flex flex-col items-center gap-2">
            <input
              type="color"
              value={masterColor}
              onChange={(e) => setMasterColor(e.target.value)}
              className="w-12 h-12 p-0 border-0 rounded-none cursor-pointer" style={{ backgroundColor: 'transparent' }}
            />
            <div className="flex items-center w-16 border-2 rounded-none focus-within:ring-1 focus-within:ring-[var(--accent-main)]" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-2)' }}>
              <span className="text-xs font-mono pl-1.5 opacity-50 select-none" style={{ color: 'var(--text-2)' }}>#</span>
              <input
                type="text"
                value={masterColor.replace(/^#/, '').toUpperCase()}
                onChange={(e) => setMasterColor('#' + e.target.value.replace(/#/g, '').slice(0, 6))}
                className="w-full px-1 py-0.5 text-xs text-left font-mono focus:outline-none bg-transparent border-none"
                style={{ color: 'var(--text-2)' }}
                maxLength={7}
              />
            </div>
          </div>
          <button onClick={onApplyMasterColor} className="flex-grow px-4 py-3 font-medium rounded-none transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }} disabled={isDisabled}>
            Apply Single
          </button>
        </div>
      </div>

      {/* Hue Shift */}
      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--bg-2)' }}>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium" style={{ color: 'var(--text-2)' }}>Hue Shift</h3>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="-180"
              max="180"
              step="1"
              value={hueShiftValue}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setHueShiftValue(Number.isNaN(val) ? 0 : Math.max(-180, Math.min(180, val)));
              }}
              className="w-16 px-1 py-0.5 text-center font-mono text-sm focus:outline-none border-2 rounded-none"
              style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-2)', borderColor: 'var(--bg-2)' }}
            />
            <span className="text-xs opacity-50" style={{ color: 'var(--text-2)' }}>°</span>
          </div>
        </div>
        <div>
          <input type="range" min="-180" max="180" value={hueShiftValue} onChange={(e) => setHueShiftValue(parseInt(e.target.value))} onDoubleClick={() => setHueShiftValue(0)} className="w-full h-2 rounded-none appearance-none cursor-pointer" />
        </div>
        <button onClick={onApplyHueShift} className="w-full px-4 py-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }} disabled={isDisabled}>
          Apply Hue Shift
        </button>
      </div>

      {/* Color Shuffle */}
      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--bg-2)' }}>
        <div className="flex justify-between items-center mb-1">
          <h3 className="text-lg font-medium" style={{ color: 'var(--text-2)' }}>
            Color Shuffle <span className="text-xs opacity-60 font-mono">({shuffleColors.length})</span>
          </h3>
          <div className="flex items-center gap-1">
            <span className="text-xs opacity-50 mr-1" style={{ color: 'var(--text-3)' }}>Presets:</span>
            {[3, 5, 8, 10].map(cnt => (
              <button
                key={cnt}
                type="button"
                onClick={() => onSetShufflePaletteCount(cnt)}
                className={`px-1.5 py-0.5 text-xs font-mono border ${shuffleColors.length === cnt ? 'font-bold' : 'opacity-70'}`}
                style={{
                  backgroundColor: shuffleColors.length === cnt ? 'var(--accent-main)' : 'var(--bg-2)',
                  color: shuffleColors.length === cnt ? 'var(--bg-4)' : 'var(--text-2)',
                  borderColor: 'var(--bg-1)',
                }}
              >
                {cnt}
              </button>
            ))}
            <button
              type="button"
              onClick={onAddShuffleColor}
              title="Add color swatch"
              className="ml-1 px-2 py-0.5 text-xs font-bold border transition-colors hover:brightness-125"
              style={{ backgroundColor: 'var(--bg-1)', color: 'var(--accent-main)', borderColor: 'var(--accent-main)' }}
            >
              +
            </button>
          </div>
        </div>

        {/* Dynamic Swatch Grid */}
        <div className="max-h-48 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2 py-1">
            {shuffleColors.map((color, index) => (
              <div key={index} className="relative group flex flex-col items-center gap-1 p-1 border" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
                {shuffleColors.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onRemoveShuffleColor(index)}
                    title="Remove color"
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10 font-bold"
                    style={{ backgroundColor: 'red', color: 'white' }}
                  >
                    ×
                  </button>
                )}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => onShuffleColorChange(index, e.target.value)}
                  className="w-10 h-8 p-0 border-0 rounded-none cursor-pointer"
                  style={{ backgroundColor: 'transparent' }}
                />
                <div className="flex items-center w-full border rounded-none focus-within:ring-1 focus-within:ring-[var(--accent-main)]" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
                  <span className="text-[10px] font-mono pl-1 opacity-50 select-none" style={{ color: 'var(--text-2)' }}>#</span>
                  <input
                    type="text"
                    value={color.replace(/^#/, '').toUpperCase()}
                    onChange={(e) => onShuffleColorChange(index, '#' + e.target.value.replace(/#/g, '').slice(0, 6))}
                    className="w-full px-0.5 py-0.5 text-[10px] text-left font-mono focus:outline-none bg-transparent border-none"
                    style={{ color: 'var(--text-2)' }}
                    maxLength={7}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Procedural Variations / Max Randomness Mode */}
        <div className="p-2 border mt-2" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-1)' }}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              Procedural / Max Randomness
            </span>
            <ToggleSwitch
              label=""
              enabled={isProceduralShuffle}
              setEnabled={setIsProceduralShuffle}
            />
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>
            {isProceduralShuffle
              ? `Generates unique continuous color variants for all ${selectedCount} selected parameters!`
              : 'Cycles directly through sample swatches.'}
          </p>
          {isProceduralShuffle && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-[11px]" style={{ color: 'var(--text-3)' }}>
                <span>Palette Jitter / Spread</span>
                <span className="font-mono">{Math.round(proceduralJitter * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.80"
                step="0.05"
                value={proceduralJitter}
                onChange={(e) => setProceduralJitter(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-none appearance-none cursor-pointer"
              />
            </div>
          )}
        </div>

        <button onClick={onApplyShuffle} className="w-full px-4 py-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }} disabled={isDisabled}>
          {isProceduralShuffle ? `Apply Max Shuffle (${selectedCount} Unique Colors)` : 'Apply Shuffle'}
        </button>

        {/* Quick Launch: Auto 12-Color Pack */}
        {onOpenTwelveColorModal && (
          <button
            type="button"
            onClick={onOpenTwelveColorModal}
            className="w-full mt-2 px-3 py-2 text-xs font-bold uppercase tracking-wider rounded-none border transition-all flex items-center justify-center gap-2 hover:brightness-125"
            style={{
              backgroundColor: 'var(--bg-2)',
              color: 'var(--accent-main)',
              borderColor: 'var(--accent-main)',
            }}
          >
            <span>⚡</span> Auto 12-Color Pack Generator
          </button>
        )}
      </div>

      {/* Brightness Multiplier */}
      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--bg-2)' }}>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium" style={{ color: 'var(--text-2)' }}>Brightness Multiplier</h3>
          <div className="flex items-center gap-1">
            <span className="text-sm opacity-60" style={{ color: 'var(--text-3)' }}>x</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={Number(brightnessMultiplier.toFixed(2))}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setBrightnessMultiplier(Number.isNaN(val) ? 1.0 : Math.max(0, Math.min(100, val)));
              }}
              className="w-20 px-1 py-0.5 text-center font-mono text-sm focus:outline-none border-2 rounded-none"
              style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-2)', borderColor: 'var(--bg-2)' }}
            />
          </div>
        </div>
        <div>
          {/* Mapping: 0-25% => 0x-1x, 25-100% => 1x-100x */}
          <input type="range" min="0" max="100" step="0.1"
            value={brightnessMultiplier <= 1 ? brightnessMultiplier * 25 : 25 + (brightnessMultiplier - 1) * (75 / 99)}
            onChange={(e) => {
              const s = parseFloat(e.target.value);
              const val = s <= 25 ? s / 25 : 1 + (s - 25) * (99 / 75);
              setBrightnessMultiplier(val);
            }}
            onDoubleClick={() => setBrightnessMultiplier(1.0)}
            className="w-full h-2 rounded-none appearance-none cursor-pointer" />
        </div>
        <button onClick={onApplyBrightnessMultiplier} className="w-full px-4 py-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }} disabled={isDisabled}>
          Apply Brightness
        </button>
      </div>

      {/* Opacity */}
      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--bg-2)' }}>
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium" style={{ color: 'var(--text-2)' }}>Opacity</h3>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={Number(opacityValue.toFixed(2))}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setOpacityValue(Number.isNaN(val) ? 1.0 : Math.max(0, Math.min(1, val)));
              }}
              className="w-20 px-1 py-0.5 text-center font-mono text-sm focus:outline-none border-2 rounded-none"
              style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-2)', borderColor: 'var(--bg-2)' }}
            />
          </div>
        </div>
        <div>
          <input type="range" min="0" max="1" step="0.01"
            value={opacityValue}
            onChange={(e) => setOpacityValue(parseFloat(e.target.value))}
            onDoubleClick={() => setOpacityValue(1.0)}
            className="w-full h-2 rounded-none appearance-none cursor-pointer" />
        </div>
        <button onClick={onApplyOpacity} className="w-full px-4 py-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }} disabled={isDisabled}>
          Apply Opacity
        </button>
      </div>

      {/* Toggles */}
      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--bg-2)' }}>
        <ToggleSwitch label="Preserve Intensity" enabled={preserveIntensity} setEnabled={setPreserveIntensity} />
        <ToggleSwitch label="Ignore Grayscale (R=G=B)" enabled={ignoreGrayscale} setEnabled={setIgnoreGrayscale} />
      </div>
    </div>
  );
}
