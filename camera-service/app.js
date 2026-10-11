import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzePhoto, identifyDonation, languages } from './vision.js';

/** @param {Buffer} data */
export function detectImage(data) {
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return null;
}

/** @param {{analyze?: typeof analyzePhoto, identify?: typeof identifyDonation, configured?: () => boolean}} [options] */
export function createApp(options = {}) {
  const analyze = options.analyze || analyzePhoto;
  const identify = options.identify || identifyDonation;
  const configured = options.configured || (() => Boolean(process.env.GEMINI_API_KEY?.trim()));
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8*1024*1024, files: 1, fields: 1, fieldSize:64 } });
  let busy = false;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
    const local = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (origin && !local && !allowed.includes(origin)) {
      res.status(403).json({ error: 'origin_not_allowed' }); return;
    }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true, gemini_configured: configured(), model: process.env.GEMINI_MODEL || 'gemini-3.8-flash' }));
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.post(['/analyze','/identify'], upload.single('image'), async (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'image_required', message: 'Send one file in multipart field image.' }); return; }
    const mediaType = detectImage(req.file.buffer);
    if (!mediaType || req.file.mimetype !== mediaType) { res.status(415).json({ error: 'unsupported_image', message: 'Use JPEG, PNG or WebP with matching content type.' }); return; }
    const language = req.body?.language || 'English';
    if (req.path === '/identify' && !languages.includes(language)) { res.status(400).json({error:'unsupported_language'}); return; }
    if (!configured()) { res.status(503).json({ error: 'key_missing', message: 'Set GEMINI_API_KEY in .env and restart the server.' }); return; }
    if (busy) { res.status(429).json({ error: 'scan_in_progress' }); return; }
    busy = true;
    try {
      const result = req.path === '/identify' ? await identify(req.file.buffer,mediaType,language) : await analyze(req.file.buffer, mediaType);
      res.json({ schema_version: '1.1', scan_id: randomUUID(), analyzed_at: new Date().toISOString(), ...result });
    } catch (error) {
      // Never log provider error objects: they can contain request credentials/images.
      const providerStatus = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      if (providerStatus === 429) { res.status(429).json({error:'gemini_quota', message:'Gemini quota/rate limit reached. Identification paused; check AI Studio limits before restarting.'}); return; }
      if (providerStatus === 402) { res.status(402).json({error:'gemini_billing_required', message:'Google requires billing for this project/request. No billing was enabled here. Use an eligible Free-tier project/model.'}); return; }
      if (providerStatus === 401 || providerStatus === 403) { res.status(503).json({error:'gemini_access_denied', message:'Google rejected API access. Check the key and its API restrictions in AI Studio.'}); return; }
      if (providerStatus === 404) { res.status(503).json({error:'gemini_model_unavailable', message:'This model is unavailable to the project. Check GEMINI_MODEL and project access.'}); return; }
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) { res.status(504).json({error:'gemini_timeout',message:'Gemini did not respond within 60 seconds. Check network access and try again.'}); return; }
      res.status(502).json({ error: 'analysis_failed', message: 'Check key access, model availability and quota in AI Studio. Retry with a clear photo.' });
    } finally { busy = false; }
  });
  /** @type {import('express').ErrorRequestHandler} */
  const onError = (error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'image_too_large' : 'invalid_upload' });
    } else res.status(500).json({ error: 'request_failed' });
  };
  app.use(onError);
  return app;
}
