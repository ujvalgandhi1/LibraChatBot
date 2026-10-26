// /api/file - streams a private blob through the app identity.
//
// This is the endpoint that most directly hands the managed identity's read access to
// a caller, so the SSRF guard in lib/qualified-names.js and the account allowlist are
// what keep it honest.
import { Router } from 'express';
import { Readable } from 'node:stream';

import { toBlobUrl as toBlobUrlPure } from '../lib/qualified-names.js';
import { getToken } from '../azure.js';
import { STORAGE_SCOPE, STORAGE_API_VERSION, VIEWER_ALLOWED_ACCOUNTS } from '../config.js';

const router = Router();

const MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json'
};
// Only render these inline; anything else (html, svg, office docs...) downloads,
// so untrusted markup never executes in this app's origin.
const INLINE_SAFE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'txt', 'csv', 'json']);

// The viewer opens in a browser tab, so surface failures as a readable page, not JSON.
function sendViewerError(res, status, title, detail) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  res.status(status).type('html').send(
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
    `<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;` +
    `font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0f1420;color:#e6e9ef}` +
    `.box{max-width:520px;padding:32px 36px;background:#171d2b;border:1px solid #2a3346;border-radius:14px}` +
    `h1{margin:0 0 10px;font-size:20px}p{margin:0;color:#aab3c5;line-height:1.55;font-size:14px}</style></head>` +
    `<body><div class="box"><h1>${esc(title)}</h1><p>${esc(detail)}</p></div></body></html>`
  );
}

const toBlobUrl = (qn) => toBlobUrlPure(qn, { allowedAccounts: VIEWER_ALLOWED_ACCOUNTS });

router.get('/file', async (req, res) => {
  let blobUrl;
  try {
    blobUrl = toBlobUrl((req.query.u ?? '').toString());
  } catch {
    return sendViewerError(res, 400, 'Invalid file link',
      'A valid Azure Storage file URL is required to open the viewer.');
  }
  try {
    const token = await getToken(STORAGE_SCOPE);
    const headers = { Authorization: `Bearer ${token}`, 'x-ms-version': STORAGE_API_VERSION };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(blobUrl.toString(), { headers });
    if (upstream.status === 401 || upstream.status === 403) {
      return sendViewerError(res, 403, 'This file can\u2019t be opened here',
        'The storage account is private (public network access is disabled) or not reachable from this network. ' +
        'Connect to the corporate VPN or run the app inside the VNet, and make sure you have Storage Blob Data Reader access.');
    }
    if (upstream.status === 404) {
      return sendViewerError(res, 404, 'File not found', 'The file no longer exists at this location.');
    }
    if (!upstream.ok && upstream.status !== 206) {
      return sendViewerError(res, 502, 'Unable to load the file',
        'The file could not be retrieved from storage. It may be on a private network this app cannot reach.');
    }

    const fileName = decodeURIComponent(blobUrl.pathname.split('/').pop() || 'file');
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const upstreamType = upstream.headers.get('content-type');
    const type = (!upstreamType || upstreamType === 'application/octet-stream')
      ? (MIME_BY_EXT[ext] || upstreamType || 'application/octet-stream')
      : upstreamType;
    const disposition = INLINE_SAFE.has(ext) ? 'inline' : 'attachment';

    res.status(upstream.status);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('file proxy error:', err.message);
    if (!res.headersSent) {
      sendViewerError(res, 502, 'Unable to load the file',
        'The file could not be retrieved from storage. It may be on a private network this app cannot reach.');
    }
  }
});

export default router;
