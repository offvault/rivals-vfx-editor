import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as tauri from '@/services/tauri';

// Module-level cache so the index survives leaving and re-entering the page.
let assetIndexCache: string[] | null = null;

const MAX_SEARCH_RESULTS = 1000;
const ROW_HEIGHT = 28;
const BUFFER_ROWS = 12;

// Row banding and hover live in css/style.css: the vendored tailwind build has
// no slash-opacity utilities, so `bg-white/5` and the like resolve to nothing.
const ROW_CLASS = 'mx-row';
const STRIPE_CLASS = 'mx-row-striped';

interface ManualExtractionPageProps {
  onClose: () => void;
  onExtract: (assetPaths: string[]) => void;
  addDebugLog: (msg: string) => void;
}

/** A folder in the browsable tree. Leaves live in `files`, subfolders in `dirs`. */
interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: { name: string; path: string }[];
  /** Total material instances at or below this node, for the folder checkbox and count. */
  fileCount: number;
}

function makeNode(name: string, path: string): TreeNode {
  return { name, path, dirs: new Map(), files: [], fileCount: 0 };
}

/**
 * Build the folder tree from the flat, sorted path list.
 * The index is ~130k entries, so this runs once per index load and is memoized.
 */
function buildTree(paths: string[]): TreeNode {
  const root = makeNode('', '');

  for (const path of paths) {
    const segments = path.split('/');
    const fileName = segments.pop();
    if (!fileName) continue;

    let node = root;
    node.fileCount++;
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let child = node.dirs.get(segment);
      if (!child) {
        child = makeNode(segment, prefix);
        node.dirs.set(segment, child);
      }
      child.fileCount++;
      node = child;
    }
    node.files.push({ name: fileName, path });
  }

  return root;
}

/** Collect every material instance at or below a folder. */
function collectFiles(node: TreeNode, out: string[]): string[] {
  for (const file of node.files) out.push(file.path);
  for (const dir of node.dirs.values()) collectFiles(dir, out);
  return out;
}

function findNode(root: TreeNode, path: string): TreeNode | null {
  if (!path) return root;
  let node: TreeNode | null = root;
  for (const segment of path.split('/')) {
    node = node?.dirs.get(segment) ?? null;
    if (!node) return null;
  }
  return node;
}

/** Strip the `<Root>/Content/` prefix so rows read as in-game paths. */
function displayPath(path: string): string {
  const idx = path.indexOf('/Content/');
  return idx >= 0 ? path.slice(idx + '/Content/'.length) : path;
}

/** Flat row descriptor for high-scale list virtualization. */
type FlatRow =
  | { type: 'dir'; node: TreeNode; depth: number; path: string }
  | { type: 'file'; name: string; path: string; depth: number };

function flattenTree(tree: TreeNode, expanded: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  function walkDir(dir: TreeNode, depth: number) {
    rows.push({ type: 'dir', node: dir, depth, path: dir.path });
    if (expanded.has(dir.path)) {
      for (const childDir of dir.dirs.values()) {
        walkDir(childDir, depth + 1);
      }
      for (const file of dir.files) {
        rows.push({ type: 'file', name: file.name, path: file.path, depth: depth + 1 });
      }
    }
  }
  for (const rootDir of tree.dirs.values()) {
    walkDir(rootDir, 0);
  }
  return rows;
}

/** Queue checkbox shared by folder and file rows. */
function QueueCheckbox({ checked, indeterminate = false }: { checked: boolean; indeterminate?: boolean }) {
  const active = checked || indeterminate;
  return (
    <span
      className="w-3.5 h-3.5 flex-shrink-0 border flex items-center justify-center"
      style={{
        borderColor: active ? 'var(--accent-main)' : 'var(--text-4)',
        backgroundColor: checked ? 'var(--accent-main)' : 'transparent',
      }}
    >
      {checked && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg-4)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {indeterminate && !checked && (
        <span className="w-1.5 h-0.5" style={{ backgroundColor: 'var(--accent-main)' }} />
      )}
    </span>
  );
}

export function ManualExtractionPage({ onClose, onExtract, addDebugLog }: ManualExtractionPageProps) {
  const [assets, setAssets] = useState<string[]>(assetIndexCache ?? []);
  const [loading, setLoading] = useState(assetIndexCache === null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard navigation & Escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const loadIndex = useCallback(async (forceRefresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      addDebugLog(forceRefresh ? 'Rebuilding game asset index...' : 'Loading game asset index...');
      const result = await tauri.listGameAssets(forceRefresh);
      assetIndexCache = result.assets;
      setAssets(result.assets);
      addDebugLog(
        `Asset index ready: ${result.assets.length} material instances${result.cached ? ' (cached)' : ` from ${result.container_count} containers`}`
      );
      if (result.error) addDebugLog(`Asset index warning: ${result.error}`);
    } catch (err) {
      const msg = String(err);
      console.error('[ManualExtraction] Failed to load asset index:', err);
      setError(msg);
      addDebugLog(`Failed to load asset index: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [addDebugLog]);

  useEffect(() => {
    if (assetIndexCache === null) loadIndex(false);
  }, [loadIndex]);

  // Debounce search
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchTerm.trim().toLowerCase()), 200);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  const tree = useMemo(() => buildTree(assets), [assets]);

  // Expand root level by default
  useEffect(() => {
    const roots = Array.from(tree.dirs.keys());
    if (roots.length > 0) setExpanded(new Set(roots));
  }, [tree]);

  const queueSet = useMemo(() => new Set(queue), [queue]);

  // Queued descendants per folder
  const queuedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of queue) {
      const segments = path.split('/');
      segments.pop();
      let prefix = '';
      for (const segment of segments) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
    }
    return counts;
  }, [queue]);

  const searchResults = useMemo(() => {
    if (!debouncedSearch) return null;
    const matches: string[] = [];
    for (const path of assets) {
      if (path.toLowerCase().includes(debouncedSearch)) {
        matches.push(path);
        if (matches.length > MAX_SEARCH_RESULTS) break;
      }
    }
    return matches;
  }, [assets, debouncedSearch]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const toggleFile = useCallback((path: string) => {
    setQueue(prev => (prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]));
  }, []);

  const addFolder = useCallback((folderPath: string) => {
    const node = findNode(tree, folderPath);
    if (!node) return;
    const paths = collectFiles(node, []);
    setQueue(prev => {
      const seen = new Set(prev);
      return [...prev, ...paths.filter(p => !seen.has(p))];
    });
    addDebugLog(`Queued ${paths.length} material instances from ${displayPath(folderPath)}`);
  }, [tree, addDebugLog]);

  const removeFolder = useCallback((folderPath: string) => {
    const node = findNode(tree, folderPath);
    if (!node) return;
    const paths = new Set(collectFiles(node, []));
    setQueue(prev => prev.filter(p => !paths.has(p)));
  }, [tree]);

  const toggleFolder = useCallback((node: TreeNode) => {
    const queued = queuedCounts.get(node.path) ?? 0;
    if (queued >= node.fileCount) removeFolder(node.path);
    else addFolder(node.path);
  }, [queuedCounts, addFolder, removeFolder]);

  const addAllSearchResults = useCallback(() => {
    if (!searchResults) return;
    setQueue(prev => {
      const seen = new Set(prev);
      return [...prev, ...searchResults.filter(p => !seen.has(p))];
    });
    addDebugLog(`Queued ${searchResults.length} search results`);
  }, [searchResults, addDebugLog]);

  const handleExtract = useCallback(() => {
    if (queue.length === 0) return;
    onExtract(queue);
  }, [queue, onExtract]);

  // ===================== TREE VIRTUALIZATION =====================
  const flatRows = useMemo(() => {
    return flattenTree(tree, expanded);
  }, [tree, expanded]);

  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(600);

  useEffect(() => {
    const el = treeContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      if (el.clientHeight > 0) setTreeViewportHeight(el.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const treeTotalRows = flatRows.length;
  const treeTotalHeight = treeTotalRows * ROW_HEIGHT;
  const treeStartIndex = Math.max(0, Math.floor(treeScrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const treeEndIndex = Math.min(treeTotalRows, Math.ceil((treeScrollTop + treeViewportHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const visibleTreeRows = useMemo(() => {
    return flatRows.slice(treeStartIndex, treeEndIndex);
  }, [flatRows, treeStartIndex, treeEndIndex]);
  const treeOffsetY = treeStartIndex * ROW_HEIGHT;

  // ===================== SEARCH VIRTUALIZATION =====================
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [searchScrollTop, setSearchScrollTop] = useState(0);
  const [searchViewportHeight, setSearchViewportHeight] = useState(600);

  useEffect(() => {
    const el = searchContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      if (el.clientHeight > 0) setSearchViewportHeight(el.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [searchResults]);

  const searchTotalRows = searchResults ? Math.min(searchResults.length, MAX_SEARCH_RESULTS) : 0;
  const searchTotalHeight = searchTotalRows * ROW_HEIGHT;
  const searchStartIndex = Math.max(0, Math.floor(searchScrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const searchEndIndex = Math.min(searchTotalRows, Math.ceil((searchScrollTop + searchViewportHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const visibleSearchResults = useMemo(() => {
    if (!searchResults) return [];
    return searchResults.slice(searchStartIndex, searchEndIndex);
  }, [searchResults, searchStartIndex, searchEndIndex]);
  const searchOffsetY = searchStartIndex * ROW_HEIGHT;

  // ===================== QUEUE VIRTUALIZATION =====================
  const queueContainerRef = useRef<HTMLDivElement>(null);
  const [queueScrollTop, setQueueScrollTop] = useState(0);
  const [queueViewportHeight, setQueueViewportHeight] = useState(600);

  useEffect(() => {
    const el = queueContainerRef.current;
    if (!el) return;
    const updateSize = () => {
      if (el.clientHeight > 0) setQueueViewportHeight(el.clientHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const queueTotalRows = queue.length;
  const queueTotalHeight = queueTotalRows * ROW_HEIGHT;
  const queueStartIndex = Math.max(0, Math.floor(queueScrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const queueEndIndex = Math.min(queueTotalRows, Math.ceil((queueScrollTop + queueViewportHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const visibleQueueRows = useMemo(() => {
    return queue.slice(queueStartIndex, queueEndIndex);
  }, [queue, queueStartIndex, queueEndIndex]);
  const queueOffsetY = queueStartIndex * ROW_HEIGHT;

  // ===================== ROW RENDERERS =====================
  const renderFolderRow = (node: TreeNode, depth: number, striped: boolean) => {
    const isOpen = expanded.has(node.path);
    const queuedHere = queuedCounts.get(node.path) ?? 0;
    const allQueued = node.fileCount > 0 && queuedHere >= node.fileCount;

    return (
      <div
        key={node.path || 'root'}
        className={`flex items-center gap-1.5 px-2 cursor-pointer text-sm group/row ${striped ? STRIPE_CLASS : ROW_CLASS}`}
        style={{
          paddingLeft: `${depth * 14 + 8}px`,
          color: 'var(--text-2)',
          height: `${ROW_HEIGHT}px`,
          boxSizing: 'border-box',
        }}
        onClick={() => toggleExpand(node.path)}
      >
        <svg
          className="flex-shrink-0 transition-transform"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span
          onClick={(e) => {
            e.stopPropagation();
            toggleFolder(node);
          }}
          title={
            allQueued
              ? `Remove all ${node.fileCount} material instances in this folder from the queue`
              : `Queue all ${node.fileCount} material instances in this folder`
          }
          className="flex items-center"
        >
          <QueueCheckbox checked={allQueued} indeterminate={queuedHere > 0 && !allQueued} />
        </span>
        <span className="truncate flex-1 font-mono text-xs">{node.name}</span>
        <span className="text-xs flex-shrink-0 font-mono pr-2" style={{ color: 'var(--text-4)' }}>
          {queuedHere > 0 && <span style={{ color: 'var(--accent-main)' }}>{queuedHere}/</span>}
          {node.fileCount}
        </span>
      </div>
    );
  };

  const renderFileRow = (name: string, path: string, depth: number, striped: boolean) => {
    const queued = queueSet.has(path);
    return (
      <div
        key={path}
        onClick={() => toggleFile(path)}
        className={`flex items-center gap-2 px-2 cursor-pointer text-sm ${striped ? STRIPE_CLASS : ROW_CLASS}`}
        style={{
          paddingLeft: `${depth * 14 + 8}px`,
          color: queued ? 'var(--accent-main)' : 'var(--text-3)',
          height: `${ROW_HEIGHT}px`,
          boxSizing: 'border-box',
        }}
        title={displayPath(path)}
      >
        <QueueCheckbox checked={queued} />
        <span className="truncate font-mono text-xs">{name.replace(/\.uasset$/, '')}</span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 border-2" style={{ backgroundColor: 'var(--bg-3)', borderColor: 'var(--bg-2)' }}>
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b flex-shrink-0" style={{ borderColor: 'var(--bg-2)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold hover:bg-white/10 transition-colors border shadow-sm"
            style={{ backgroundColor: 'var(--bg-2)', borderColor: 'var(--bg-1)', color: 'var(--text-1)' }}
            title="Return to VFX Editor (Escape)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            ← Back to Editor
          </button>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Manual Extraction</h2>
          <span className="text-sm px-2 py-0.5" style={{ backgroundColor: 'var(--bg-1)', color: 'var(--text-4)' }}>
            {assets.length.toLocaleString()} material instances
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadIndex(true)}
            disabled={loading}
            title="Rebuild the index from the game containers"
            className="p-2 rounded hover:bg-white/10 transition-colors disabled:opacity-50"
            style={{ color: 'var(--text-2)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
          <button
            onClick={onClose}
            title="Close (Escape)"
            className="p-1 rounded hover:bg-white/10 transform hover:scale-125 transition-transform duration-200"
            style={{ color: 'var(--text-2)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full mb-4" style={{ borderColor: 'var(--accent-main)', borderTopColor: 'transparent' }}></div>
          <p className="text-sm" style={{ color: 'var(--text-4)' }}>Indexing game containers...</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-4)' }}>First run reads the asset type of every package and takes about half a minute; afterwards cached index is instant.</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-center" style={{ color: 'var(--accent-warning, #f59e0b)' }}>{error}</p>
          <button
            onClick={() => loadIndex(true)}
            className="px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--accent-main)', color: 'var(--bg-4)' }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Browser */}
          <div className="flex-1 flex flex-col min-h-0 border-r" style={{ borderColor: 'var(--bg-2)' }}>
            <div className="p-3 border-b flex items-center gap-2 flex-shrink-0" style={{ borderColor: 'var(--bg-2)' }}>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search asset paths..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-3 py-2 rounded-none focus:outline-none focus:ring-2 text-sm"
                style={{ backgroundColor: 'var(--bg-2)', color: 'var(--text-2)' }}
                autoFocus
              />
              {searchResults && searchResults.length > 0 && (
                <button
                  onClick={addAllSearchResults}
                  className="px-3 py-2 text-xs font-semibold whitespace-nowrap"
                  style={{ backgroundColor: 'var(--bg-1)', color: 'var(--accent-main)' }}
                >
                  Queue all ({Math.min(searchResults.length, MAX_SEARCH_RESULTS)}) results
                </button>
              )}
            </div>

            {searchResults ? (
              searchResults.length === 0 ? (
                <div className="p-4 text-sm" style={{ color: 'var(--text-4)' }}>No material instances match that search.</div>
              ) : (
                <div
                  ref={searchContainerRef}
                  onScroll={(e) => setSearchScrollTop(e.currentTarget.scrollTop)}
                  className="flex-1 overflow-auto"
                  style={{ minHeight: 0 }}
                >
                  <div style={{ height: searchTotalHeight, position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${searchOffsetY}px)` }}>
                      {visibleSearchResults.map((path, idx) => {
                        const actualIdx = searchStartIndex + idx;
                        const name = path.split('/').pop() || path;
                        const queued = queueSet.has(path);
                        const striped = actualIdx % 2 === 1;
                        return (
                          <div
                            key={path}
                            onClick={() => toggleFile(path)}
                            className={`flex items-center gap-2 px-3 cursor-pointer text-sm ${striped ? STRIPE_CLASS : ROW_CLASS}`}
                            style={{
                              color: queued ? 'var(--accent-main)' : 'var(--text-3)',
                              height: `${ROW_HEIGHT}px`,
                              boxSizing: 'border-box',
                            }}
                          >
                            <QueueCheckbox checked={queued} />
                            <span className="truncate font-medium font-mono text-xs">{name.replace(/\.uasset$/, '')}</span>
                            <span className="truncate text-xs ml-auto pl-3 font-mono" style={{ color: 'var(--text-4)' }}>{displayPath(path)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div
                ref={treeContainerRef}
                onScroll={(e) => setTreeScrollTop(e.currentTarget.scrollTop)}
                className="flex-1 overflow-auto"
                style={{ minHeight: 0 }}
              >
                <div style={{ height: treeTotalHeight, position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${treeOffsetY}px)` }}>
                    {visibleTreeRows.map((item, idx) => {
                      const actualIdx = treeStartIndex + idx;
                      const striped = actualIdx % 2 === 1;
                      if (item.type === 'dir') {
                        return renderFolderRow(item.node, item.depth, striped);
                      } else {
                        return renderFileRow(item.name, item.path, item.depth, striped);
                      }
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Queue Sidebar */}
          <div className="flex flex-col min-h-0 flex-shrink-0" style={{ width: 380 }}>
            <div className="p-3 border-b flex items-center justify-between flex-shrink-0" style={{ borderColor: 'var(--bg-2)' }}>
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-2)' }}>
                Extraction Queue <span style={{ color: 'var(--accent-main)' }}>({queue.length.toLocaleString()})</span>
              </h3>
              {queue.length > 0 && (
                <button onClick={() => setQueue([])} className="text-xs font-semibold hover:underline" style={{ color: 'var(--text-4)' }}>
                  Clear
                </button>
              )}
            </div>

            {queue.length === 0 ? (
              <div className="flex-1 p-4 text-sm" style={{ color: 'var(--text-4)' }}>
                Nothing queued yet. Click a material instance to add it, or tick a folder to queue everything inside it.
              </div>
            ) : (
              <div
                ref={queueContainerRef}
                onScroll={(e) => setQueueScrollTop(e.currentTarget.scrollTop)}
                className="flex-1 overflow-auto"
                style={{ minHeight: 0 }}
              >
                <div style={{ height: queueTotalHeight, position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${queueOffsetY}px)` }}>
                    {visibleQueueRows.map((path, idx) => {
                      const actualIdx = queueStartIndex + idx;
                      const striped = actualIdx % 2 === 1;
                      return (
                        <div
                          key={path}
                          className={`flex items-center gap-2 px-3 text-sm group/queue ${striped ? STRIPE_CLASS : ROW_CLASS}`}
                          style={{
                            color: 'var(--text-3)',
                            height: `${ROW_HEIGHT}px`,
                            boxSizing: 'border-box',
                          }}
                          title={displayPath(path)}
                        >
                          <span className="truncate flex-1 font-mono text-xs">{(path.split('/').pop() || path).replace(/\.uasset$/, '')}</span>
                          <button
                            onClick={() => toggleFile(path)}
                            className="opacity-0 group-hover/queue:opacity-100 transition-opacity flex-shrink-0 p-1 hover:text-white"
                            style={{ color: 'var(--text-4)' }}
                            title="Remove from queue"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 border-t flex flex-col gap-3 flex-shrink-0" style={{ borderColor: 'var(--bg-2)' }}>
              <button
                onClick={handleExtract}
                disabled={queue.length === 0}
                className="w-full px-4 py-3 font-medium transition-colors disabled:cursor-not-allowed"
                style={{
                  backgroundColor: queue.length === 0 ? 'var(--bg-1)' : 'var(--accent-main)',
                  color: queue.length === 0 ? 'var(--text-4)' : 'var(--bg-4)',
                }}
              >
                Extract &amp; Import {queue.length > 0 ? `(${queue.length.toLocaleString()})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
