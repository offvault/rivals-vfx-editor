// ===== Color Types =====
export interface RGBA {
  R: number;
  G: number;
  B: number;
  A: number;
}

export interface RGBNormalized {
  r: number;
  g: number;
  b: number;
}

// ===== Color Parameter (core data model) =====
export interface ColorParam {
  id: string;
  fileName: string;
  paramName: string;
  path: (string | number)[];
  rgba: RGBA;
  relativePath: string;
}

// ===== Filter Dictionary =====
export interface FilterDictionary {
  include_keywords: string[];
  exclude_keywords: string[];
  color_property_names: string[];
}

// ===== App Settings =====
export interface AppSettings {
  usmapPath: string | null;
  paksPath: string | null;
  showDetailedErrors: boolean;
  autoClearCache: boolean;
  uiScale: number;
  filterDictionary?: FilterDictionary;
  isHeaderMinimized?: boolean;
  pakReadyStructure?: boolean;
}

// ===== Cache Info =====
export interface CacheInfo {
  fileCount: number;
  totalSizeBytes: number;
}

// ===== Conversion Progress =====
export interface ConversionProgress {
  current: number;
  total: number;
  fileName: string;
}

// ===== Sort Config =====
export type SortDirection = 'ascending' | 'descending' | 'none';

export interface SortConfig {
  key: string | null;
  direction: SortDirection;
}

// ===== UAsset Source Map Entry =====
export interface UassetSourceEntry {
  uassetPath: string;
  jsonPath: string;
}

export type UassetSourceMap = Record<string, UassetSourceEntry>;

// ===== File Object (intermediate during loading) =====
export interface FileObject {
  name: string;
  content: string;
  relativePath: string;
}

// ===== UAsset File reference =====
export interface UassetFileRef {
  name: string;
  relativePath: string;
  fullPath: string;
}

// ===== Batch Conversion Result =====
export interface ConversionResult {
  success: boolean;
  file_name: string;
  uasset_path: string;
  json_path?: string;
  error?: string;
}

export interface BatchConversionResult {
  succeeded: number;
  failed: number;
  total: number;
  cached_count: number;
  results: ConversionResult[];
}

// ===== Hero VFX Browser =====
export interface HeroEntry {
  hero_id: string;
  display_name: string;
  icon_path: string | null;
}

export interface BatchHeroSlot {
  slotId: string;
  heroId: string;
  heroName: string;
  customLabel: string;
  bundleGroup?: string;
}

export interface HeroRosterResult {
  heroes: HeroEntry[];
  cached: boolean;
  error: string | null;
}

export interface HeroVfxResult {
  hero_id: string;
  uasset_paths: string[];
  json_paths: string[];
  cached: boolean;
  error: string | null;
}

// ===== Manual Extraction =====
export interface AssetIndexResult {
  assets: string[];
  cached: boolean;
  container_count: number;
  total_packages: number;
  error: string | null;
}

// ===== Session Data (project file) =====
export interface SessionEntry {
  relativePath: string;
  paramName: string;
  rgba: RGBA;
}

// ===== Recipe-Based .rvfxp Preset (Version 2) =====
export interface RvfxpRecipe {
  mode: 'single' | 'shuffle' | 'procedural' | '12color';
  masterColor: string;
  enemyColor?: string;
  shufflePalette: string[];
  preserveIntensity: boolean;
  ignoreGrayscale: boolean;
  proceduralJitter: number;
  brightnessMultiplier: number;
  opacityValue: number;
  hueShift: number;
}

export interface RvfxpSlot {
  slotId: string;
  heroId: string;
  heroName: string;
  customLabel: string;
  targetSubpaths?: string[];
}

export interface RvfxpPresetV2 {
  version: 2;
  generator: 'RivalsVFXEditor';
  timestamp: string;
  recipe: RvfxpRecipe;
  slots: RvfxpSlot[];
  savedParameters: SessionEntry[];
}

// ===== 1-Click Direct Mod Packaging Options =====
export interface PackagingOptions {
  targetFormat: 'iostore' | 'raw_uassets';
  compress: boolean;
  createZip: boolean;
  bundleName?: string;
}

export interface ModPackageResult {
  success: boolean;
  modName: string;
  utocPath?: string;
  ucasPath?: string;
  pakPath?: string;
  zipPath?: string;
  rawDir?: string;
  message?: string;
}

// ===== Usmap Management =====
export interface UsmapStatus {
  installed: boolean;
  file_name: string | null;
  file_path: string | null;
  needs_update: boolean;
  latest_remote: string | null;
  auto_managed: boolean;
}
