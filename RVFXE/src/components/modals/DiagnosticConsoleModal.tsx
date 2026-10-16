import { useState, useEffect, useRef, useCallback } from 'react';
import type { TelemetrySnapshot } from '@/types';
import * as tauri from '@/services/tauri';

export interface DiagnosticConsoleModalProps {
  onClose: () => void;
}

export function DiagnosticConsoleModal({ onClose }: DiagnosticConsoleModalProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Floating draggable position state
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return {
      x: Math.max(20, w - 790),
      y: 55,
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

  // Mouse drag listeners
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
      const newX = Math.max(10, Math.min(window.innerWidth - 300, e.clientX - dragOffsetRef.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 80, e.clientY - dragOffsetRef.current.y));
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
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden select-none">
      <div
        className="pointer-events-auto absolute flex flex-col border border-cyan-500/40 shadow-2xl overflow-hidden font-mono text-xs rounded-lg"
        style={{
          width: '760px',
          height: '520px',
          left: `${position.x}px`,
          top: `${position.y}px`,
          backgroundColor: '#070b10',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.85), 0 0 20px rgba(6, 182, 212, 0.15)',
        }}
      >
        {/* Draggable Terminal Header */}
        <div
          onMouseDown={handleMouseDown}
          className="px-3 py-2 border-b border-cyan-950 flex justify-between items-center flex-shrink-0 cursor-move bg-[#0b131c]"
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] animate-pulse" />
            <h2 className="text-xs font-bold tracking-widest uppercase text-cyan-200">
              Console
            </h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/40">
              Live
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenLogFolder}
              title="Open persistent Logs directory on disk"
              className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors hover:bg-cyan-500/20"
              style={{
                backgroundColor: 'rgba(6, 182, 212, 0.12)',
                borderColor: 'rgba(6, 182, 212, 0.35)',
                color: '#22d3ee',
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
              className="px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors hover:bg-white/10 text-gray-300 disabled:opacity-40"
              style={{ backgroundColor: '#131b24', borderColor: '#1f2e3d' }}
            >
              {isCopied ? '✓ Copied' : 'Copy'}
            </button>

            <button
              onClick={handleClear}
              disabled={logs.length === 0}
              className="px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-40"
              style={{ backgroundColor: '#131b24', borderColor: '#1f2e3d' }}
            >
              Clear
            </button>

            <button
              onClick={onClose}
              title="Close Console"
              className="p-1 rounded text-gray-400 hover:text-red-400 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Real-time Telemetry Dashboard Bar */}
        <div
          className="px-3 py-1.5 border-b border-cyan-950 flex flex-wrap items-center justify-between text-[11px] flex-shrink-0 bg-[#090e15]"
        >
          {telemetry ? (
            <div className="flex flex-wrap items-center gap-3.5">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Sys RAM:</span>
                <span className="font-semibold text-cyan-300">
                  {(telemetry.used_ram_mb / 1024).toFixed(1)} / {(telemetry.total_ram_mb / 1024).toFixed(1)} GB
                </span>
                <span className="text-[10px] text-gray-400">({Math.round(telemetry.ram_percent)}%)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">App RAM:</span>
                <span className="font-semibold text-emerald-400">{telemetry.app_ram_mb} MB</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">CPU:</span>
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
            <span className="text-gray-500 text-[11px]">Telemetry standby...</span>
          )}

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-gray-400 hover:text-gray-200">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="cursor-pointer accent-cyan-500"
              />
              <span className="text-[10px]">Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Log Output */}
        <div
          ref={logContainerRef}
          className="flex-1 p-2.5 overflow-y-auto space-y-0.5 text-[11px] select-text font-mono bg-[#05080c]"
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <p>No log messages recorded yet.</p>
              <p className="text-[10px] mt-1 text-gray-700">Editor operations will stream telemetry logs here.</p>
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
                ? '#94a3b8'
                : isInfo
                ? '#22d3ee'
                : '#cbd5e1';

              return (
                <div key={i} className="leading-snug whitespace-pre-wrap break-all" style={{ color: textColor }}>
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
