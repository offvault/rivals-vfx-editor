import { useState, useEffect, useCallback } from 'react';
import type { HeroEntry, BatchHeroSlot } from '@/types';
import * as tauri from '@/services/tauri';

// Module-level cache so icon data URLs persist across modal open/close cycles
const iconDataUrlCache: Record<string, string> = {};
const iconLoadedGlobal = new Set<string>();

interface HeroBrowserModalProps {
  onClose: () => void;
  onSelectHero: (heroId: string, heroName: string, koMode: boolean) => void;
  onBatchLoadHeroes?: (slots: BatchHeroSlot[], koMode: boolean) => void;
  addDebugLog: (msg: string) => void;
}

export function HeroBrowserModal({ onClose, onSelectHero, onBatchLoadHeroes, addDebugLog }: HeroBrowserModalProps) {
  const [heroes, setHeroes] = useState<HeroEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHeroId, setSelectedHeroId] = useState<string | null>(null);
  const [loadingVfx, setLoadingVfx] = useState(false);
  const [iconDataUrls, setIconDataUrls] = useState<Record<string, string>>({ ...iconDataUrlCache });
  const [loadingIcons, setLoadingIcons] = useState(false);
  const [koMode, setKoMode] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchQueue, setBatchQueue] = useState<BatchHeroSlot[]>([]);

  // Load hero roster on mount
  useEffect(() => {
    const loadRoster = async () => {
      setLoading(true);
      setError(null);
      try {
        console.debug('[HeroBrowser] Loading hero roster...');
        addDebugLog('Loading hero roster from game files...');
        const result = await tauri.getHeroRoster(false);
        console.debug('[HeroBrowser] Roster result:', result);

        if (result.error) {
          setError(result.error);
          addDebugLog(`Hero roster error: ${result.error}`);
        } else {
          setHeroes(result.heroes);
          addDebugLog(`Loaded ${result.heroes.length} heroes${result.cached ? ' (cached)' : ''}`);
        }
      } catch (err) {
        const msg = String(err);
        console.error('[HeroBrowser] Failed to load roster:', err);
        setError(msg);
        addDebugLog(`Failed to load hero roster: ${msg}`);
      } finally {
        setLoading(false);
      }
    };
    loadRoster();
  }, [addDebugLog]);

  // Load icons lazily after roster is loaded
  useEffect(() => {
    if (heroes.length === 0) return;

    const loadIcons = async () => {
      const uncachedHeroes = heroes.filter(h => !iconLoadedGlobal.has(h.hero_id));
      if (uncachedHeroes.length === 0) return;

      setLoadingIcons(true);
      try {
        addDebugLog(`Extracting ${uncachedHeroes.length} hero icons...`);
        await tauri.batchExtractHeroIcons(uncachedHeroes.map(h => h.hero_id));
      } catch (err) {
        console.error('[HeroBrowser] Batch extraction failed:', err);
      }

      const fetchPromises = uncachedHeroes.map(async (hero) => {
        try {
          const dataUrl = await tauri.getHeroIconDataUrl(hero.hero_id);
          if (dataUrl) {
            iconDataUrlCache[hero.hero_id] = dataUrl;
            iconLoadedGlobal.add(hero.hero_id);
            setIconDataUrls(prev => ({ ...prev, [hero.hero_id]: dataUrl }));
          }
        } catch (err) {
          console.debug(`[HeroBrowser] Icon data URL failed for ${hero.hero_id}:`, err);
        }
      });

      await Promise.all(fetchPromises);
      setLoadingIcons(false);
    };

    loadIcons();
  }, [heroes]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHeroes([]);
    setIconDataUrls({});
    setLoadingIcons(false);
    // Clear global cache on explicit refresh
    Object.keys(iconDataUrlCache).forEach(k => delete iconDataUrlCache[k]);
    iconLoadedGlobal.clear();
    try {
      addDebugLog('Refreshing hero roster (force)...');
      const result = await tauri.getHeroRoster(true);
      if (result.error) {
        setError(result.error);
      } else {
        setHeroes(result.heroes);
        addDebugLog(`Refreshed: ${result.heroes.length} heroes`);
      }
    } catch (err) {
      setError(String(err));
      addDebugLog(`Refresh failed: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [addDebugLog]);

  const handleLoadVfx = useCallback(async () => {
    if (!selectedHeroId) return;
    const hero = heroes.find(h => h.hero_id === selectedHeroId);
    if (!hero) return;

    setLoadingVfx(true);
    if (koMode) {
      addDebugLog(`Loading KO Prompt WBP for ${hero.display_name} (${hero.hero_id})...`);
    } else {
      addDebugLog(`Loading VFX materials for ${hero.display_name} (${hero.hero_id})...`);
    }
    console.debug('[HeroBrowser] Loading assets for hero:', selectedHeroId, 'koMode:', koMode);

    try {
      onSelectHero(hero.hero_id, hero.display_name, koMode);
    } catch (err) {
      addDebugLog(`Failed to load hero assets: ${err}`);
      console.error('[HeroBrowser] Asset load error:', err);
    } finally {
      setLoadingVfx(false);
    }
  }, [selectedHeroId, heroes, onSelectHero, addDebugLog, koMode]);

  const addToBatchQueue = (hero: HeroEntry) => {
    const existingCount = batchQueue.filter(s => s.heroId === hero.hero_id).length;
    const label = existingCount > 0 ? `${hero.display_name} (Variant ${existingCount + 1})` : hero.display_name;
    setBatchQueue(prev => [
      ...prev,
      {
        slotId: `${hero.hero_id}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        heroId: hero.hero_id,
        heroName: hero.display_name,
        customLabel: label,
      },
    ]);
  };

  const removeFromBatchQueue = (slotId: string) => {
    setBatchQueue(prev => prev.filter(s => s.slotId !== slotId));
  };

  const handleBatchLoad = () => {
    if (batchQueue.length === 0) return;
    if (onBatchLoadHeroes) {
      onBatchLoadHeroes(batchQueue, koMode);
      onClose();
    }
  };

  const filteredHeroes = heroes.filter(h => {
    const term = searchTerm.toLowerCase();
    return h.display_name.toLowerCase().includes(term) || h.hero_id.includes(term);
  });

  // Generate a consistent color from hero ID for placeholder
  const getHeroColor = (heroId: string): string => {
    const num = parseInt(heroId, 10) || 0;
    const hue = (num * 137) % 360;
    return `hsl(${hue}, 60%, 35%)`;
  };

  const getInitials = (name: string): string => {
    return name
      .split(/\s+/)
      .map(w => w[0]?.toUpperCase() || '')
      .join('')
      .slice(0, 2);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 hero-browser-modal" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
      <div className="w-full h-full max-h-[95vh] flex flex-col shadow-xl border-2 relative" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-2)' }}>

        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b" style={{ borderColor: 'var(--bg-2)' }}>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Hero VFX Browser</h2>
            <span className="text-sm px-2 py-0.5" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-4)' }}>
              {heroes.length} heroes
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh roster from game files"
              className="p-2 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-2)' }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 transform hover:scale-125 transition-transform duration-200" style={{ color: 'var(--text-2)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Search bar & Mode Controls */}
        <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: 'var(--bg-2)' }}>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <input
              type="text"
              placeholder="Search heroes by name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 w-full px-4 py-2 rounded-none focus:outline-none focus:ring-2 text-sm"
              style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)', color: 'var(--text-2)' }}
              autoFocus
            />

            <div className="flex gap-2">
              {/* Mode Toggle: Single vs Batch */}
              <div className="flex rounded-none p-1 gap-1" style={{ backgroundColor: 'var(--bg-1)' }}>
                <button
                  type="button"
                  onClick={() => setIsBatchMode(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-none transition-all duration-200"
                  style={{
                    backgroundColor: !isBatchMode ? 'var(--accent-main)' : 'transparent',
                    color: !isBatchMode ? 'var(--bg-4)' : 'var(--text-3)',
                  }}
                >
                  Single Hero
                </button>
                <button
                  type="button"
                  onClick={() => setIsBatchMode(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-none transition-all duration-200 flex items-center gap-1"
                  style={{
                    backgroundColor: isBatchMode ? 'var(--accent-main)' : 'transparent',
                    color: isBatchMode ? 'var(--bg-4)' : 'var(--text-3)',
                  }}
                >
                  <span>Batch Queue</span>
                  {batchQueue.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black text-white">
                      {batchQueue.length}
                    </span>
                  )}
                </button>
              </div>

              {/* Asset Type Toggle */}
              <div className="flex rounded-none p-1 gap-1" style={{ backgroundColor: 'var(--bg-1)' }}>
                <button
                  onClick={() => setKoMode(false)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-none transition-all duration-200"
                  style={{
                    backgroundColor: !koMode ? 'var(--accent-main)' : 'transparent',
                    color: !koMode ? 'var(--bg-4)' : 'var(--text-3)',
                  }}
                >
                  VFX Materials
                </button>
                <button
                  onClick={() => setKoMode(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-none transition-all duration-200"
                  style={{
                    backgroundColor: koMode ? 'var(--accent-main)' : 'transparent',
                    color: koMode ? 'var(--bg-4)' : 'var(--text-3)',
                  }}
                >
                  KO Prompt (WBP)
                </button>
              </div>
            </div>
          </div>

          {/* Batch Queue Tray (visible when in Batch Mode) */}
          {isBatchMode && (
            <div className="p-3 border space-y-2" style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)' }}>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent-main)]">
                  Queued Heroes & Variants ({batchQueue.length} slots)
                </span>
                {batchQueue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setBatchQueue([])}
                    className="text-xs opacity-60 hover:opacity-100 hover:text-red-400"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {batchQueue.length === 0 ? (
                <p className="text-xs text-center py-2" style={{ color: 'var(--text-4)' }}>
                  Queue is empty. Click any hero card below to add them to the batch editor!
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {batchQueue.map((slot, idx) => (
                    <div
                      key={slot.slotId}
                      className="flex items-center gap-1.5 px-2 py-1 border text-xs"
                      style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--accent-main)' }}
                    >
                      <span className="font-mono text-[10px] opacity-50">#{idx + 1}</span>
                      <input
                        type="text"
                        value={slot.customLabel}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBatchQueue(prev => prev.map(s => s.slotId === slot.slotId ? { ...s, customLabel: val } : s));
                        }}
                        className="bg-transparent border-b border-gray-600 focus:border-[var(--accent-main)] outline-none text-xs font-medium w-36"
                        style={{ color: 'var(--text-1)' }}
                        title="Edit slot label / mod name"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const hero = heroes.find(h => h.hero_id === slot.heroId);
                          if (hero) addToBatchQueue(hero);
                        }}
                        title="Add duplicate variant slot for this hero"
                        className="px-1 text-[10px] border opacity-70 hover:opacity-100"
                        style={{ backgroundColor: 'var(--bg-1)', borderColor: 'var(--bg-1)' }}
                      >
                        +Var
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromBatchQueue(slot.slotId)}
                        title="Remove slot"
                        className="text-red-400 hover:text-red-300 font-bold ml-1"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {loadingIcons && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--accent-main)' }}>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="10" /></svg>
              <span>Extracting and loading hero icons from game assets...</span>
            </div>
          )}
        </div>

        {/* Hero Grid */}
        <div className="flex-1 overflow-y-auto p-4" style={{ minHeight: 0 }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mb-4" style={{ borderColor: 'var(--accent-main)', borderTopColor: 'transparent' }}></div>
              <p className="text-sm" style={{ color: 'var(--text-4)' }}>Loading hero roster from game files...</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>This may take a moment on first load</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4" style={{ color: 'var(--accent-warning, #f59e0b)' }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-sm text-center max-w-md" style={{ color: 'var(--text-3)' }}>{error}</p>
              <button
                onClick={handleRefresh}
                className="mt-4 px-4 py-2 text-sm font-medium rounded-none"
                style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
              >
                Retry
              </button>
            </div>
          ) : filteredHeroes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-sm" style={{ color: 'var(--text-4)' }}>
                {searchTerm ? 'No heroes match your search.' : 'No heroes found.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-2 auto-rows-min">
              {filteredHeroes.map((hero) => {
                const isSingleSelected = selectedHeroId === hero.hero_id;
                const queuedCount = batchQueue.filter(s => s.heroId === hero.hero_id).length;
                const isSelected = isBatchMode ? queuedCount > 0 : isSingleSelected;
                const iconDataUrl = iconDataUrls[hero.hero_id];

                return (
                  <button
                    key={hero.hero_id}
                    onClick={() => {
                      if (isBatchMode) {
                        addToBatchQueue(hero);
                      } else {
                        setSelectedHeroId(isSingleSelected ? null : hero.hero_id);
                      }
                    }}
                    onDoubleClick={() => {
                      if (isBatchMode) {
                        addToBatchQueue(hero);
                      } else {
                        setSelectedHeroId(hero.hero_id);
                        handleLoadVfx();
                      }
                    }}
                    className="flex flex-col items-center p-1 transition-all duration-150 border-2 group text-xs relative"
                    style={{
                      backgroundColor: isSelected ? 'var(--bg-1)' : 'var(--bg-2)',
                      borderColor: isSelected ? 'var(--accent-main)' : 'transparent',
                    }}
                  >
                    {/* Badge for Batch count */}
                    {isBatchMode && queuedCount > 0 && (
                      <div
                        className="absolute top-1 right-1 z-30 px-1.5 py-0.5 text-[10px] font-bold rounded-full shadow"
                        style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
                      >
                        {queuedCount}
                      </div>
                    )}

                    {/* Icon / Placeholder */}
                    <div
                      className="w-full aspect-square mb-1 flex items-center justify-center overflow-hidden relative"
                      style={{ backgroundColor: iconDataUrl ? undefined : getHeroColor(hero.hero_id) }}
                    >
                      {iconDataUrl ? (
                        <>
                          {/* Blurred bg layer */}
                          <img
                            src={iconDataUrl}
                            alt=""
                            aria-hidden
                            className="absolute inset-0 w-full h-full object-cover"
                            style={{ filter: 'blur(32px) brightness(0.8) saturate(4)', transform: 'scale(2.5)' }}
                          />
                          {/* Foreground icon */}
                          <img
                            key={iconDataUrl}
                            src={iconDataUrl}
                            alt={hero.display_name}
                            className="w-full h-full object-cover relative z-10"
                          />
                        </>
                      ) : (
                        <>
                          <span className="text-xl font-bold text-white/80">
                            {getInitials(hero.display_name)}
                          </span>
                          {loadingIcons && !iconLoadedGlobal.has(hero.hero_id) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-20">
                              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ color: 'var(--accent-main)' }}><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="10" /></svg>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Name */}
                    <span className="text-xs font-medium text-center leading-tight truncate w-full" style={{ color: 'var(--text-2)' }}>
                      {hero.display_name}
                    </span>

                    {/* ID badge */}
                    <span className="text-[9px] opacity-60 leading-tight" style={{ color: 'var(--text-4)' }}>
                      {hero.hero_id}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t" style={{ borderColor: 'var(--bg-2)' }}>
          <div className="text-sm" style={{ color: 'var(--text-4)' }}>
            {isBatchMode ? (
              <span>
                Batch Queue: <strong style={{ color: 'var(--text-2)' }}>{batchQueue.length} slots</strong>
                {batchQueue.length > 0 && (
                  <span className="ml-1 opacity-60">
                    ({new Set(batchQueue.map(b => b.heroId)).size} distinct heroes)
                  </span>
                )}
              </span>
            ) : selectedHeroId ? (
              <span>
                Selected: <strong style={{ color: 'var(--text-2)' }}>
                  {heroes.find(h => h.hero_id === selectedHeroId)?.display_name}
                </strong>
                <span className="ml-1 opacity-60">({selectedHeroId})</span>
              </span>
            ) : (
              <span>Click a hero to select, double-click to load {koMode ? 'KO Prompt' : 'VFX'}</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-6 py-2 text-sm font-medium rounded-none"
              style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-2)' }}
            >
              Cancel
            </button>
            {isBatchMode ? (
              <button
                onClick={handleBatchLoad}
                disabled={batchQueue.length === 0 || loadingVfx}
                className="px-6 py-2 text-sm font-medium rounded-none disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
              >
                {loadingVfx ? 'Loading...' : `Batch Load (${batchQueue.length} Slots)`}
              </button>
            ) : (
              <button
                onClick={handleLoadVfx}
                disabled={!selectedHeroId || loadingVfx}
                className="px-6 py-2 text-sm font-medium rounded-none disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
              >
                {loadingVfx ? 'Loading...' : koMode ? 'Load KO Prompt' : 'Load VFX Materials'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
