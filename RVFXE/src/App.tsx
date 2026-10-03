import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type {
  ColorParam, RGBA, AppSettings, CacheInfo, ConversionProgress,
  FilterDictionary, SortConfig, UassetSourceMap, FileObject, SessionEntry,
  UsmapStatus, BatchHeroSlot,
} from '@/types';
import { useHistory } from '@/hooks/useHistory';
import { useDebugLog } from '@/hooks/useDebugLog';
import { useKeyboard } from '@/hooks/useKeyboard';
import {
  hexToRgba,
  applyColorToParam,
  applyHueShiftToRgba,
  rgbToHsl,
  generateProceduralColors,
} from '@/utils/color';
import { setNestedValue, getFileName, normalizePath, pathsMatchSuffix } from '@/utils/helpers';
import { parseJsonAndExtractColors } from '@/services/colorParser';
import * as tauri from '@/services/tauri';
import { Header } from '@/components/Header';
import { DebugConsole } from '@/components/DebugConsole';
import { GlobalControls } from '@/components/GlobalControls';
import { ParameterTable } from '@/components/ParameterTable';
import { ColorRangeFilter } from '@/components/ColorRangeFilter';
import { LumaRangeFilter } from '@/components/LumaRangeFilter';
import { LoadFilesPanel } from '@/components/LoadFilesPanel';
import { ManualExtractionPage } from '@/components/ManualExtractionPage';
import { StyledPanel } from '@/components/ui';
import {
  SettingsModal,
  FilterSettingsModal,
  ConversionProgressOverlay,
  HeroBrowserModal,
  AutoTwelveColorModal,
  RvfxpImportModal,
  VfxUpdaterModal,
} from '@/components/modals';
import '../css/tailwind.min.css';
import '../css/fonts.css';
import '../css/style.css';

const DEFAULT_FILTER_DICTIONARY: FilterDictionary = {
  include_keywords: ['color', 'tint', 'Enemy', 'Emiss', 'Diff', 'XKTex3_Col'],
  exclude_keywords: ['Offset', 'uv', 'ColorMaskChannel', 'MaskColor_Enemy', 'MI_Master'],
  color_property_names: [
    'ColorAndOpacity', 'SpecifiedColor', 'BaseColor', 'HighlightColor',
    'FontTopColor', 'FontButtomColor', 'VectorParameter', 'ShadowColor',
    'ContentColor', 'OutlineColor', 'Color', 'TextColor', 'BackgroundColor',
  ],
};

// Isolated state for each tab / hero slot in memory
interface HeroSlotWorkspace {
  slotId: string;
  heroId: string;
  heroName: string;
  customLabel: string;
  koMode: boolean;
  colorParams: ColorParam[];
  originalFiles: Record<string, any>;
  uassetSourceMap: UassetSourceMap;
  selectedParams: Set<string>;
}

export function App() {
  // === CORE WORKSPACE STATE (FOR ACTIVE SLOT) ===
  const history = useHistory();
  const debug = useDebugLog();
  const {
    colorParams,
    recordHistory,
    handleUndo,
    handleRedo,
    historyIndex,
    historyLength,
    resetHistory,
    setInitialHistory,
    getOriginalParams,
  } = history;

  const selectAllRef = useRef<() => void>();
  const keyboard = useKeyboard(handleUndo, handleRedo, () => selectAllRef.current?.());
  const [originalFiles, setOriginalFiles] = useState<Record<string, any>>({});
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [masterColor, setMasterColor] = useState('#ffffff');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  // === FILTER/DISPLAY STATE ===
  const [ignoreGrayscale, setIgnoreGrayscale] = useState(true);
  const [preserveIntensity, setPreserveIntensity] = useState(true);
  const [showGrayscale, setShowGrayscale] = useState(true);
  const [showColor, setShowColor] = useState(true);
  const [showEnemy, setShowEnemy] = useState(true);
  const [hueShiftValue, setHueShiftValue] = useState(0);
  const [hueRange, setHueRange] = useState<[number, number]>([0, 360]);
  const [lumaRange, setLumaRange] = useState<[number, number]>([0, 100]);

  // === DYNAMIC & PROCEDURAL SHUFFLE STATE ===
  const [shuffleColors, setShuffleColors] = useState(['#ccffff', '#88eeee', '#66dddd']);
  const [isProceduralShuffle, setIsProceduralShuffle] = useState(false);
  const [proceduralJitter, setProceduralJitter] = useState(0.35);
  const [brightnessMultiplier, setBrightnessMultiplier] = useState(1.0);
  const [opacityValue, setOpacityValue] = useState(1.0);

  // === FOLDER/SORT STATE ===
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: null, direction: 'none' });
  const [sessionName, setSessionName] = useState('YourProjectName');
  const [filterDictionary, setFilterDictionary] = useState<FilterDictionary>(DEFAULT_FILTER_DICTIONARY);

  // === CURRENT LOADED HERO TRACKING ===
  const [currentHeroId, setCurrentHeroId] = useState<string | null>(null);
  const [currentHeroName, setCurrentHeroName] = useState<string | null>(null);
  const [isKoModeActive, setIsKoModeActive] = useState(false);

  // === ISOLATED BATCH SLOTS WORKSPACES ===
  const [batchSlots, setBatchSlots] = useState<HeroSlotWorkspace[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [applyToAllBatch, setApplyToAllBatch] = useState(false);

  // === MODALS STATE ===
  const [settings, setSettings] = useState<AppSettings>({
    usmapPath: null,
    paksPath: null,
    showDetailedErrors: true,
    autoClearCache: false,
    uiScale: 1,
    pakReadyStructure: true,
  });
  const [showHeroBrowser, setShowHeroBrowser] = useState(false);
  const [showManualExtraction, setShowManualExtraction] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFilterSettings, setShowFilterSettings] = useState(false);
  const [showTwelveColorModal, setShowTwelveColorModal] = useState(false);
  const [showVfxUpdater, setShowVfxUpdater] = useState(false);

  // === SMART RVFXP IMPORT STATE ===
  const [showRvfxpImport, setShowRvfxpImport] = useState(false);
  const [pendingRvfxp, setPendingRvfxp] = useState<{
    filePath: string;
    sessionData: SessionEntry[];
    detectedHeroId: string | null;
    detectedHeroName: string | null;
  } | null>(null);

  // === CONVERSION & CACHE STATE ===
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<ConversionProgress>({ current: 0, total: 0, fileName: '' });
  const [heroBrowserCacheInfo, setHeroBrowserCacheInfo] = useState<CacheInfo>({ fileCount: 0, totalSizeBytes: 0 });
  const [vfxCacheInfo, setVfxCacheInfo] = useState<CacheInfo>({ fileCount: 0, totalSizeBytes: 0 });
  const [manualCacheInfo, setManualCacheInfo] = useState<CacheInfo>({ fileCount: 0, totalSizeBytes: 0 });
  const [uassetSourceMap, setUassetSourceMap] = useState<UassetSourceMap>({});
  const [usmapStatus, setUsmapStatus] = useState<UsmapStatus | null>(null);
  const [usmapLoading, setUsmapLoading] = useState(false);

  // === PROGRESS LISTENER ===
  useEffect(() => {
    const unlistenPromise = tauri.listen('conversion-progress', (event: any) => {
      const { current, total, fileName } = event.payload;
      setConversionProgress({ current, total, fileName: fileName || 'Processing...' });
    });
    return () => { unlistenPromise.then((unlisten: () => void) => unlisten()); };
  }, []);

  // === LOAD SETTINGS FROM BACKEND ===
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loaded = await tauri.getSettings();
        setSettings(loaded);
        await tauri.applyWebviewUiScale(loaded.uiScale ?? 1);
        if (loaded.filterDictionary) {
          setFilterDictionary(loaded.filterDictionary);
        }
      } catch (err) {
        debug.addLog(`Failed to load settings: ${err}`);
      }
    };
    loadSettings();
  }, []);

  // === KEEP ACTIVE SLOT IN SYNC ===
  useEffect(() => {
    if (!activeSlotId || !isBatchMode) return;
    setBatchSlots(prev => prev.map(slot => {
      if (slot.slotId === activeSlotId) {
        return {
          ...slot,
          colorParams: [...colorParams],
          originalFiles: { ...originalFiles },
          uassetSourceMap: { ...uassetSourceMap },
          selectedParams: new Set(selectedParams),
          customLabel: sessionName,
        };
      }
      return slot;
    }));
  }, [colorParams, originalFiles, uassetSourceMap, selectedParams, sessionName, activeSlotId, isBatchMode]);

  // === DYNAMIC SHUFFLE PALETTE HANDLERS ===
  const handleAddShuffleColor = useCallback(() => {
    const randomHex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    setShuffleColors(prev => [...prev, randomHex]);
  }, []);

  const handleRemoveShuffleColor = useCallback((index: number) => {
    setShuffleColors(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSetShufflePaletteCount = useCallback((count: number) => {
    setShuffleColors(prev => {
      if (prev.length === count) return prev;
      if (prev.length < count) {
        const added: string[] = [];
        for (let i = prev.length; i < count; i++) {
          added.push('#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'));
        }
        return [...prev, ...added];
      }
      return prev.slice(0, count);
    });
  }, []);

// === COLOR ACTIONS ===
  const handleParamChange = useCallback((id: string, newRgba: RGBA) => {
    const newParams = colorParams.map(p => (p.id === id ? { ...p, rgba: newRgba } : p));
    recordHistory(newParams);
  }, [colorParams, recordHistory]);

  // === APPLY ACTIONS (WITH BATCH SYNC TOGGLE SUPPORT) ===
  const applyMasterColor = useCallback(() => {
    if (selectedParams.size === 0) { alert('No parameters selected.'); return; }
    const newRgba = hexToRgba(masterColor);

    // Apply to current active slot
    const newParams = colorParams.map(p => {
      if (selectedParams.has(p.id)) {
        return { ...p, rgba: applyColorToParam(p.rgba, newRgba, { preserveIntensity, ignoreGrayscale }) };
      }
      return p;
    });
    recordHistory(newParams);

    // If Sync All is checked, also update all other slots in memory
    if (isBatchMode && applyToAllBatch && batchSlots.length > 1) {
      setBatchSlots(prev => prev.map(s => {
        if (s.slotId === activeSlotId) return s;
        const updated = s.colorParams.map(p => ({
          ...p,
          rgba: applyColorToParam(p.rgba, newRgba, { preserveIntensity, ignoreGrayscale }),
        }));
        return { ...s, colorParams: updated };
      }));
      debug.addLog(`✓ Synced single color across all ${batchSlots.length} slots`);
    }
  }, [selectedParams, masterColor, colorParams, recordHistory, preserveIntensity, ignoreGrayscale, isBatchMode, applyToAllBatch, batchSlots.length, activeSlotId, debug]);

  const applyHueShift = useCallback(() => {
    if (selectedParams.size === 0) { alert('No parameters selected.'); return; }
    const newParams = colorParams.map(p => {
      if (selectedParams.has(p.id)) return { ...p, rgba: applyHueShiftToRgba(p.rgba, hueShiftValue, ignoreGrayscale) };
      return p;
    });
    recordHistory(newParams);
    setHueShiftValue(0);

    if (isBatchMode && applyToAllBatch && batchSlots.length > 1) {
      setBatchSlots(prev => prev.map(s => {
        if (s.slotId === activeSlotId) return s;
        const updated = s.colorParams.map(p => ({
          ...p,
          rgba: applyHueShiftToRgba(p.rgba, hueShiftValue, ignoreGrayscale),
        }));
        return { ...s, colorParams: updated };
      }));
      debug.addLog(`✓ Synced hue shift across all ${batchSlots.length} slots`);
    }
  }, [selectedParams, colorParams, hueShiftValue, ignoreGrayscale, recordHistory, isBatchMode, applyToAllBatch, batchSlots.length, activeSlotId, debug]);

  const applyShuffle = useCallback(() => {
    if (selectedParams.size === 0) { alert('No parameters selected.'); return; }
    if (isProceduralShuffle) {
      const selectedList = colorParams.filter(p => selectedParams.has(p.id));
      const generatedColors = generateProceduralColors(shuffleColors, selectedList.length, proceduralJitter);
      let colorIdx = 0;
      const newParams = colorParams.map(p => {
        if (selectedParams.has(p.id)) {
          const hex = generatedColors[colorIdx++];
          return {
            ...p,
            rgba: applyColorToParam(p.rgba, hexToRgba(hex), { preserveIntensity, ignoreGrayscale }),
          };
        }
        return p;
      });
      recordHistory(newParams);
      debug.addLog(`✓ Applied procedural shuffle (${selectedList.length} unique colors)`);
    } else {
      const paramsByName: Record<string, ColorParam[]> = {};
      colorParams.filter(p => selectedParams.has(p.id)).forEach(p => {
        if (!paramsByName[p.paramName]) paramsByName[p.paramName] = [];
        paramsByName[p.paramName].push(p);
      });
      const paramToColorMap: Record<string, string> = {};
      Object.entries(paramsByName).forEach(([, params]) => {
        const startIndex = Math.floor(Math.random() * shuffleColors.length);
        params.forEach((param, index) => {
          paramToColorMap[param.id] = shuffleColors[(startIndex + index) % shuffleColors.length];
        });
      });
      const newParams = colorParams.map(p => {
        if (selectedParams.has(p.id)) {
          const newColorHex = paramToColorMap[p.id];
          if (newColorHex) return { ...p, rgba: applyColorToParam(p.rgba, hexToRgba(newColorHex), { preserveIntensity, ignoreGrayscale }) };
        }
        return p;
      });
      recordHistory(newParams);
    }
  }, [selectedParams, isProceduralShuffle, colorParams, shuffleColors, proceduralJitter, preserveIntensity, ignoreGrayscale, recordHistory, debug]);

  const applyBrightnessMultiplier = useCallback(() => {
    if (selectedParams.size === 0) { alert('No parameters selected.'); return; }
    const newParams = colorParams.map(p => {
      if (selectedParams.has(p.id)) {
        return {
          ...p,
          rgba: {
            ...p.rgba,
            R: Math.min(100, Math.max(0, p.rgba.R * brightnessMultiplier)),
            G: Math.min(100, Math.max(0, p.rgba.G * brightnessMultiplier)),
            B: Math.min(100, Math.max(0, p.rgba.B * brightnessMultiplier)),
          },
        };
      }
      return p;
    });
    recordHistory(newParams);
    setBrightnessMultiplier(1.0);
  }, [selectedParams, colorParams, brightnessMultiplier, recordHistory]);

  const applyOpacity = useCallback(() => {
    if (selectedParams.size === 0) { alert('No parameters selected.'); return; }
    const newParams = colorParams.map(p => {
      if (selectedParams.has(p.id)) {
        return {
          ...p,
          rgba: { ...p.rgba, A: Math.min(1.0, Math.max(0.0, opacityValue)) },
        };
      }
      return p;
    });
    recordHistory(newParams);
    setOpacityValue(1.0);
  }, [selectedParams, colorParams, opacityValue, recordHistory]);

  const handleResetSelected = useCallback(() => {
    if (selectedParams.size === 0) { alert('No parameters selected.'); return; }
    const originalParams = getOriginalParams();
    if (originalParams.length === 0) return;
    let updatedCount = 0;
    const newParams = colorParams.map(p => {
      if (selectedParams.has(p.id)) {
        const originalP = originalParams.find(op => op.id === p.id);
        if (originalP && (originalP.rgba.R !== p.rgba.R || originalP.rgba.G !== p.rgba.G || originalP.rgba.B !== p.rgba.B || originalP.rgba.A !== p.rgba.A)) {
          updatedCount++;
          return { ...p, rgba: { ...originalP.rgba } };
        }
      }
      return p;
    });
    if (updatedCount > 0) {
      recordHistory(newParams);
      debug.addLog(`Reset ${updatedCount} parameters to original values`);
    }
  }, [selectedParams, getOriginalParams, colorParams, recordHistory, debug]);

  // === FILTERING & TABLE DISPLAY ===
  const baseFilteredParams = useMemo(() => {
    let sortableParams = [...colorParams];
    if (sortConfig.key !== null && sortConfig.direction !== 'none') {
      sortableParams.sort((a, b) => {
        if (sortConfig.key === 'color') {
          const [hA, sA, lA] = rgbToHsl(a.rgba.R, a.rgba.G, a.rgba.B);
          const [hB, sB, lB] = rgbToHsl(b.rgba.R, b.rgba.G, b.rgba.B);
          return hA !== hB ? hA - hB : sA !== sB ? sA - sB : lA - lB;
        }
        if (sortConfig.key === 'path') return a.relativePath.localeCompare(b.relativePath);
        if (sortConfig.key === 'paramName') return a.paramName.localeCompare(b.paramName);
        return 0;
      });
      if (sortConfig.direction === 'descending') sortableParams.reverse();
    }
    let params = sortableParams;
    if (folders.length > 0) {
      params = params.filter(p => {
        const lastSlash = p.relativePath.lastIndexOf('/');
        const folder = lastSlash > 0 ? p.relativePath.substring(0, lastSlash) : '/';
        return selectedFolders.has(folder);
      });
    }
    if (!showGrayscale) params = params.filter(p => p.rgba.R !== p.rgba.G || p.rgba.G !== p.rgba.B);
    if (!showColor) params = params.filter(p => p.rgba.R === p.rgba.G && p.rgba.G === p.rgba.B);
    if (!showEnemy) params = params.filter(p => !p.paramName.toLowerCase().includes('enemy') && !p.fileName.toLowerCase().includes('enemy') && !p.relativePath.toLowerCase().includes('enemy'));
    if (searchTerm) {
      const terms = searchTerm.split(',').map(t => t.trim()).filter(Boolean);
      const positiveTerms = terms.filter(t => !t.startsWith('-'));
      const negativeTerms = terms.filter(t => t.startsWith('-')).map(t => t.slice(1).trim()).filter(Boolean);
      params = params.filter(p => {
        const match = (t: string) => p.paramName.toLowerCase().includes(t.toLowerCase()) || p.relativePath.toLowerCase().includes(t.toLowerCase());
        const matchesPos = positiveTerms.length === 0 || positiveTerms.some(match);
        const matchesNeg = negativeTerms.length > 0 && negativeTerms.some(match);
        return matchesPos && !matchesNeg;
      });
    }
    return params;
  }, [colorParams, searchTerm, showGrayscale, showColor, showEnemy, selectedFolders, folders, sortConfig]);

  const filteredParams = useMemo(() => {
    let params = [...baseFilteredParams];
    if (hueRange[0] !== 0 || hueRange[1] !== 360) {
      params = params.filter(p => {
        const [h, s] = rgbToHsl(p.rgba.R, p.rgba.G, p.rgba.B);
        if (s < 0.05) return true;
        const hueDeg = h * 360;
        return hueDeg >= hueRange[0] && hueDeg <= hueRange[1];
      });
    }
    if (lumaRange[0] !== 0 || lumaRange[1] !== 100) {
      params = params.filter(p => {
        const [_, __, l] = rgbToHsl(p.rgba.R, p.rgba.G, p.rgba.B);
        const lumaPct = l * 100;
        return lumaPct >= lumaRange[0] && lumaPct <= lumaRange[1];
      });
    }
    return params;
  }, [baseFilteredParams, hueRange, lumaRange]);

  const paramIndexById = useMemo(() => {
    const map = new Map<string, number>();
    filteredParams.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [filteredParams]);

  const handleSelectionChange = useCallback((id: string) => {
    const index = paramIndexById.get(id);
    if (index === undefined) return;
    setSelectedParams(prev => {
      const next = new Set(prev);
      if ((keyboard.shiftKey || keyboard.altKey) && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          const currentId = filteredParams[i].id;
          if (keyboard.altKey) next.delete(currentId); else next.add(currentId);
        }
      } else {
        if (next.has(id)) next.delete(id); else next.add(id);
      }
      return next;
    });
    setLastSelectedIndex(index);
  }, [filteredParams, paramIndexById, keyboard.shiftKey, keyboard.altKey, lastSelectedIndex]);

  const filteredAssetCount = useMemo(() => new Set(filteredParams.map(p => p.relativePath)).size, [filteredParams]);

  const handleSelectAll = useCallback(() => {
    if (selectedParams.size === filteredParams.length) setSelectedParams(new Set());
    else setSelectedParams(new Set(filteredParams.map(p => p.id)));
  }, [selectedParams.size, filteredParams]);

  useEffect(() => { selectAllRef.current = handleSelectAll; }, [handleSelectAll]);

  const requestSort = useCallback((key: string) => {
    let direction: 'ascending' | 'descending' | 'none' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    else if (sortConfig.key === key && sortConfig.direction === 'descending') { direction = 'none'; key = ''; }
    setSortConfig({ key: key || null, direction });
  }, [sortConfig]);

  const handleFolderToggle = useCallback((folder: string, isAlt = false) => {
    setSelectedFolders(prev => {
      if (isAlt) return new Set([folder]);
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder); else next.add(folder);
      return next;
    });
  }, []);

  // === INSTANT TAB SWITCHING (0 SECONDS LAG, ZERO RE-EXTRACTION) ===
  const handleSwitchSlot = useCallback((targetSlotId: string) => {
    if (targetSlotId === activeSlotId) return;

    // 1. Commit active edits into batchSlots
    setBatchSlots(prev => prev.map(s => {
      if (s.slotId === activeSlotId) {
        return {
          ...s,
          colorParams: [...colorParams],
          originalFiles: { ...originalFiles },
          uassetSourceMap: { ...uassetSourceMap },
          selectedParams: new Set(selectedParams),
          customLabel: sessionName,
        };
      }
      return s;
    }));

    // 2. Load target slot from memory
    const target = batchSlots.find(s => s.slotId === targetSlotId);
    if (!target) return;

    setActiveSlotId(targetSlotId);
    setCurrentHeroId(target.heroId);
    setCurrentHeroName(target.heroName);
    setSessionName(target.customLabel);
    setOriginalFiles(target.originalFiles);
    setUassetSourceMap(target.uassetSourceMap);
    setInitialHistory(target.colorParams);
    setSelectedParams(new Set(target.selectedParams));

    const uniqueFolders = [...new Set(target.colorParams.map(p => {
      const lastSlash = p.relativePath.lastIndexOf('/');
      return lastSlash > 0 ? p.relativePath.substring(0, lastSlash) : '/';
    }))];
    setFolders(uniqueFolders.sort());
    setSelectedFolders(new Set(uniqueFolders));
  }, [activeSlotId, batchSlots, colorParams, originalFiles, uassetSourceMap, selectedParams, sessionName, setInitialHistory]);

  // === UP-FRONT BATCH EXTRACTION (RUNS ONCE FOR ALL QUEUED HEROES) ===
  const handleBatchLoadHeroes = useCallback(async (slots: BatchHeroSlot[], koMode: boolean) => {
    setShowHeroBrowser(false);
    setIsConverting(true);
    setIsBatchMode(true);
    setIsKoModeActive(koMode);

    try {
      // Find all distinct hero IDs in the queue
      const uniqueHeroIds = [...new Set(slots.map(s => s.heroId))];
      debug.addLog(`Beginning up-front extraction for ${uniqueHeroIds.length} heroes across ${slots.length} slots...`);

      const rawExtractedMap: Record<string, { fileObjs: FileObject[]; srcMap: Record<string, { uassetPath: string; jsonPath: string }> }> = {};

      for (let i = 0; i < uniqueHeroIds.length; i++) {
        const hId = uniqueHeroIds[i];
        setConversionProgress({
          current: i + 1,
          total: uniqueHeroIds.length,
          fileName: `Extracting & converting Hero ${hId} [${i + 1}/${uniqueHeroIds.length}]...`,
        });

        const res = await tauri.extractHeroVfx(hId, koMode);
        const fileObjs: FileObject[] = [];
        const srcMap: Record<string, { uassetPath: string; jsonPath: string }> = {};

        for (let j = 0; j < res.json_paths.length; j++) {
          const jsonPath = res.json_paths[j];
          const fileName = jsonPath.split(/[\\/]/).pop() || 'unknown.json';
          const uassetPath = res.uasset_paths[j] || '';
          try {
            const content = await tauri.readTextFile(jsonPath);
            const parts = jsonPath.replace(/\\/g, '/').split('/');
            const customIdx = parts.findIndex(p => p === 'Custom');
            const charsIdx = parts.findIndex(p => p === 'Characters');
            let relativePath = '';
            if (customIdx >= 0) relativePath = parts.slice(customIdx + 1).join('/');
            else if (charsIdx >= 0) {
              const heroIdx = parts.indexOf(hId, charsIdx + 1);
              relativePath = heroIdx >= 0 ? parts.slice(heroIdx).join('/') : `${hId}/${fileName}`;
            } else {
              const heroIdx = parts.lastIndexOf(hId);
              relativePath = heroIdx >= 0 ? parts.slice(heroIdx).join('/') : `${hId}/${fileName}`;
            }
            fileObjs.push({ name: fileName, content, relativePath });
            srcMap[relativePath] = { uassetPath, jsonPath };
          } catch (e) {}
        }
        rawExtractedMap[hId] = { fileObjs, srcMap };
      }

      // Initialize each slot with its own isolated memory copy
      const preparedSlots: HeroSlotWorkspace[] = [];
      for (const slot of slots) {
        const raw = rawExtractedMap[slot.heroId];
        if (!raw) continue;

        const slotParams: ColorParam[] = [];
        const slotOriginalFiles: Record<string, any> = {};

        raw.fileObjs.forEach(fileObj => {
          try {
            const json = JSON.parse(fileObj.content);
            slotOriginalFiles[fileObj.relativePath] = json;
            parseJsonAndExtractColors(json, fileObj.name, fileObj.relativePath, slotParams, filterDictionary, () => {});
          } catch (e) {}
        });

        const cleanLabel = slot.customLabel.replace(/\s+/g, '_') + (slot.customLabel.toLowerCase().includes('vfx') ? '' : '_VFX');

        preparedSlots.push({
          slotId: slot.slotId,
          heroId: slot.heroId,
          heroName: slot.heroName,
          customLabel: cleanLabel,
          koMode,
          colorParams: slotParams,
          originalFiles: slotOriginalFiles,
          uassetSourceMap: { ...raw.srcMap },
          selectedParams: new Set(slotParams.map(p => p.id)),
        });
      }

      setBatchSlots(preparedSlots);

      // Mount slot #1 immediately into the workspace
      if (preparedSlots.length > 0) {
        const first = preparedSlots[0];
        setActiveSlotId(first.slotId);
        setCurrentHeroId(first.heroId);
        setCurrentHeroName(first.heroName);
        setSessionName(first.customLabel);
        setOriginalFiles(first.originalFiles);
        setUassetSourceMap(first.uassetSourceMap);
        setInitialHistory(first.colorParams);
        setSelectedParams(new Set(first.selectedParams));

        const uniqueFolders = [...new Set(first.colorParams.map(p => {
          const lastSlash = p.relativePath.lastIndexOf('/');
          return lastSlash > 0 ? p.relativePath.substring(0, lastSlash) : '/';
        }))];
        setFolders(uniqueFolders.sort());
        setSelectedFolders(new Set(uniqueFolders));
      }

      debug.addLog(`✓ Batch ready! All ${preparedSlots.length} slots loaded into memory.`);
    } catch (err: any) {
      alert(`Batch preparation error: ${err.message || err}`);
    } finally {
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, fileName: '' });
    }
  }, [debug, filterDictionary, setInitialHistory]);

  // === SINGLE HERO SELECT (NON-BATCH) ===
  const handleHeroSelect = useCallback(async (heroId: string, heroName: string, koMode = false) => {
    setShowHeroBrowser(false);
    setIsConverting(true);
    setIsBatchMode(false);
    setBatchSlots([]);
    setActiveSlotId(null);

    setCurrentHeroId(heroId);
    setCurrentHeroName(heroName);
    setIsKoModeActive(koMode);

    try {
      const res = await tauri.extractHeroVfx(heroId, koMode);
      const fileObjs: FileObject[] = [];
      const srcMap: Record<string, { uassetPath: string; jsonPath: string }> = {};

      for (let j = 0; j < res.json_paths.length; j++) {
        const jsonPath = res.json_paths[j];
        const fileName = jsonPath.split(/[\\/]/).pop() || 'unknown.json';
        const uassetPath = res.uasset_paths[j] || '';
        try {
          const content = await tauri.readTextFile(jsonPath);
          const parts = jsonPath.replace(/\\/g, '/').split('/');
          const customIdx = parts.findIndex(p => p === 'Custom');
          const charsIdx = parts.findIndex(p => p === 'Characters');
          let relativePath = '';
          if (customIdx >= 0) relativePath = parts.slice(customIdx + 1).join('/');
          else if (charsIdx >= 0) {
            const heroIdx = parts.indexOf(heroId, charsIdx + 1);
            relativePath = heroIdx >= 0 ? parts.slice(heroIdx).join('/') : `${heroId}/${fileName}`;
          } else {
            const heroIdx = parts.lastIndexOf(heroId);
            relativePath = heroIdx >= 0 ? parts.slice(heroIdx).join('/') : `${heroId}/${fileName}`;
          }
          fileObjs.push({ name: fileName, content, relativePath });
          srcMap[relativePath] = { uassetPath, jsonPath };
        } catch (e) {}
      }

      const freshParams: ColorParam[] = [];
      const freshFiles: Record<string, any> = {};
      fileObjs.forEach(f => {
        try {
          const json = JSON.parse(f.content);
          freshFiles[f.relativePath] = json;
          parseJsonAndExtractColors(json, f.name, f.relativePath, freshParams, filterDictionary, debug.addLog);
        } catch (e) {}
      });

      const cleanName = koMode ? `${heroName.replace(/\s+/g, '_')}_KO` : `${heroName.replace(/\s+/g, '_')}_VFX`;
      setSessionName(cleanName);
      setOriginalFiles(freshFiles);
      setUassetSourceMap(srcMap);
      setInitialHistory(freshParams);
      setSelectedParams(new Set(freshParams.map(p => p.id)));

      const uniqueFolders = [...new Set(freshParams.map(p => {
        const lastSlash = p.relativePath.lastIndexOf('/');
        return lastSlash > 0 ? p.relativePath.substring(0, lastSlash) : '/';
      }))];
      setFolders(uniqueFolders.sort());
      setSelectedFolders(new Set(uniqueFolders));

      debug.addLog(`Loaded ${freshParams.length} parameters for ${heroName}`);
    } catch (err: any) {
      alert(`Failed to load ${heroName}: ${err}`);
    } finally {
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, fileName: '' });
    }
  }, [debug, filterDictionary, setInitialHistory]);

  // === SAVE SINGLE ACTIVE HERO (INTO ITS OWN MOD FOLDER) ===
  const handleSaveAsUasset = useCallback(async (saveAll = false) => {
    const uassetKeys = Object.keys(uassetSourceMap);
    if (uassetKeys.length === 0) { alert('No files loaded.'); return; }

    try {
      const outputPath = await tauri.openDialog({
        directory: true,
        multiple: false,
        title: 'Select Destination Folder (e.g. Done/)',
      }) as string;
      if (!outputPath) return;

      setIsConverting(true);
      const isPakReady = settings.pakReadyStructure ?? true;
      const cleanModFolder = sessionName.replace(/\.rvfxp$/i, '').replace(/\s+/g, '_');

      const filesToSave = saveAll ? uassetKeys : uassetKeys.filter(k => {
        const orig = originalFiles[k];
        if (!orig) return false;
        return colorParams.some(p => p.relativePath === k);
      });

      const modifiedFiles: Record<string, any> = {};
      for (const k of filesToSave) {
        if (originalFiles[k]) modifiedFiles[k] = structuredClone(originalFiles[k]);
      }
      colorParams.forEach(p => {
        if (modifiedFiles[p.relativePath]) setNestedValue(modifiedFiles[p.relativePath], p.path, p.rgba);
      });

      const jsonPathsForConversion: string[] = [];
      for (const keyPath of filesToSave) {
        const sourceInfo = uassetSourceMap[keyPath];
        if (sourceInfo?.jsonPath && modifiedFiles[keyPath]) {
          const jsonContent = JSON.stringify(modifiedFiles[keyPath], null, 2);
          await tauri.writeTextFile(sourceInfo.jsonPath, jsonContent);

          let outRelPath = keyPath.replace(/\.json$/i, '.uasset');
          if (isPakReady) {
            const heroSubPart = outRelPath.replace(/^.*Characters\//i, '').replace(/^.*Custom\//i, '');
            outRelPath = `${cleanModFolder}/Marvel/Content/Marvel/VFX/Materials/Characters/${heroSubPart}`;
          } else {
            outRelPath = `${cleanModFolder}/${outRelPath}`;
          }
          jsonPathsForConversion.push(`${sourceInfo.jsonPath},${outRelPath}`);
        }
      }

      if (jsonPathsForConversion.length > 0) {
        await tauri.batchConvertJsonsToUassets(jsonPathsForConversion, outputPath);
      }

      // Write matching .rvfxp project profile
      const modRoot = isPakReady ? `${outputPath}/${cleanModFolder}` : outputPath;
      const sessionData: SessionEntry[] = colorParams.map(p => ({
        relativePath: p.relativePath.replace(/\.json$/i, ''),
        paramName: p.paramName,
        rgba: p.rgba,
      }));
      await tauri.writeTextFile(`${modRoot}/${cleanModFolder}.rvfxp`, JSON.stringify(sessionData, null, 2));

      setSaveStatus(`Saved ${cleanModFolder} successfully!`);
      await tauri.openFolder(outputPath);
      alert(`Success! Mod saved in:\n${outputPath}\\${cleanModFolder}`);
    } catch (err: any) {
      alert(`Save error: ${err.message || err}`);
    } finally {
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, fileName: '' });
      setTimeout(() => setSaveStatus(''), 8000);
    }
  }, [uassetSourceMap, settings.pakReadyStructure, sessionName, originalFiles, colorParams]);

  // === ⚡ BATCH SAVE ALL SLOTS (EVERY HERO GETS ITS OWN FOLDER) ===
  const handleBatchSaveAll = useCallback(async () => {
    if (batchSlots.length === 0) return;

    try {
      const outputPath = await tauri.openDialog({
        directory: true,
        multiple: false,
        title: 'Select Destination Folder for All Mod Packs (e.g. Done/)',
      }) as string;
      if (!outputPath) return;

      setIsConverting(true);
      const isPakReady = settings.pakReadyStructure ?? true;
      const totalSlots = batchSlots.length;

      for (let sIdx = 0; sIdx < totalSlots; sIdx++) {
        const slot = batchSlots[sIdx];
        const cleanModFolder = slot.customLabel.replace(/\.rvfxp$/i, '').replace(/\s+/g, '_');

        setConversionProgress({
          current: sIdx + 1,
          total: totalSlots,
          fileName: `[${sIdx + 1}/${totalSlots}] Exporting ${cleanModFolder}...`,
        });

        // Build modified file data for this isolated slot
        const modifiedFiles: Record<string, any> = {};
        for (const k of Object.keys(slot.originalFiles)) {
          modifiedFiles[k] = structuredClone(slot.originalFiles[k]);
        }
        slot.colorParams.forEach(p => {
          if (modifiedFiles[p.relativePath]) setNestedValue(modifiedFiles[p.relativePath], p.path, p.rgba);
        });

        const jsonPathsForConversion: string[] = [];
        const filesToSave = Object.keys(modifiedFiles).filter(k => slot.uassetSourceMap[k]?.jsonPath);

        for (const keyPath of filesToSave) {
          const sourceInfo = slot.uassetSourceMap[keyPath];
          if (sourceInfo?.jsonPath) {
            const jsonContent = JSON.stringify(modifiedFiles[keyPath], null, 2);
            await tauri.writeTextFile(sourceInfo.jsonPath, jsonContent);

            let outRelPath = keyPath.replace(/\.json$/i, '.uasset');
            if (isPakReady) {
              const heroSubPart = outRelPath.replace(/^.*Characters\//i, '').replace(/^.*Custom\//i, '');
              outRelPath = `${cleanModFolder}/Marvel/Content/Marvel/VFX/Materials/Characters/${heroSubPart}`;
            } else {
              outRelPath = `${cleanModFolder}/${outRelPath}`;
            }
            jsonPathsForConversion.push(`${sourceInfo.jsonPath},${outRelPath}`);
          }
        }

        if (jsonPathsForConversion.length > 0) {
          await tauri.batchConvertJsonsToUassets(jsonPathsForConversion, outputPath);
        }

        // Auto-write .rvfxp file in each separate folder
        try {
          const modRoot = isPakReady ? `${outputPath}/${cleanModFolder}` : outputPath;
          const sessionData: SessionEntry[] = slot.colorParams.map(p => ({
            relativePath: p.relativePath.replace(/\.json$/i, ''),
            paramName: p.paramName,
            rgba: p.rgba,
          }));
          await tauri.writeTextFile(`${modRoot}/${cleanModFolder}.rvfxp`, JSON.stringify(sessionData, null, 2));
        } catch (e) {}

        debug.addLog(`✓ Exported ${cleanModFolder} into separate mod folder`);
      }

      setSaveStatus(`All ${totalSlots} mod packs saved!`);
      await tauri.openFolder(outputPath);
      alert(`Success! All ${totalSlots} mod packs exported into separate folders in:\n${outputPath}`);
    } catch (err: any) {
      alert(`Batch save error: ${err.message || err}`);
    } finally {
      setIsConverting(false);
      setConversionProgress({ current: 0, total: 0, fileName: '' });
      setTimeout(() => setSaveStatus(''), 10000);
    }
  }, [batchSlots, settings.pakReadyStructure, debug]);

  // === SMART RVFXP IMPORT FLOW ===
  const handleImportSession = useCallback(async () => {
    try {
      const filePath = await tauri.openDialog({
        title: 'Import Project File (.rvfxp)',
        multiple: false,
        filters: [{ name: 'RVFX Project', extensions: ['rvfxp', 'json'] }],
      });
      if (!filePath) return;
      const content = await tauri.readTextFile(filePath as string);
      const sessionData: SessionEntry[] = JSON.parse(content);
      if (!Array.isArray(sessionData)) { alert('Invalid project file format.'); return; }

      let detectedHeroId: string | null = null;
      for (const entry of sessionData) {
        const m = entry.relativePath.match(/(?:Characters|Custom)[\\/](\d{4})/i) || entry.relativePath.match(/^(\d{4})[\\/]/);
        if (m) { detectedHeroId = m[1]; break; }
      }

      let detectedHeroName: string | null = null;
      if (detectedHeroId) {
        try {
          const roster = await tauri.getHeroRoster(false);
          const hero = roster.heroes.find(h => h.hero_id === detectedHeroId);
          if (hero) detectedHeroName = hero.display_name;
        } catch (e) {}
      }

      setPendingRvfxp({
        filePath: filePath as string,
        sessionData,
        detectedHeroId,
        detectedHeroName,
      });
      setShowRvfxpImport(true);
    } catch (err: any) {
      alert(`Failed to import session: ${err.message || err}`);
    }
  }, []);

  const applyRvfxpToLoadedParams = useCallback((sessionData: SessionEntry[]) => {
    let updatedCount = 0;
    const newColorParams = colorParams.map(param => {
      const paramNorm = normalizePath(param.relativePath);
      const paramFileName = getFileName(param.relativePath).toLowerCase().replace(/\.json$/i, '').replace(/\.uasset$/i, '');
      let match = sessionData.find(e => normalizePath(e.relativePath) === paramNorm && e.paramName === param.paramName);
      if (!match) match = sessionData.find(e => pathsMatchSuffix(normalizePath(e.relativePath), paramNorm) && e.paramName === param.paramName);
      if (!match) match = sessionData.find(e => getFileName(e.relativePath).toLowerCase().replace(/\.json$/i, '').replace(/\.uasset$/i, '') === paramFileName && e.paramName === param.paramName);
      if (match?.rgba) {
        updatedCount++;
        return {
          ...param,
          rgba: {
            R: match.rgba.R ?? param.rgba.R,
            G: match.rgba.G ?? param.rgba.G,
            B: match.rgba.B ?? param.rgba.B,
            A: match.rgba.A ?? param.rgba.A,
          },
        };
      }
      return param;
    });
    recordHistory(newColorParams);
    debug.addLog(`Updated ${updatedCount} parameters from .rvfxp`);
    alert(`Imported! ${updatedCount} parameters updated.`);
  }, [colorParams, recordHistory, debug]);

  const handleApplyRvfxpCurrent = useCallback(() => {
    if (!pendingRvfxp) return;
    applyRvfxpToLoadedParams(pendingRvfxp.sessionData);
    setShowRvfxpImport(false);
    setPendingRvfxp(null);
  }, [pendingRvfxp, applyRvfxpToLoadedParams]);

  const handleFreshReimportRvfxp = useCallback(async () => {
    if (!pendingRvfxp || !pendingRvfxp.detectedHeroId) return;
    const { detectedHeroId, detectedHeroName, sessionData } = pendingRvfxp;
    setShowRvfxpImport(false);
    await handleHeroSelect(detectedHeroId, detectedHeroName || detectedHeroId, false);
    setTimeout(() => {
      applyRvfxpToLoadedParams(sessionData);
      setPendingRvfxp(null);
    }, 400);
  }, [pendingRvfxp, handleHeroSelect, applyRvfxpToLoadedParams]);

  // === EXPORT CURRENT SESSION FILE ===
  const handleExportSession = useCallback(async () => {
    if (selectedParams.size === 0) { alert('No parameters selected to export.'); return; }
    const sessionData: SessionEntry[] = colorParams.filter(p => selectedParams.has(p.id)).map(p => ({
      relativePath: p.relativePath.replace(/\.json$/i, ''),
      paramName: p.paramName,
      rgba: p.rgba,
    }));
    try {
      const fileName = sessionName.endsWith('.rvfxp') ? sessionName : `${sessionName}.rvfxp`;
      const filePath = await tauri.saveDialog({
        title: 'Export Project File',
        defaultPath: fileName,
        filters: [{ name: 'RVFX Project', extensions: ['rvfxp'] }],
      });
      if (!filePath) return;
      await tauri.writeTextFile(filePath as string, JSON.stringify(sessionData, null, 2));
      alert('Project exported successfully!');
    } catch (err: any) {
      alert(`Failed to export session: ${err.message || err}`);
    }
  }, [colorParams, selectedParams, sessionName]);

  // === FULL RESET ===
  const handleReset = useCallback(() => {
    resetHistory();
    setOriginalFiles({});
    setSelectedParams(new Set());
    setSearchTerm('');
    setFolders([]);
    setSelectedFolders(new Set());
    setSessionName('YourProjectName');
    setCurrentHeroId(null);
    setCurrentHeroName(null);
    setBatchSlots([]);
    setIsBatchMode(false);
    setActiveSlotId(null);
    setMasterColor('#ffffff');
    setHueShiftValue(0);
    setShuffleColors(['#ccffff', '#88eeee', '#66dddd']);
    setIsProceduralShuffle(false);
    setPreserveIntensity(true);
    setIgnoreGrayscale(true);
    setShowGrayscale(true);
    setOpacityValue(1.0);
    setUassetSourceMap({});
  }, [resetHistory]);

  return (
    <div style={{ backgroundColor: 'var(--bg-4)', color: 'var(--text-3)' }} className="h-screen p-6 flex flex-col overflow-hidden">
      <DebugConsole logs={debug.logs} showDebug={debug.showDebug} setShowDebug={debug.setShowDebug} clearLogs={debug.clearLogs} />
      <div className="w-full flex-1 flex flex-col min-h-0">
        <Header
          settings={settings}
          onOpenSettings={() => setShowSettings(true)}
          onOpenFilterSettings={() => setShowFilterSettings(true)}
          onOpenVfxUpdater={() => setShowVfxUpdater(true)}
          onReset={handleReset}
          addDebugLog={debug.addLog}
          onToggleMinimize={() => {
            const newVal = !settings.isHeaderMinimized;
            setSettings(s => ({ ...s, isHeaderMinimized: newVal }));
            tauri.setHeaderMinimized(newVal).catch(console.error);
          }}
        />

        {usmapLoading && (
          <div className="mt-2 px-4 py-2 text-sm flex items-center gap-2" style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-3)' }}>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="10" /></svg>
            Updating mapping files...
          </div>
        )}

        <div className="mt-8 mb-0 flex-1 flex flex-col min-h-0">
          {showManualExtraction ? (
            <ManualExtractionPage
              onClose={() => setShowManualExtraction(false)}
              onExtract={async (paths) => {
                setShowManualExtraction(false);
                setIsConverting(true);
                const result = await tauri.extractManualAssets(paths);
                const fileObjs: FileObject[] = [];
                const srcMap: Record<string, { uassetPath: string; jsonPath: string }> = {};
                for (let i = 0; i < result.json_paths.length; i++) {
                  const content = await tauri.readTextFile(result.json_paths[i]);
                  const name = result.json_paths[i].split(/[\\/]/).pop() || '';
                  const rel = result.json_paths[i].replace(/\\/g, '/').split('/Content/').pop() || name;
                  fileObjs.push({ name, content, relativePath: rel });
                  srcMap[rel] = { uassetPath: result.uasset_paths[i], jsonPath: result.json_paths[i] };
                }
                setUassetSourceMap(srcMap);
                setOriginalFiles({});
                const freshParams: ColorParam[] = [];
                const freshFiles: Record<string, any> = {};
                fileObjs.forEach(f => {
                  try {
                    const json = JSON.parse(f.content);
                    freshFiles[f.relativePath] = json;
                    parseJsonAndExtractColors(json, f.name, f.relativePath, freshParams, filterDictionary, debug.addLog);
                  } catch (e) {}
                });
                setOriginalFiles(freshFiles);
                setInitialHistory(freshParams);
                setSelectedParams(new Set(freshParams.map(p => p.id)));
                setIsConverting(false);
              }}
              addDebugLog={debug.addLog}
            />
          ) : colorParams.length > 0 ? (
            <div className="flex flex-col lg:flex-row gap-8 flex-1 min-h-0">
              {/* Left Global Controls */}
              <div className="lg:flex-shrink-0 global-controls-wrapper w-full flex flex-col min-h-0">
                <StyledPanel title="Global Controls" className="flex flex-col flex-1 min-h-0" bodyClassName="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 pt-8">
                  <GlobalControls
                    masterColor={masterColor} setMasterColor={setMasterColor}
                    hueShiftValue={hueShiftValue} setHueShiftValue={setHueShiftValue}
                    useFiveColors={false}
                    shuffleColors={shuffleColors}
                    onShuffleColorChange={(i, c) => { const nc = [...shuffleColors]; nc[i] = c; setShuffleColors(nc); }}
                    onAddShuffleColor={handleAddShuffleColor}
                    onRemoveShuffleColor={handleRemoveShuffleColor}
                    onSetShufflePaletteCount={handleSetShufflePaletteCount}
                    isProceduralShuffle={isProceduralShuffle}
                    setIsProceduralShuffle={setIsProceduralShuffle}
                    proceduralJitter={proceduralJitter}
                    setProceduralJitter={setProceduralJitter}
                    preserveIntensity={preserveIntensity} setPreserveIntensity={setPreserveIntensity}
                    ignoreGrayscale={ignoreGrayscale} setIgnoreGrayscale={setIgnoreGrayscale}
                    brightnessMultiplier={brightnessMultiplier} setBrightnessMultiplier={setBrightnessMultiplier}
                    opacityValue={opacityValue} setOpacityValue={setOpacityValue}
                    selectedCount={selectedParams.size}
                    onApplyMasterColor={applyMasterColor}
                    onApplyHueShift={applyHueShift}
                    onApplyShuffle={applyShuffle}
                    onApplyBrightnessMultiplier={applyBrightnessMultiplier}
                    onApplyOpacity={applyOpacity}
                    isBatchMode={isBatchMode}
                    batchCount={batchSlots.length}
                    applyToAllBatch={applyToAllBatch}
                    setApplyToAllBatch={setApplyToAllBatch}
                    onOpenTwelveColorModal={() => setShowTwelveColorModal(true)}
                  />
                </StyledPanel>
              </div>

              {/* Right Parameters Workspace */}
              <div className="flex-grow lg:flex-1 min-w-0 flex flex-col min-h-0">
                <StyledPanel title="Parameters" className="flex flex-col flex-1 min-h-0" bodyClassName="flex flex-col flex-1 min-h-0 p-6 pt-8 pb-4">
                  {/* ISOLATED SLOTS TAB BAR */}
                  {isBatchMode && batchSlots.length > 0 && (
                    <div className="px-4 py-2 border-b flex items-center justify-between gap-3 overflow-x-auto" style={{ borderColor: 'var(--bg-2)', backgroundColor: 'var(--bg-2)' }}>
                      <div className="flex items-center gap-2 overflow-x-auto">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-main)] flex-shrink-0">
                          SLOTS:
                        </span>
                        {batchSlots.map((slot, idx) => {
                          const isActive = activeSlotId === slot.slotId;
                          return (
                            <button
                              key={slot.slotId}
                              onClick={() => handleSwitchSlot(slot.slotId)}
                              className="px-3 py-1 text-xs border font-mono truncate transition-all duration-150"
                              style={{
                                backgroundColor: isActive ? 'var(--accent-main)' : 'var(--bg-3)',
                                color: isActive ? 'var(--bg-4)' : 'var(--text-2)',
                                borderColor: isActive ? 'var(--accent-main)' : 'var(--bg-1)',
                                fontWeight: isActive ? 'bold' : 'normal',
                              }}
                            >
                              #{idx + 1} {slot.customLabel}
                            </button>
                          );
                        })}
                      </div>

                      {/* BATCH SAVE ALL SLOTS BUTTON */}
                      <button
                        onClick={handleBatchSaveAll}
                        disabled={isConverting}
                        className="px-3 py-1 text-xs font-bold uppercase tracking-wider flex-shrink-0 transition-all border"
                        style={{
                          backgroundColor: '#0284c7',
                          color: 'white',
                          borderColor: '#38bdf8',
                        }}
                        title="Save each slot into its own separate mod folder automatically"
                      >
                        ⚡ Save All ({batchSlots.length}) Slots
                      </button>
                    </div>
                  )}

                  <div className="px-4 pb-4 pt-0 flex flex-col gap-4 border-b flex-shrink-0" style={{ borderColor: 'var(--bg-2)' }}>
                    <div className="flex flex-col gap-4 w-full">
                      {/* Project Filename & Save Controls */}
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          <label htmlFor="sessionNameInput" className="text-sm" style={{ color: 'var(--text-3)' }}>Project Filename:</label>
                          <input
                            id="sessionNameInput"
                            type="text"
                            value={sessionName}
                            onChange={(e) => setSessionName(e.target.value)}
                            className="w-48 px-3 py-1 rounded-none focus:outline-none focus:ring-2"
                            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)', color: 'var(--text-2)' }}
                          />
                          <span className="text-sm" style={{ color: 'var(--text-4)' }}>.rvfxp</span>
                          <button onClick={handleImportSession} title="Import Project (.rvfxp)" className="flex items-center justify-center w-8 h-8 rounded-none transition-colors shadow-md ml-2" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-1)' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                          </button>
                          <button onClick={handleExportSession} title="Export Selected to Project (.rvfxp)" className="flex items-center justify-center w-8 h-8 rounded-none transition-colors shadow-md" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-1)' }}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                          </button>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                          {saveStatus && <span className="text-xs whitespace-nowrap mr-2" style={{ color: 'var(--text-4)' }}>{saveStatus}</span>}
                          <button onClick={handleResetSelected} title="Reset Selected to Original" className="px-3 py-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-1)' }} disabled={selectedParams.size === 0}>
                            <span className="text-sm">Reset</span>
                          </button>
                          <button onClick={handleUndo} title="Undo (Ctrl+Z)" className="p-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-1)' }} disabled={historyIndex === 0}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                          </button>
                          <button onClick={handleRedo} title="Redo (Ctrl+Y)" className="p-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-1)' }} disabled={historyIndex >= historyLength - 1}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                          </button>

                          <button
                            onClick={(e) => handleSaveAsUasset(e.shiftKey)}
                            disabled={isConverting}
                            title="Save current hero mod folder"
                            className="flex items-center gap-2 px-6 py-2 font-medium rounded-none transition-colors shadow-md disabled:opacity-50 whitespace-nowrap"
                            style={{ backgroundColor: 'var(--accent-green)', color: 'var(--text-1)' }}
                          >
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 21v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4M7 21h10M5 21H3V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2h-2M12 11v-4M9 11h6" /></svg>
                            Save UAsset
                          </button>
                        </div>
                      </div>

                      {/* Parameter Filters */}
                      <div className="flex items-center gap-4">
                        <input
                          type="text"
                          placeholder="Filter by name..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-none focus:outline-none focus:ring-2"
                          style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)', color: 'var(--text-2)' }}
                        />
                        <label className="flex items-center text-sm cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                          <input type="checkbox" checked={showColor} onChange={() => setShowColor(!showColor)} className="w-4 h-4 mr-2" />
                          Show Color
                        </label>
                        <label className="flex items-center text-sm cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                          <input type="checkbox" checked={showGrayscale} onChange={() => setShowGrayscale(!showGrayscale)} className="w-4 h-4 mr-2" />
                          Show Grayscale
                        </label>
                        <label className="flex items-center text-sm cursor-pointer whitespace-nowrap" style={{ color: 'var(--text-3)' }}>
                          <input type="checkbox" checked={showEnemy} onChange={() => setShowEnemy(!showEnemy)} className="w-4 h-4 mr-2" />
                          Show Enemy
                        </label>
                      </div>

                      {/* Dual Range Sliders */}
                      {baseFilteredParams.length > 0 && (
                        <div className="flex flex-row gap-6 w-full">
                          <div className="flex-1 min-w-0">
                            <ColorRangeFilter colorParams={baseFilteredParams} hueRange={hueRange} onHueRangeChange={setHueRange} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <LumaRangeFilter colorParams={baseFilteredParams} lumaRange={lumaRange} onLumaRangeChange={setLumaRange} />
                          </div>
                        </div>
                      )}

                      {/* Folders List (Isolated for current active hero only) */}
                      {folders.length > 1 && (
                        <div>
                          <h4 className="text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>Filter by Folder:</h4>
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {folders.map(folder => (
                              <label key={folder} className="flex items-center text-xs cursor-pointer" style={{ color: 'var(--text-3)' }}>
                                <input
                                  type="checkbox"
                                  checked={selectedFolders.has(folder)}
                                  onClick={(e) => { if (e.altKey) { e.preventDefault(); handleFolderToggle(folder, true); } }}
                                  onChange={(e) => { if (!(e.nativeEvent as MouseEvent).altKey) handleFolderToggle(folder); }}
                                  className="w-3 h-3 mr-1"
                                />
                                {folder === '/' ? 'Root' : folder}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="text-sm" style={{ color: 'var(--text-4)' }}>
                      {filteredParams.length} color parameters found across {filteredAssetCount} assets for{' '}
                      <strong className="text-white">{currentHeroName || sessionName}</strong>. <span style={{ color: 'var(--accent-main)' }}>{selectedParams.size} selected.</span>
                    </p>
                  </div>

                  <ParameterTable
                    filteredParams={filteredParams} selectedParams={selectedParams}
                    hueShiftValue={hueShiftValue} ignoreGrayscale={ignoreGrayscale} preserveIntensity={preserveIntensity}
                    sortConfig={sortConfig} onSelectionChange={handleSelectionChange} onSelectAll={handleSelectAll}
                    onParamChange={handleParamChange} onRequestSort={requestSort}
                  />
                </StyledPanel>
              </div>
            </div>
          ) : (
            <LoadFilesPanel
              settings={settings}
              isDragging={isDragging}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); }}
              onSelectFolder={async () => {
                const selectedPath = await tauri.openDialog({ directory: true, multiple: false }) as string;
                if (!selectedPath) return;
                setIsConverting(true);
                const result = await tauri.batchConvertDirectory(selectedPath);
                const fileObjs: FileObject[] = [];
                const srcMap: Record<string, { uassetPath: string; jsonPath: string }> = {};
                for (let i = 0; i < result.json_paths.length; i++) {
                  const content = await tauri.readTextFile(result.json_paths[i]);
                  const name = result.json_paths[i].split(/[\\/]/).pop() || '';
                  fileObjs.push({ name, content, relativePath: name });
                  srcMap[name] = { uassetPath: result.uasset_paths[i], jsonPath: result.json_paths[i] };
                }
                setUassetSourceMap(srcMap);
                const freshParams: ColorParam[] = [];
                const freshFiles: Record<string, any> = {};
                fileObjs.forEach(f => {
                  try {
                    const json = JSON.parse(f.content);
                    freshFiles[f.relativePath] = json;
                    parseJsonAndExtractColors(json, f.name, f.relativePath, freshParams, filterDictionary, debug.addLog);
                  } catch (e) {}
                });
                setOriginalFiles(freshFiles);
                setInitialHistory(freshParams);
                setSelectedParams(new Set(freshParams.map(p => p.id)));
                setIsConverting(false);
              }}
              onBrowseHeroes={() => setShowHeroBrowser(true)}
              onManualExtraction={() => setShowManualExtraction(true)}
            />
          )}
        </div>
      </div>

      {/* MODALS */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          setSettings={setSettings}
          heroBrowserCacheInfo={heroBrowserCacheInfo}
          vfxCacheInfo={vfxCacheInfo}
          manualCacheInfo={manualCacheInfo}
          onClose={() => setShowSettings(false)}
          onClearHeroBrowserCache={async () => { await tauri.clearHeroBrowserCache(); setHeroBrowserCacheInfo({ fileCount: 0, totalSizeBytes: 0 }); }}
          onClearVfxCache={async () => { await tauri.clearVfxCache(); setVfxCacheInfo({ fileCount: 0, totalSizeBytes: 0 }); }}
          onClearManualCache={async () => { await tauri.clearManualCache(); setManualCacheInfo({ fileCount: 0, totalSizeBytes: 0 }); }}
        />
      )}

      {showFilterSettings && (
        <FilterSettingsModal
          filterDictionary={filterDictionary}
          onChangeDictionary={async (dict) => {
            setFilterDictionary(dict);
            await tauri.setFilterDictionary(dict);
          }}
          onClose={() => setShowFilterSettings(false)}
          onReset={() => setFilterDictionary(DEFAULT_FILTER_DICTIONARY)}
        />
      )}

      {showHeroBrowser && (
        <HeroBrowserModal
          onClose={() => setShowHeroBrowser(false)}
          onSelectHero={handleHeroSelect}
          onBatchLoadHeroes={handleBatchLoadHeroes}
          addDebugLog={debug.addLog}
        />
      )}

      {showTwelveColorModal && currentHeroId && (
        <AutoTwelveColorModal
          heroId={currentHeroId}
          heroName={currentHeroName || currentHeroId}
          colorParams={colorParams}
          originalFiles={originalFiles}
          uassetSourceMap={uassetSourceMap}
          preserveIntensity={preserveIntensity}
          ignoreGrayscale={ignoreGrayscale}
          onClose={() => setShowTwelveColorModal(false)}
          addDebugLog={debug.addLog}
        />
      )}

      {showRvfxpImport && pendingRvfxp && (
        <RvfxpImportModal
          filePath={pendingRvfxp.filePath}
          sessionData={pendingRvfxp.sessionData}
          detectedHeroId={pendingRvfxp.detectedHeroId}
          detectedHeroName={pendingRvfxp.detectedHeroName}
          currentLoadedHeroId={currentHeroId}
          onApplyCurrent={handleApplyRvfxpCurrent}
          onFreshReimport={handleFreshReimportRvfxp}
          onClose={() => {
            setShowRvfxpImport(false);
            setPendingRvfxp(null);
          }}
        />
      )}

      {showVfxUpdater && (
        <VfxUpdaterModal
          initialUsmapPath={settings.usmapPath}
          onClose={() => setShowVfxUpdater(false)}
          addDebugLog={debug.addLog}
        />
      )}

      {isConverting && <ConversionProgressOverlay conversionProgress={conversionProgress} />}
    </div>
  );
}