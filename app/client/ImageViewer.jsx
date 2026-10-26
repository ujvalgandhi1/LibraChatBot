import React, { useCallback, useEffect, useRef, useState } from 'react';

// Show catalogued images in the same view-only chrome as the PDF/table viewers
// instead of handing the raw file to the browser. Zoom/pan are handled here so
// no native image controls are involved.

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;

function hashU() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return new URLSearchParams(qi === -1 ? '' : hash.slice(qi + 1)).get('u');
}
function fileUrl(u) {
  return u ? `/api/file?u=${encodeURIComponent(u)}` : null;
}
function fileName(u) {
  try { return (decodeURIComponent(String(u || '').split('/').pop()) || 'Image').replace(/\?.*$/, ''); }
  catch { return 'Image'; }
}
const clamp = (z) => Math.min(Math.max(z, ZOOM_MIN), ZOOM_MAX);

export default function ImageViewer({ src, embedded = false }) {
  const u = src || hashU();
  const name = fileName(u);
  const url = fileUrl(u);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | done | error
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);

  useEffect(() => {
    if (embedded) return;
    document.title = `${name} — View only`;
  }, [name, embedded]);

  useEffect(() => { setStatus('loading'); setDims({ w: 0, h: 0 }); setFit(true); }, [u]);

  // Deterrents (mirrors the other viewers): mark view-only, block the context
  // menu and save/print shortcuts. Not DRM — the bytes still reach the browser.
  useEffect(() => {
    if (!embedded) document.body.classList.add('viewer-mode');
    const blockCtx = (e) => e.preventDefault();
    const blockKeys = (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'p')) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('contextmenu', blockCtx);
    window.addEventListener('keydown', blockKeys, true);
    return () => {
      document.body.classList.remove('viewer-mode');
      document.removeEventListener('contextmenu', blockCtx);
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, [embedded]);

  // Scale that makes the whole image visible (never upscales past 1:1).
  const fitScale = useCallback(() => {
    const el = stageRef.current;
    if (!el || !dims.w || !dims.h) return 1;
    return clamp(Math.min((el.clientWidth - 32) / dims.w, (el.clientHeight - 32) / dims.h, 1));
  }, [dims.w, dims.h]);

  useEffect(() => {
    if (!fit || !dims.w) return undefined;
    const apply = () => setZoom(fitScale());
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [fit, dims.w, dims.h, fitScale]);

  const zoomBy = (factor) => { setFit(false); setZoom((z) => clamp(z * factor)); };

  // Drag to pan once the image is larger than the stage.
  const onPointerDown = (e) => {
    const el = stageRef.current;
    if (!el || (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)) return;
    dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('imgv-grabbing');
  };
  const onPointerMove = (e) => {
    const el = stageRef.current;
    const d = dragRef.current;
    if (!el || !d) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = (e) => {
    const el = stageRef.current;
    dragRef.current = null;
    el?.releasePointerCapture?.(e.pointerId);
    el?.classList.remove('imgv-grabbing');
  };

  const pct = Math.round(zoom * 100);

  return (
    <div className={embedded ? 'imgv is-embedded' : 'imgv'}>
      {!embedded && (
        <div className="pdfv-bar">
          <span className="pdfv-name" title={name}>{name}</span>
          <span className="pdfv-badge">View only</span>
          {status === 'done' && (
            <span className="pdfv-count">{dims.w} × {dims.h} px</span>
          )}
        </div>
      )}

      {status === 'done' && (
        <div className="imgv-tools">
          <button className="imgv-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">−</button>
          <span className="imgv-zoom">{pct}%</span>
          <button className="imgv-btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
          <button className={`imgv-btn wide${fit ? ' on' : ''}`} onClick={() => setFit(true)}>Fit</button>
          <button className="imgv-btn wide" onClick={() => { setFit(false); setZoom(1); }}>1:1</button>
          <span className="tblv-hint">Drag to pan · double-click to toggle fit</span>
        </div>
      )}

      {status === 'loading' && <div className="pdfv-state"><div className="spinner" /> Loading image…</div>}
      {status === 'error' && (
        <div className="pdfv-state error">
          ⚠ Unable to display this image. It may not be a browser-supported format, or it is on a private network this app cannot reach.
        </div>
      )}

      <div
        className="imgv-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => (fit ? (setFit(false), setZoom(1)) : setFit(true))}
      >
        {url && (
          <img
            className="imgv-img"
            src={url}
            alt={name}
            draggable={false}
            style={dims.w ? { width: `${Math.round(dims.w * zoom)}px` } : { visibility: 'hidden' }}
            onLoad={(e) => {
              setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
              setStatus('done');
            }}
            onError={() => setStatus('error')}
          />
        )}
      </div>
    </div>
  );
}
