/**
 * Tauri API wrappers with typed interfaces.
 * Centralizes all Tauri interop in one place.
 */
import type {
  AppSettings,
  BatchConversionResult,
  FilterDictionary,
  HeroRosterResult,
  HeroVfxResult,
  AssetIndexResult,
  UsmapStatus,
} from '@/types';

// ===== Core Tauri APIs =====
const { invoke } = (window as any).__TAURI__.core;
const { listen } = (window as any).__TAURI__.event;
const { open: openDialog, save: saveDialog } = (window as any).__TAURI__.dialog;
const { readDir, readTextFile, writeTextFile, stat } = (window as any).__TAURI__.fs;

// Re-export listen for event subscriptions
export { listen, openDialog, saveDialog, readDir, readTextFile, writeTextFile, stat };

// ===== Typed invoke wrappers =====

export async function getSettings(): Promise<AppSettings> {
  console.debug('[tauri] Loading settings...');
  return invoke('get_settings');
}

export async function setUsmapPath(path: string): Promise<void> {
  console.debug('[tauri] Setting usmap path:', path);
  return invoke('set_usmap_path', { path });
}

export async function setFilterDictionary(dictionary: FilterDictionary): Promise<void> {
  console.debug('[tauri] Saving filter dictionary');
  return invoke('set_filter_dictionary', { dictionary });
}

export async function setAutoClearCache(enabled: boolean): Promise<void> {
  console.debug('[tauri] Setting auto clear cache:', enabled);
  return invoke('set_auto_clear_cache', { enabled });
}

export async function setUiScale(scale: number): Promise<void> {
  console.debug('[tauri] Setting UI scale:', scale);
  return invoke('set_ui_scale', { scale });
}

export async function setHeaderMinimized(isMinimized: boolean): Promise<void> {
  console.debug('[tauri] Setting header minimized:', isMinimized);
  return invoke('set_header_minimized', { isMinimized });
}

export async function setPakReadyStructure(enabled: boolean): Promise<void> {
  console.debug('[tauri] Setting pak ready structure:', enabled);
  return invoke('set_pak_ready_structure', { enabled });
}

export async function applyWebviewUiScale(scale: number): Promise<void> {
  const tauriGlobal = (window as any).__TAURI__;
  const webviewApi = tauriGlobal?.webviewWindow;
  const currentWebview = webviewApi?.getCurrentWebviewWindow?.();

  if (currentWebview?.setZoom) {
    console.debug('[tauri] Applying UI scale via setZoom:', scale);
    await currentWebview.setZoom(scale);
    return;
  }

  if (currentWebview?.setZoomFactor) {
    console.debug('[tauri] Applying UI scale via setZoomFactor:', scale);
    await currentWebview.setZoomFactor(scale);
    return;
  }

  // Fallback for environments where the webview API is unavailable.
  console.debug('[tauri] Webview zoom API unavailable, applying CSS zoom fallback:', scale);
  document.documentElement.style.zoom = `${scale}`;
}

export async function getCacheInfo(): Promise<{ file_count: number; total_size_bytes: number }> {
  console.debug('[tauri] Getting cache info...');
  return invoke('get_cache_info');
}

export async function clearCache(): Promise<void> {
  console.debug('[tauri] Clearing cache...');
  return invoke('clear_cache');
}

export async function getHeroBrowserCacheInfo(): Promise<{ file_count: number; total_size_bytes: number }> {
  return invoke('get_hero_browser_cache_info');
}

export async function getVfxCacheInfo(): Promise<{ file_count: number; total_size_bytes: number }> {
  return invoke('get_vfx_cache_info');
}

export async function clearHeroBrowserCache(): Promise<void> {
  return invoke('clear_hero_browser_cache');
}

export async function clearVfxCache(): Promise<void> {
  return invoke('clear_vfx_cache');
}

export async function openCacheFolder(): Promise<void> {
  return invoke('open_cache_folder');
}

export async function openFolder(path: string): Promise<void> {
  console.debug('[tauri] Opening folder:', path);
  return invoke('open_folder', { path });
}

export async function batchConvertUassetsToJson(
  uassetPaths: string[],
  rootPath: string
): Promise<BatchConversionResult> {
  console.debug('[tauri] Batch converting', uassetPaths.length, 'uassets to JSON');
  return invoke('batch_convert_uassets_to_json', { uassetPaths, rootPath });
}

export async function batchConvertJsonsToUassets(
  jsonPaths: string[],
  outputDir: string
): Promise<BatchConversionResult> {
  console.debug('[tauri] Batch converting', jsonPaths.length, 'JSONs to uassets');
  return invoke('batch_convert_jsons_to_uassets', { jsonPaths, outputDir });
}

export async function logUniqueParams(paramNames: string[]): Promise<void> {
  console.debug('[tauri] Logging', paramNames.length, 'unique param names');
  return invoke('log_unique_params', { paramNames });
}

// ===== Hero VFX Browser =====

export async function setPaksPath(path: string): Promise<void> {
  console.debug('[tauri] Setting paks path:', path);
  return invoke('set_paks_path', { path });
}

export async function getHeroRoster(forceRefresh = false): Promise<HeroRosterResult> {
  console.debug('[tauri] Getting hero roster, forceRefresh=', forceRefresh);
  return invoke('get_hero_roster', { forceRefresh });
}

export async function batchExtractHeroIcons(heroIds: string[]): Promise<void> {
  console.debug('[tauri] Batch extracting hero icons for:', heroIds.length, 'heroes');
  return invoke('batch_extract_hero_icons', { heroIds });
}

export async function getHeroIconDataUrl(heroId: string): Promise<string> {
  console.debug('[tauri] Getting hero icon data URL for:', heroId);
  return invoke('get_hero_icon_data_url', { heroId });
}

export async function extractHeroVfx(heroId: string, koMode = false): Promise<HeroVfxResult> {
  console.debug('[tauri] Extracting hero VFX/KO for:', heroId, 'koMode:', koMode);
  return invoke('extract_hero_vfx', { heroId, koMode });
}

// ===== Manual Extraction =====

export async function listGameAssets(forceRefresh = false): Promise<AssetIndexResult> {
  console.debug('[tauri] Listing game assets, forceRefresh=', forceRefresh);
  return invoke('list_game_assets', { forceRefresh });
}

export async function extractManualAssets(assetPaths: string[]): Promise<HeroVfxResult> {
  console.debug('[tauri] Extracting', assetPaths.length, 'manually queued assets');
  return invoke('extract_manual_assets', { assetPaths });
}

export async function getManualCacheInfo(): Promise<{ file_count: number; total_size_bytes: number }> {
  return invoke('get_manual_cache_info');
}

export async function clearManualCache(): Promise<void> {
  return invoke('clear_manual_cache');
}

// ===== Usmap Management =====

export async function checkUsmapStatus(): Promise<UsmapStatus> {
  console.debug('[tauri] Checking usmap status...');
  return invoke('check_usmap_status');
}

export async function scanDirectoryForUassets(directory: string): Promise<string[]> {
  console.debug('[tauri] Scanning directory for uassets:', directory);
  return invoke('scan_directory_for_uassets', { directory });
}

export async function batchConvertDirectory(directory: string): Promise<HeroVfxResult> {
  console.debug('[tauri] Batch converting directory:', directory);
  return invoke('batch_convert_directory', { directory });
}

export async function batchConvertFiles(uassetPaths: string[], basePath: string): Promise<HeroVfxResult> {
  console.debug('[tauri] Batch converting', uassetPaths.length, 'files');
  return invoke('batch_convert_files', { uassetPaths, basePath });
}

export async function fetchLatestUsmap(): Promise<UsmapStatus> {
  console.debug('[tauri] Fetching latest usmap...');
  return invoke('fetch_latest_usmap');
}

export interface UpdateVfxModResult {
  success: boolean;
  message: string;
  output_path?: string;
}

export async function updateVfxMod(modPath: string, usmapPath: string | null, outputDir: string): Promise<UpdateVfxModResult> {
  console.debug('[tauri] Updating mod:', modPath, 'with usmap:', usmapPath, 'output:', outputDir);
  return invoke('update_vfx_mod', { modPath, usmapPath, outputDir });
}
