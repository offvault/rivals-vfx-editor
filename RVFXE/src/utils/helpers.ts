/**
 * Dive into a nested object and set a value at the given path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setNestedValue(obj: any, path: (string | number)[], value: unknown): void {
  let schema = obj;
  for (let i = 0; i < path.length - 1; i++) {
    schema = schema[path[i]];
  }
  schema[path[path.length - 1]] = value;
}

/**
 * Extract just the filename from a path string (handles both / and \\).
 */
export function getFileName(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1];
}

/**
 * Normalize a file path for comparison: forward slashes, strip .json/.uasset, lowercase.
 */
export function normalizePath(path: string): string {
  if (!path) return '';
  return path
    .replace(/\\/g, '/')
    .replace(/\.json$/i, '')
    .replace(/\.uasset$/i, '')
    .toLowerCase();
}

/**
 * Check if two paths match via suffix (one ends with the other).
 */
export function pathsMatchSuffix(path1: string, path2: string): boolean {
  if (!path1 || !path2) return false;
  return path1.endsWith(path2) || path2.endsWith(path1);
}

/**
 * Universal dynamic path resolver for all game assets.
 * Guarantees proper pak-ready hierarchy under `<ModFolderName>/Marvel/Content/...`
 * without prepending extra Characters/ directories or mangling Common/UI/Environment paths.
 */
export function getPakReadyRelativePath(filePath: string, modFolderName: string): string {
  const cleanMod = modFolderName.replace(/[\\/]/g, '_').trim();
  const normalized = filePath.replace(/\\/g, '/');

  // 1. Direct Content match (e.g. Marvel/Content/..., /Game/Content/...)
  const contentMatch = normalized.match(/(?:Marvel\/Content\/|Content\/)(.+)$/i);
  let subPath: string;
  if (contentMatch && contentMatch[1]) {
    subPath = contentMatch[1];
  } else if (/^\d{4}\//.test(normalized)) {
    // 2. Begins with 4-digit Hero ID (e.g. 1066/Materials/... or 1066/WBP_...)
    if (/WBP_|Custom|UI\//i.test(normalized)) {
      subPath = `Marvel/UI/Blueprints/Battle/Custom/${normalized}`;
    } else {
      subPath = `Marvel/VFX/Materials/Characters/${normalized}`;
    }
  } else {
    // 3. Anchored on Characters, Common, Environment, VFX, UI, or PostProcess
    const anchorMatch = normalized.match(/(?:Marvel[\\/])?(?:VFX[\\/]|Materials[\\/])?(?:Characters|Common|Environment|VFX|UI|PostProcess)[\\/].*$/i);
    if (anchorMatch) {
      let matched = anchorMatch[0].replace(/\\/g, '/');
      if (matched.startsWith('Characters/')) {
        matched = `Marvel/VFX/Materials/${matched}`;
      } else if (matched.startsWith('Common/')) {
        matched = `Marvel/VFX/Materials/Common/${matched.slice('Common/'.length)}`;
      } else if (matched.startsWith('VFX/') || matched.startsWith('UI/') || matched.startsWith('Environment/') || matched.startsWith('PostProcess/')) {
        matched = `Marvel/${matched}`;
      }
      subPath = matched;
    } else {
      subPath = normalized.replace(/^.*?(?:Characters|Common|Environment|VFX|UI)[\\/]/i, (match) => match.trim());
    }
  }

  // Ensure clean format
  subPath = subPath.replace(/^\/+/, '').replace(/\.json$/i, '.uasset');
  if (!subPath.toLowerCase().startsWith('marvel/')) {
    subPath = `Marvel/${subPath}`;
  }
  return `${cleanMod}/Marvel/Content/${subPath}`;
}

const PRESERVED_ACRONYMS = new Set(['RGB', 'BR', 'PRP', 'VFX', 'KO', 'FX', 'UI', 'HUD', 'DX', 'HD', 'MVP', 'FPS']);

/**
 * Convert raw hero name strings (e.g. "THE HOOD", "IRON FIST", "GORR THE GOD BUTCHER")
 * into clean PascalCase identifiers (e.g. "TheHood", "IronFist", "GorrTheGodButcher").
 * Preserves recognized uppercase acronyms (e.g. RGB, BR, PRP, VFX).
 */
export function toPascalCaseHeroName(rawName: string): string {
  if (!rawName) return 'Hero';
  const words = rawName
    .replace(/[^\w\s-]/g, '')
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length === 0) return 'Hero';
  return words
    .map(w => {
      const upper = w.toUpperCase();
      if (PRESERVED_ACRONYMS.has(upper)) {
        return upper;
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join('');
}

/**
 * Safely format or normalize a slot's custom label without mangling user-defined mixed casing
 * or crushing acronyms like RGB, BR, PRP, VFX into TitleCase.
 */
export function formatCustomLabel(label: string | undefined | null, heroNameFallback?: string): string {
  if (!label || !label.trim()) {
    return `${toPascalCaseHeroName(heroNameFallback || 'Hero')}_VFX`;
  }

  const trimmed = label.trim();

  // If the user already typed a mixed-case string (e.g. "IronfistRGB", "TheHoodBR", "SquirrelGirlPRP"),
  // preserve their exact casing!
  const hasLower = /[a-z]/.test(trimmed);
  const hasUpper = /[A-Z]/.test(trimmed);
  if (hasLower && hasUpper && !trimmed.includes('_')) {
    return trimmed;
  }

  // If already mixed case with underscores (e.g. "TheHood_BR_VFX" or "IronFist_Red_VFX"), preserve it
  if (hasLower && hasUpper) {
    return trimmed;
  }

  // If legacy screaming ALL_CAPS (e.g. "THE_HOOD_BRVFX" or "IRON_FIST_REDVFX"):
  // Split tokens by underscore or hyphen
  const tokens = trimmed.split(/[\s_-]+/).filter(Boolean);
  const formattedTokens = tokens.map(t => {
    const upper = t.toUpperCase();
    // Check if token ends with VFX (e.g. "BRVFX" -> "BR_VFX", "REDVFX" -> "Red_VFX")
    if (upper.endsWith('VFX') && upper.length > 3) {
      const prefix = upper.slice(0, -3);
      const formattedPrefix = PRESERVED_ACRONYMS.has(prefix)
        ? prefix
        : prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
      return `${formattedPrefix}_VFX`;
    }
    if (PRESERVED_ACRONYMS.has(upper)) {
      return upper;
    }
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  });

  return formattedTokens.join('_').replace(/_+/g, '_');
}

