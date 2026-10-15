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

  const fetchDiagnosticData = useCallback(async () => {
    try {
      const [fetchedLogs, snap] = await Promise.all([
        tauri.getDiagnosticLogs(500),
        tauri.getTelemetrySnapshot(),
      ]);
      setLogs(fetchedLogs);
      setTelemetry(snap);
    } catch (err) {
      console.error('[DiagnosticConsole] Failed to fetch telemetry/logs:', err);
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
      console.error('[DiagnosticConsole] Failed to clear logs:', err);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[700px] max-h-[90vh] flex flex-col border-2 shadow-2xl overflow-hidden font-mono"
        style={{ backgroundColor: '#0d0f12', borderColor: '#262930' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Terminal Header */}
        <div
          className="p-3 border-b flex justify-between items-center flex-shrink-0"
          style={{ backgroundColor: '#13161c', borderColor: '#262930' }}
        >
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-sm font-bold tracking-wider uppercase text-gray-200">
              Diagnostic Telemetry &amp; Terminal Console
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
              Logs/
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenLogFolder}
              title="Open persistent Logs directory on disk"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded border transition-colors hover:bg-white/10"
              style={{
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                borderColor: 'rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>Open Log Folder</span>
            </button>

            <button
              onClick={handleCopy}
              disabled={logs.length === 0}
              className="px-2.5 py-1 text-xs font-semibold rounded border transition-colors hover:bg-white/10 text-gray-300 disabled:opacity-40"
              style={{ backgroundColor: '#1c2027', borderColor: '#323742' }}
            >
              {isCopied ? '✓ Copied' : 'Copy All'}
            </button>

            <button
              onClick={handleClear}
              disabled={logs.length === 0}
              className="px-2.5 py-1 text-xs font-semibold rounded border transition-colors hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-40"
              style={{ backgroundColor: '#1c2027', borderColor: '#323742' }}
            >
              Clear
            </button>

            <button
              onClick={onClose}
              className="p-1 rounded text-gray-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Real-time Telemetry Dashboard Bar */}
        <div
          className="px-4 py-2 border-b flex flex-wrap items-center justify-between text-xs flex-shrink-0"
          style={{ backgroundColor: '#111318', borderColor: '#262930' }}
        >
          {telemetry ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">System RAM:</span>
                <span className="font-bold text-sky-400">
                  {(telemetry.used_ram_mb / 1024).toFixed(1)} / {(telemetry.total_ram_mb / 1024).toFixed(1)} GB
                </span>
                <span className="text-[11px] text-gray-400">({Math.round(telemetry.ram_percent)}%)</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">App RAM:</span>
                <span className="font-bold text-emerald-400">{telemetry.app_ram_mb} MB</span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">CPU Usage:</span>
                <span
                  className="font-bold"
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
            <span className="text-gray-500 text-xs">Sampling system telemetry...</span>
          )}

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-gray-400 hover:text-gray-200">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded-none cursor-pointer"
              />
              <span className="text-[11px]">Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Log Viewer Output */}
        <div
          ref={logContainerRef}
          className="flex-1 p-3 overflow-y-auto space-y-1 text-xs select-text"
          style={{ backgroundColor: '#090a0d' }}
        >
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <p>No log messages recorded yet.</p>
              <p className="text-[11px] mt-1">Actions in the editor will stream live diagnostic telemetry here.</p>
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
                ? '#38bdf8'
                : '#cbd5e1';

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
