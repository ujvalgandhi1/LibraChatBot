import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

// Render PDFs to <canvas> ourselves so the browser's native PDF toolbar
// (with its download / print / save buttons) is never shown. Each load gets
// its own worker (created in the effect) so React StrictMode's
// mount/unmount/mount cycle can't destroy a shared worker mid-load.

function hashU() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1)).get('u');
}

function fileUrl(u) {
  return u ? `/api/file?u=${encodeURIComponent(u)}` : null;
}

function fileName(u) {
  try { return decodeURIComponent(String(u || '').split('/').pop()) || 'Document'; } catch { return 'Document'; }
}

function friendlyError(e) {
  const msg = String(e?.message || e);
  if (/401|403|not authorized/i.test(msg)) {
    return 'You are not authorized to view this file, or it is on a private network this app cannot reach.';
  }
  if (/404|missing|not found/i.test(msg)) return 'File not found.';
  return 'Unable to display this document.';
}

export default function PdfViewer({ src, embedded = false }) {
  const pagesRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | done | error
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const u = src || hashU();
  const name = fileName(u);

  useEffect(() => {
    if (embedded) return;
    document.title = `${name} — View only`;
  }, [name, embedded]);

  // Deterrents: mark the page view-only, block the context menu and the
  // obvious print/save keyboard shortcuts. (Not DRM — see note in the app.)
  useEffect(() => {
    if (!embedded) document.body.classList.add('viewer-mode');
    const blockCtx = (e) => e.preventDefault();
    const blockKeys = (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 's')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('contextmenu', blockCtx);
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      document.body.classList.remove('viewer-mode');
      document.removeEventListener('contextmenu', blockCtx);
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, [embedded]);

  useEffect(() => {
    let cancelled = false;
    let task;
    let worker;
    setStatus('loading');
    setError('');
    setProgress({ done: 0, total: 0 });
    const url = fileUrl(u);
    if (!url) { setError('No file specified.'); setStatus('error'); return; }

    (async () => {
      try {
        worker = new pdfjsLib.PDFWorker({ port: new PdfWorker() });
        task = pdfjsLib.getDocument({ url, isEvalSupported: false, worker });
        const pdf = await task.promise;
        if (cancelled) return;

        const host = pagesRef.current;
        if (!host) return;
        host.replaceChildren();
        setProgress({ done: 0, total: pdf.numPages });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.min(host.clientWidth - 24, 1000);

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          const page = await pdf.getPage(n);
          const unit = page.getViewport({ scale: 1 });
          const scale = Math.max(0.2, targetW / unit.width);
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
          canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
          host.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
          page.cleanup();
          if (!cancelled) setProgress({ done: n, total: pdf.numPages });
        }
        if (!cancelled) setStatus('done');
      } catch (e) {
        if (!cancelled) { console.error('[pdfv] load failed', e); setError(friendlyError(e)); setStatus('error'); }
      }
    })();

    return () => {
      cancelled = true;
      (async () => {
        try { await task?.destroy?.(); } catch { /* noop */ }
        try { worker?.destroy?.(); } catch { /* noop */ }
      })();
    };
  }, [u]);

  return (
    <div className={embedded ? 'pdfv is-embedded' : 'pdfv'}>
      {!embedded && (
        <div className="pdfv-bar">
          <span className="pdfv-name" title={name}>{name}</span>
          <span className="pdfv-badge">View only</span>
          {progress.total > 0 && (
            <span className="pdfv-count">
              {status === 'loading' ? `Rendering ${progress.done}/${progress.total}…` : `${progress.total} page${progress.total > 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      )}

      {status === 'loading' && progress.total === 0 && (
        <div className="pdfv-state"><div className="spinner" /> Loading document…</div>
      )}
      {status === 'error' && <div className="pdfv-state error">⚠ {error}</div>}

      <div className="pdfv-pages" ref={pagesRef} onContextMenu={(e) => e.preventDefault()} />
    </div>
  );
}
