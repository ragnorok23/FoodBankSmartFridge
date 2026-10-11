# Camera + Gemini handoff for FoodBankSmartFridge

## Read this first

This is Saleh's camera/identification module, ready to merge with the teammate's existing ElevenLabs agent and frontend. The repository's original main branch contained only its project README when inspected. The partner's working ElevenLabs code may therefore exist locally or on another branch: inspect that code first and preserve it. This handoff does not claim that voice, database integration, or unattended camera capture are finished.

**No API key, photos, camera screenshots, node_modules, or personal account configuration are included.** Saleh will supply a key privately later. You can run the tests without one. Do not ask Claude to read, print, paste, commit or embed the real `.env` in client code.

## Accepted product plan

- Mac built-in camera faces the donor. ElevenLabs conversation decides when it needs visual identification and calls a client-side camera tool. Gemini identifies the visible food, quantities and qualitative certainty, with translated names/message in the donor's selected language. No face recognition or repeated front-camera polling.
- Logitech Brio faces inside the fridge. Rear inventory audits repeat hourly normally, with a 30-second demo option. Camera previews are continuous; Gemini analysis is discrete and may be slow.
- Identifying a donation is not proof of placement. Do not increase inventory, issue rewards, or claim a verified deposit just because the front camera recognized an item.
- Rear audits compare visible inventory and flag differences for review. Do not label someone a thief; legitimate pickups, occlusion, shifting items and inconsistent model labels can explain differences.
- No YOLO/local detector is implemented. That was discussed, then superseded by the two-camera, on-demand/hourly plan. Do not describe this as real-time per-frame CV or automatically trained recognition.

## Run the module now

```bash
cd camera-service
npm ci
cp .env.example .env
# Saleh enters GEMINI_API_KEY privately in .env; never commit it.
npm run dev
```

Open http://localhost:3100, allow cameras, and click Start both cameras. Confirm FaceTime is the donation camera and Brio is the inventory camera. Test item identification calls the front endpoint; Audit now calls the rear endpoint. Enable audits starts the automatic rear loop. Production default is one hour; use the explicit 30-second demo setting to demonstrate updates. It consumes more quota.

For non-Gemini checks: `npm run check`, `npm test`, `node --check public/dual.js`.

## APIs to integrate

### POST /identify — front camera

Multipart `image` (JPEG/PNG/WebP <=8 MB), optional `language`. Allowed language names: English, Spanish, Arabic, French, Hindi, Urdu, Chinese, Vietnamese. Default English. Let the browser set multipart Content-Type.

Response: `schema_version`, `scan_id`, `analyzed_at`, `model`, `language`, `identification`, `usage`.
`identification`: `food_detected`, `items` (English `name`, localized `translated_name`, `visible_count` or null, `certainty`, `evidence`), localized `message`, `limitations`.

No-food / unidentifiable scenes should prompt the donor to show the item clearly. These names are not guaranteed ingredient/allergen or food-safety information. Certainty is qualitative, not a calibrated accuracy score.

### POST /analyze — rear camera

Multipart `image` only. Response includes `inventory`: `image_quality`, rough `stock_level`, `items` (name, category, visible_count, certainty, evidence, boxes), observations/limitations. Boxes use coordinates 0..1000 relative to the frame.

`GET /health` reports key presence, not Google authentication acceptance.

The standalone backend binds 127.0.0.1:3100. Merge these handlers into your team's backend or use a local same-origin proxy. Local webcam capture cannot run on a Vercel server; the browser/local device must supply frames. Add authenticated access and request limits before publicly exposing these endpoints. Set exact ALLOWED_ORIGINS if needed; do not solve mixed-content/CORS by disabling browser protections.

## Connect ElevenLabs

Register a **client tool**, for example `identify_donation`, with a `language` parameter and **Wait for response** enabled. Tool names in the agent dashboard and client registration must match exactly. Inspect the partner's installed ElevenLabs SDK version and reuse its existing agent/session setup; do not guess imports or replace the working conversation.

On this module's test page, the tool implementation can call:

```js
async function identify_donation({language = 'English'} = {}) {
  try {
    const result = await window.fridgeVision.identifyDonation(language);
    return JSON.stringify(result.identification);
  } catch (error) {
    return JSON.stringify({error: error.message, retryable: true});
  }
}
```

This is a tool-function example, not a complete ElevenLabs SDK initialization. Once camera code lives in the teammate's frontend, implement equivalent front-frame capture and POST /identify there. The test page's `window.fridgeVision` is only available in the document that loaded `public/dual.js`; another tab/window cannot call it directly.

Suggested voice behavior: ask the donor to hold the item in view, call identification once when needed, speak the returned localized name, ask for confirmation if uncertain, then tell the person where to place it. Wait for the tool result rather than inventing an answer. If another camera request is busy, ask the donor to wait/retry. Configure the agent tool timeout to accommodate Gemini's observed response latency; verify the supported timeout against the partner's SDK/platform.

Official references:
- https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools
- https://elevenlabs.io/docs/eleven-agents/libraries/java-script
- https://elevenlabs.io/docs/eleven-agents/libraries/react
- https://elevenlabs.io/docs/eleven-agents/customization/authentication

## Make inventory updates consistent

The included client:
- Runs one analysis at a time, avoiding overlapping front/rear submissions.
- Persists audit enablement, cadence, last clear baseline, latest result and next due time in browser localStorage.
- Resumes a previously enabled schedule after the user restarts both cameras.
- Retries transient failures after 30s, 60s, 120s etc., capped at 5 minutes.
- Pauses for key/access/billing/quota failures so it does not hammer an unusable API.
- Re-renders inventory after each successful audit and emits `fridge-audit` with the response plus comparison. Front responses emit `donation-identified`.

Subscribe to `fridge-audit` in the integrated frontend and POST the results into the team's existing backend/database. That integration is the missing step for durable inventory shared across teammates and user devices: current localStorage is only local to this browser.

`window.fridgeVision` exposes `identifyDonation(language)`, `auditNow()`, `getInventory()`, `startCameras()`, `enableAudits()`, `pauseAudits()`.

Do not leave two tabs running the same fridge audit loop. It has no distributed scheduler or cross-tab leader election. Stop the old test page after integrating it into the main frontend.

## Current limitations / next work for Claude

1. Integrate the client tool into the partner's existing ElevenLabs session and verify the voice→capture→Gemini→spoken answer flow with actual food.
2. Move camera previews, language selection and audit controls into the teammate's UI. Handle camera reconnects, camera permission denial, busy/tool errors, and clear loading states. Keep the functional backend separate from styling.
3. Persist confirmed rear audit results and reviewable differences in the team's chosen database. Use stable item IDs or controlled names; exact name matching currently lets labels such as “can” and “energy drink can” disagree.
4. Decide whether the demo really needs always-on background operation. Current browser scheduler requires this page/backend running and Mac awake. Hidden-tab throttling can delay audits; overdue scans run when visible. For unattended operation, create an always-on local camera capture agent that sends periodic images to the backend, with one owner of each camera. Cloud cron alone cannot access the local USB camera. Do not claim this is already built.
5. For refill checks, configure actual desired stock. A rough image stock estimate alone cannot determine required donations. A dark/blocked fridge must produce unknown/limited data, not fake empty inventory.
6. If donation credit/rewards are added, require a separate deposit-confirmation flow and abuse checks. Never reward on front-camera recognition alone.

## Verification completed

- 14 automated API/schema/audit/tracker tests pass; type checks and browser-script syntax checks pass.
- Both physical cameras ran simultaneously on Saleh's Mac.
- Gemini rear audit recognized one energy drink can and one granola bar in the tabletop demo.
- The new retry/cadence helpers are tested; a full unattended one-hour run and ElevenLabs voice integration have not been demonstrated.
- Google calls can fail or take seconds/tens of seconds. No speed/accuracy guarantee is made.

## Secrets

Copy .env.example locally. GEMINI_API_KEY is server-side only. Do not use NEXT_PUBLIC_/VITE_ prefixes for it. API keys are associated with a Google project: anyone holding the key can consume its quota and possibly cause charges if billing is active. Prefer a separate Gemini-restricted teammate key, remain Free tier if required, and revoke the temporary key after the event. Sharing a Gemini key does not itself share Google sign-in, Gmail, or Drive permissions.

## Prompt to give Claude Code

“Read CLAUDE_HANDOFF.md and camera-service/README.md. Inspect my existing ElevenLabs agent/frontend before changing it. Integrate the dual-camera module: front camera only on the agent's identify_donation client tool, rear camera in a non-overlapping scheduled audit loop, normal hourly cadence and labeled demo mode. Persist audit results through our existing backend and update the UI automatically. Preserve the existing voice setup. Keep all keys server-side and out of Git; Saleh will enter Gemini's key privately. Clearly report what remains unimplemented, especially unattended capture, deposit verification and accuracy. Run relevant tests and demonstrate voice→camera→Gemini→voice plus successive inventory updates.”
