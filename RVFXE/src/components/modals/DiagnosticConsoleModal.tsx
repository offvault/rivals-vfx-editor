import { useState, useEffect, useRef, useCallback } from 'react';
import type { TelemetrySnapshot } from '@/types';
import * as tauri from '@/services/tauri';

export interface DiagnosticConsoleModalProps {
  onClose: () => void;
}

const MODAL_WIDTH = 720;
const MODAL_HEIGHT = 480;

export function DiagnosticConsoleModal({ onClose }: DiagnosticConsoleModalProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Floating draggable position state bounded within viewport
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const maxX = Math.max(12, w - MODAL_WIDTH - 20);
    return {
      x: maxX,
      y: 50,
    };
  });
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const fetchDiagnosticData = useCallback(async () => {
    try {
      const [fetchedLogs, snap] = await Promise.all([
        tauri.getDiagnosticLogs(500),
        tauri.getTelemetrySnapshot(),
      ]);
      setLogs(fetchedLogs);
      setTelemetry(snap);
    } catch (err) {
      console.error('[Console] Failed to fetch telemetry/logs:', err);
    }
  }, []);

  // Poll telemetry and logs every 1.5 seconds while open
  useEffect(() => {
    fetchDiagnosticData();
    const interval = setInterval(fetchDiagnosticData, 1500);
    return () => clearInterval(interval);
  }, [fetchDiagnosticData]);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Mouse drag listeners with strict viewport bounds so the modal never cuts off
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a, label')) return;
    isDraggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const minX = 8;
      const maxX = Math.max(minX, window.innerWidth - MODAL_WIDTH - 8);
      const minY = 8;
      const maxY = Math.max(minY, window.innerHeight - MODAL_HEIGHT - 8);

      const newX = Math.max(minX, Math.min(maxX, e.clientX - dragOffsetRef.current.x));
      const newY = Math.max(minY, Math.min(maxY, e.clientY - dragOffsetRef.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Handle window resize so modal never gets stranded outside the window
  useEffect(() => {
    const handleResize = () => {
      setPosition(prev => {
        const minX = 8;
        const maxX = Math.max(minX, window.innerWidth - MODAL_WIDTH - 8);
        const minY = 8;
        const maxY = Math.max(minY, window.innerHeight - MODAL_HEIGHT - 8);
        return {
          x: Math.max(minX, Math.min(maxX, prev.x)),
          y: Math.max(minY, Math.min(maxY, prev.y)),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleOpenLogFolder = async () => {
    try {
      await tauri.openLogFolder();
    } catch (err: any) {
      alert(`Could not open log folder: ${err.message || err}`);
    }
  };

  const handleClear = async () => {
    try {
      await tauri.clearDiagnosticLogs();
      setLogs([]);
    } catch (err: any) {
      console.error('[Console] Failed to clear logs:', err);
    }
  };

  const handleCopy = () => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(logs.join('\n'));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Escape key handler to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100] select-none">
      <div
        className="pointer-events-auto absolute flex flex-col border shadow-2xl font-mono text-xs"
        style={{
          width: `${MODAL_WIDTH}px`,
          height: `${MODAL_HEIGHT}px`,
          maxWidth: 'calc(100vw - 16px)',
          maxHeight: 'calc(100vh - 16px)',
          left: `${position.x}px`,
          top: `${position.y}px`,
          backgroundColor: 'var(--bg-3)',
          borderColor: 'var(--bg-1)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* Draggable Terminal Header */}
        <div
          onMouseDown={handleMouseDown}
          className="px-3.5 py-2 border-b flex justify-between items-center flex-shrink-0 cursor-move"
          style={{
            backgroundColor: 'var(--bg-2)',
            borderColor: 'var(--bg-1)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <h2 className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--text-1)' }}>
              Console Telemetry
            </h2>
            <span
              className="text-[10px] px-1.5 py-0.5 border"
              style={{
                backgroundColor: 'var(--bg-4)',
                borderColor: 'var(--bg-1)',
                color: 'var(--text-3)',
              }}
            >
              Live
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenLogFolder}
              title="Open persistent Logs directory on disk"
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium border transition-colors hover:bg-white/10"
              style={{
                backgroundColor: 'var(--bg-1)',
                borderColor: 'var(--bg-1)',
                color: 'var(--text-2)',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>Folder</span>
            </button>

            <button
              onClick={handleCopy}
              disabled={logs.length === 0}
              className="px-2.5 py-1 text-[11px] font-medium border transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{
                backgroundColor: 'var(--bg-1)',
                borderColor: 'var(--bg-1)',
                color: 'var(--text-2)',
              }}
            >
              {isCopied ? '✓ Copied' : 'Copy'}
            </button>

            <button
              onClick={handleClear}
              disabled={logs.length === 0}
              className="px-2.5 py-1 text-[11px] font-medium border transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{
                backgroundColor: 'var(--bg-1)',
                borderColor: 'var(--bg-1)',
                color: 'var(--text-3)',
              }}
            >
              Clear
            </button>

            <button
              onClick={onClose}
              title="Close Console"
              className="w-6 h-6 flex items-center justify-center transition-colors hover:bg-red-500/20 text-gray-400 hover:text-red-400 ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Real-time Telemetry Dashboard Bar */}
        <div
          className="px-3.5 py-1.5 border-b flex flex-wrap items-center justify-between text-[11px] flex-shrink-0"
          style={{
            backgroundColor: 'var(--bg-4)',
            borderColor: 'var(--bg-2)',
          }}
        >
          {telemetry ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span style={{ color: 'var(--text-4)' }}>Sys RAM:</span>
                <span className="font-semibold" style={{ color: 'var(--text-1)' }}>
                  {(telemetry.used_ram_mb / 1024).toFixed(1)} / {(telemetry.total_ram_mb / 1024).toFixed(1)} GB
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-4)' }}>({Math.round(telemetry.ram_percent)}%)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span style={{ color: 'var(--text-4)' }}>App RAM:</span>
                <span className="font-semibold text-emerald-400">{telemetry.app_ram_mb} MB</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span style={{ color: 'var(--text-4)' }}>CPU:</span>
                <span
                  className="font-semibold"
                  style={{
                    color:
                      telemetry.cpu_percent > 75
                        ? '#f87171'
                        : telemetry.cpu_percent > 40
                        ? '#fbbf24'
                        : '#34d399',
                  }}
                >
                  {Math.round(telemetry.cpu_percent)}%
                </span>
              </div>
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--text-4)' }}>Telemetry standby...</span>
          )}

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-gray-400 hover:text-gray-200">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="cursor-pointer"
              />
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Log Output */}
        <div
          ref={logContainerRef}
          className="flex-1 p-3 overflow-y-auto space-y-1 text-[11px] select-text font-mono"
          style={{ backgroundColor: 'var(--bg-4)' }}
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--text-4)' }}>
              <p>No log messages recorded yet.</p>
              <p className="text-[10px] mt-1 opacity-70">Editor operations will stream telemetry logs here.</p>
            </div>
          ) : (
            logs.map((log, i) => {
              const isError = log.includes('[ERROR]');
              const isWarn = log.includes('[WARN]');
              const isDebug = log.includes('[DEBUG]');
              const isInfo = log.includes('[INFO]');

              const textColor = isError
                ? '#f87171'
                : isWarn
                ? '#fbbf24'
                : isDebug
                ? 'var(--text-4)'
                : isInfo
                ? 'var(--text-1)'
                : 'var(--text-2)';

              return (
                <div key={i} className="leading-relaxed whitespace-pre-wrap break-all" style={{ color: textColor }}>
                  {log}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
