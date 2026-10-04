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
