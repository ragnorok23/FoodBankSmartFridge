# Fridge camera backend — donation check-in + hourly inventory audits

Saleh's standalone camera/identification contribution. The default test page now uses **two distinct cameras simultaneously**. No database account, voice account or teammate frontend is required to test it. ElevenLabs itself is not connected yet.

## Run

1. `npm ci` (Node 24 recommended).
2. Copy `.env.example` to `.env` if needed, then privately set `GEMINI_API_KEY`.
3. `npm run dev` or Cursor task **Run backend**.
4. Open http://localhost:3100 and click **Start both cameras**. Mac FaceTime defaults to donation, Logitech Brio defaults to inventory. Check both previews and change selectors if needed.
5. **Test item identification** uses the same function the future ElevenLabs client tool calls. Choose a response language first.
6. **Enable hourly audits** takes an initial audit if no future audit is scheduled, then runs one hour after each successful audit. A clearly labeled 30-second demo interval is also available. **Audit now (demo)** tests without waiting an hour. These controls send images to Google Gemini.

Camera previews do not send images to Gemini. `.env` is ignored by Git; never share it. The dev task reloads `.env`; `npm start` needs a manual restart after changes. Existing sampled live prototype is retained at `/live.html`, but is not the default workflow.

## Front camera / voice integration

`POST /identify`, multipart fields:
- `image`: JPEG, PNG or WebP, maximum 8 MB.
- `language`: English (default), Spanish, Arabic, French, Hindi, Urdu, Chinese, Vietnamese.

Response contains `schema_version`, `scan_id`, `analyzed_at`, `model`, `language`, `identification`, `usage`. Identification fields: `food_detected`, `items` (English `name`, `translated_name`, `visible_count`, qualitative `certainty`, `evidence`), localized `message`, `limitations`.

The donation camera identifies the food being presented. It does not establish identity, food safety, allergens, an actual deposit, or rewards eligibility. It does not increment fridge inventory. A separate teammate workflow can record a proposed donation and verify it later.

The browser's voice-client integration hook is:

```js
// Called when ElevenLabs conversation decides it needs to see the item.
const response = await window.fridgeVision.identifyDonation('Spanish');
// Return identification.message/items to your voice agent for its response.
return response.identification;
```

This is a client-side camera tool: the webcam belongs to the user's browser, so an ElevenLabs server webhook cannot call `window` or access USB cameras directly. If the team uses its own frontend, implement the same camera frame capture and send `/identify` multipart uploads. The test page also emits `donation-identified` with the response.

## Rear camera / inventory integration

`POST /analyze`: multipart `image` only. Returns `inventory` with `image_quality`, `stock_level`, `items`, `observations`, `limitations`; item fields include names/categories, visible counts, certainty, evidence, and boxes normalized to 0..1000 (`ymin`, `xmin`, `ymax`, `xmax`). Schema 1.1; `analyzed_at` is server completion time. Counts are visible items/packages, not hidden contents. Stock level is only a rough estimate without target capacity.

```js
const form = new FormData();
form.append('image', imageBlob, 'fridge.jpg');
const response = await fetch('http://localhost:3100/analyze', {method:'POST',body:form});
const scan = await response.json();
if (!response.ok) throw new Error(scan.message || scan.error);
```

The default browser client saves the latest inventory, last clear baseline and next audit time in localStorage (`fridge-dual-camera-v1`). It does not save photos or donation images. Audit enablement and cadence are remembered. After reload, restart the cameras; a previously enabled loop resumes when both are ready. `window.fridgeVision.getInventory()` returns latest results, `auditNow()` requests an audit, and `fridge-audit` events include results and count comparisons. Teammates should persist those events in their own backend/database for durable shared inventory.

`public/audit.js` exports `compareAudits` and hour scheduling helpers. Compare clear, usable scenes; skip low certainty and unknown quantities. Limited scenes do not replace the last clear baseline. Matching is normalized exact names/categories, so inconsistent model labels can produce misleading differences. All differences require review and do not establish theft, removal, or deposit. Legitimate food collection is expected at a community fridge. Occlusion, expired food and missing items cannot be inferred reliably from an hourly photo.

## Operational limits

The local camera page, backend, awake Mac, lighting, and camera connection are required. Browser background throttling or sleep can delay hourly audits; overdue audits run when the page becomes visible. This is **browser-driven scheduling**, not a cloud camera service. A Vercel deployment cannot directly access a USB webcam on this Mac. For independent unattended audits, use an always-on local capture agent later.

One analysis runs at a time. Temporary scheduled failures retry after 30 seconds with exponential backoff capped at 5 minutes. Key/access/billing/quota failures pause for operator attention. Pausing prevents new submissions; an in-flight request may finish. Certainty is not a calibrated probability. Images are sent to Google; Google's provider policies apply. No billing upgrades are configured by this code; charges/quota depend on the key's Google project settings.

`GET /health` reports key presence, not whether Google accepts it. Errors include 400 invalid upload/language, 413 oversize, 415 unsupported format, 429 concurrency/quota, 402 billing-required, 503 missing key/access/model failure, 504 timeout, 502 other analysis failure. Provider errors/keys/images are never logged.

Backend binds to 127.0.0.1 for local testing. Merge into your team's server or add authentication/request limits before public hosting. `ALLOWED_ORIGINS` permits explicit additional origins. No face recognition or theft accusation workflow is implemented.

## Checks

`npm run check`, `npm test` (14 tests), `node --check public/dual.js`. Automated tests mock Gemini: live accuracy, language quality and physical item placement still need testing with real food and the final fridge.
