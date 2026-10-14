import { createRoot } from 'react-dom/client';
import { App } from './App';
import * as tauri from '@/services/tauri';

document.addEventListener('contextmenu', (e) => e.preventDefault());

// Global error handlers to capture WebView crashes and unhandled exceptions to disk logger
window.addEventListener('error', (event) => {
  const loc = `${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`;
  const msg = `[WebView Error] ${event.message} at ${loc}`;
  console.error(msg, event.error);
  tauri.logFrontendMessage('ERROR', msg).catch(() => {});
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason ? (event.reason.stack || event.reason.message || String(event.reason)) : 'Unknown rejection';
  const msg = `[WebView Unhandled Rejection] ${reason}`;
  console.error(msg);
  tauri.logFrontendMessage('ERROR', msg).catch(() => {});
});

console.debug('[main] Mounting React app...');
const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');
const root = createRoot(container);
root.render(<App />);
console.debug('[main] React app mounted.');
