import type { AppSettings } from '@/types';
import { StyledPanel } from '@/components/ui';

interface LoadFilesPanelProps {
  settings: AppSettings;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onSelectFolder: () => void;
  onBrowseHeroes: () => void;
  onManualExtraction: () => void;
}

export function LoadFilesPanel({
  settings, isDragging,
  onDragOver, onDragLeave, onDrop,
  onSelectFolder, onBrowseHeroes, onManualExtraction,
}: LoadFilesPanelProps) {
  const hasPaksPath = !!settings.paksPath;
  const hasUsmapPath = !!settings.usmapPath;

  return (
    <div className="flex flex-col gap-8">
      <StyledPanel title="Load Files">
        <div
          className="text-center py-10 px-6 border-2 border-dashed transition-colors"
          style={{ backgroundColor: 'var(--bg-2)', borderColor: isDragging ? 'var(--accent-main)' : 'var(--bg-1)', opacity: hasUsmapPath ? 1 : 0.6 }}
          onDragOver={hasUsmapPath ? onDragOver : undefined}
          onDragLeave={hasUsmapPath ? onDragLeave : undefined}
          onDrop={hasUsmapPath ? onDrop : undefined}
        >
          <div
            onClick={hasUsmapPath ? onSelectFolder : undefined}
            className={`w-full h-full flex flex-col items-center justify-center py-6 transition-all ${hasUsmapPath ? 'cursor-pointer hover:opacity-90' : 'cursor-not-allowed'}`}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3 border transition-transform duration-200"
              style={{
                backgroundColor: 'var(--bg-1)',
                borderColor: isDragging ? 'var(--accent-main)' : 'var(--bg-1)',
                transform: isDragging ? 'scale(1.1)' : 'scale(1)',
              }}
            >
              <svg className="h-7 w-7" style={{ color: isDragging ? 'var(--accent-main)' : 'var(--text-3)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <h3 className="text-sm font-bold tracking-wider uppercase" style={{ color: 'var(--text-1)' }}>
              {isDragging ? 'Release to Load Files' : 'Import Assets or Presets'}
            </h3>
            <p className="mt-1 text-xs max-w-sm text-center font-mono leading-relaxed" style={{ color: hasUsmapPath ? 'var(--text-4)' : 'var(--accent-warning, #f59e0b)' }}>
              {hasUsmapPath
                ? 'Drop .uasset files, a materials folder, or .rvfxp project recipes — or click to browse.'
                : 'Configure .usmap and Game Paks in Settings to begin editing.'}
            </p>
          </div>
        </div>
      </StyledPanel>

      {/* Hero VFX Browser Button */}
      <StyledPanel title="Hero VFX Browser">
        <div className="p-4 flex flex-col items-center gap-3">

          <button
            onClick={onBrowseHeroes}
            disabled={!hasUsmapPath || !hasPaksPath}
            className="flex items-center gap-2 px-6 py-3 font-medium rounded-none transition-colors shadow-md disabled:cursor-not-allowed"
            style={{
              backgroundColor: (!hasUsmapPath || !hasPaksPath) ? 'var(--bg-1)' : 'var(--accent-main)',
              color: (!hasUsmapPath || !hasPaksPath) ? 'var(--text-4)' : 'var(--bg-4)',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Browse Hero VFX
          </button>
          <p className="text-sm text-center" style={{ color: 'var(--text-4)' }}>
            Browse and load VFX materials directly from game files by hero.
          </p>
          {(!hasUsmapPath || !hasPaksPath) && (
            <p className="text-xs" style={{ color: 'var(--accent-warning, #f59e0b)' }}>
              {!hasUsmapPath && !hasPaksPath
                ? 'Set both .usmap and Game Paks paths in Settings to use this feature.'
                : !hasUsmapPath
                  ? 'Set .usmap path in Settings first.'
                  : 'Set Game Paks path in Settings first.'}
            </p>
          )}
        </div>
      </StyledPanel>

      {/* Manual Extraction Button */}
      <StyledPanel title="Manual Extraction">
        <div className="p-4 flex flex-col items-center gap-3">

          <button
            onClick={onManualExtraction}
            disabled={!hasUsmapPath || !hasPaksPath}
            className="flex items-center gap-2 px-6 py-3 font-medium rounded-none transition-colors shadow-md disabled:cursor-not-allowed"
            style={{
              backgroundColor: (!hasUsmapPath || !hasPaksPath) ? 'var(--bg-1)' : 'var(--accent-main)',
              color: (!hasUsmapPath || !hasPaksPath) ? 'var(--text-4)' : 'var(--bg-4)',
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
              <path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M12 11v6" />
              <path d="m9 14 3 3 3-3" />
            </svg>
            Browse Game Files
          </button>
          <p className="text-sm text-center" style={{ color: 'var(--text-4)' }}>
            Browse the game's IoStore containers as a folder tree, then queue material instances to extract and import.
          </p>
          {(!hasUsmapPath || !hasPaksPath) && (
            <p className="text-xs" style={{ color: 'var(--accent-warning, #f59e0b)' }}>
              {!hasUsmapPath && !hasPaksPath
                ? 'Set both .usmap and Game Paks paths in Settings to use this feature.'
                : !hasUsmapPath
                  ? 'Set .usmap path in Settings first.'
                  : 'Set Game Paks path in Settings first.'}
            </p>
          )}
        </div>
      </StyledPanel>
    </div>
  );
}
