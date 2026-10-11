# Claude Code build prompt — smart fridge vision, barcode and voice

Implement the following in my existing FoodBankSmartFridge app. First read repository instructions and inspect the current frontend, backend and working ElevenLabs conversation. Preserve unrelated teammates' work and reuse the working ElevenLabs agent/session. You may rebuild the earlier camera module if needed. Complete the functionality, not just a plan or mockup.

Repository: https://github.com/ragnorok23/FoodBankSmartFridge

## Goal

A community fridge helps donors identify food in their language, register donations and keep its inventory updated. Two cameras are connected to the local Mac:

- **Front: Mac built-in camera.** Donor shows food here; also used to scan a product barcode when needed.
- **Rear: Logitech webcam.** Points at fridge shelves and performs recurring inventory audits.

Provide explicit device selection and persistent camera roles. Never assign the same camera to both roles. Keep both previews running after the user starts cameras. Gemini analyses are discrete requests; do not claim per-frame recognition, YOLO tracking or that the model trains itself.

## Front-camera identification: Gemini first, barcode backup

The normal interaction is voice through our existing ElevenLabs agent:

1. Donor asks what they are donating. Agent asks them to hold the item in front of the Mac camera.
2. Agent invokes the `identify_donation` client tool with the conversation language.
3. The tool captures a fresh front-camera frame and sends it to the backend. The backend calls Gemini and validates structured output.
4. Return canonical English food name, translated name, visible count when discernible, recognizable brand/flavor/size when supported by the image, qualitative certainty and limitations. Use null/unknown for unreadable details; do not invent an exact product from a generic appearance.
5. ElevenLabs speaks the result in the donor's language. If exact product identity is unclear, ask only for the missing useful detail: brand, flavor or size. Generic identification like “apple” is sufficient for unpackaged food.
6. For an ambiguous packaged product, offer barcode confirmation: “Can you turn the package so its barcode faces the camera?” Invoke a `scan_product_barcode` client tool.
7. Decode a visible UPC/EAN barcode locally with an appropriate maintained decoder. Scan continuously during a bounded barcode session, stop after a valid result, avoid duplicate submissions, and allow cancel/retry. Do not ask Gemini to guess the barcode digits. Show a guide and ask the donor to adjust distance/lighting if needed.
8. Backend looks up the barcode through Open Food Facts. Return catalog name, brand, size and available product image URL. Preserve the barcode as a string, including leading zeros. Show/speak the match for confirmation; distinguish a catalog match from a visual guess.

Barcode scanning must work independently of Gemini. If Gemini fails due to quota, access, timeout or an unrecognized packaged item, offer barcode lookup rather than failing the whole donation flow. Handle a catalog miss honestly: ask for manual details or create an unresolved/generic item. Never fabricate a successful lookup.

Ignore faces, phones and unrelated objects. Identify food/food packaging only. Do not infer identities, ingredients, allergens, expiry or food safety from appearance. Qualitative certainty is not a calibrated accuracy percentage.

## ElevenLabs integration requirements

Register camera functions as **client tools**, using matching names in the agent dashboard and SDK registration. Enable **Wait for response** so the agent receives real identification results before speaking. Reuse the current SDK/session and inspect its installed version before changing imports. Return concise structured tool results and actionable errors, not huge image payloads to the voice model.

Suggested tools:

- `identify_donation(language)`: fresh front frame → backend Gemini recognition.
- `scan_product_barcode()`: bounded front-camera barcode scanning → backend catalog lookup.
- `confirm_donation(proposal_id, quantity)`: submit donor-confirmed placement through the backend, idempotently.

Specify exact tool schemas and agent dashboard instructions in the final handoff. Configure a supported timeout to accommodate real Gemini latency. A server webhook cannot access the local webcam; capture and barcode decoding must run on the local client or through an explicitly implemented local bridge. Camera tools must be registered in the actual ElevenLabs conversation page, not an unrelated browser tab.

## Product images

Use a clean online catalog image for inventory cards when available, not a screenshot of the donor holding the item.

- Prefer a barcode-based Open Food Facts product image.
- If only visual/text details are available, first match a product catalog entry using brand, name, flavor and size. Cache it after confirmation. Any additional search provider must be explicitly configured; Gemini must not invent image URLs.
- Store image URL, source page/provider and match method. Follow source attribution requirements.
- Label generic images as generic. A generic apple image is not proof of a particular brand or item.
- If no verified image is found, use a placeholder or optional cropped observation image. Background removal is optional and must not block check-in.
- Keep **catalog/display image** separate from an optional **observation snapshot**. Do not retain donor images by default; if evidence snapshots are enabled, crop to the item where practical and define retention.

## Donation state and inventory

Front recognition creates a **proposal**, not an inventory increase. Store the identification method (`gemini`, `barcode`, `manual`) and proposed quantity. Ask for confirmation after placement, then record a donor-confirmed donation event. This is not camera-verified placement. Do not issue Solana rewards based only on recognition or verbal confirmation; expose a separate integration point for the team's verification policy.

Use stable product IDs, barcode IDs where available and idempotent event IDs. Track states such as proposed, donor-confirmed and reconciled. Do not overwrite inventory blindly with each model response or count the same donation twice.

## Rear-camera automatic inventory audits

- Initial audit after setup, then hourly normal cadence and a clearly labeled configurable fast demo cadence (for example 30 seconds).
- Capture a fresh Logitech frame per audit. Gemini returns visible food, counts when discernible, qualitative certainty, image quality and limitations.
- Save results to Tiger Data and update the app automatically after each successful audit.
- Compare with the last usable baseline. Record additions/decreases as observations that may require review. Legitimate pickups, occlusion and changing labels can explain differences; never automatically accuse someone of theft.
- Dark, blocked or unusable frames must not erase stock or become a fake empty fridge.
- Serialize/bound requests and prioritize donor interaction; do not queue unlimited stale images. Retry temporary failures with bounded backoff and show quota/access problems without repeated failing calls.
- Handle permissions, unplug/reconnect, backend outage, restart and stale data. Show last success, next audit and running/paused/error state.
- One scheduler owner per fridge; avoid duplicate loops in multiple tabs or clients.

Be honest about operation: browser scheduling requires the local camera page/backend running on an awake Mac and can be delayed in hidden tabs. For reliable unattended operation implement a local capture worker with reconnect/restart behavior. Cloud cron or Vercel alone cannot access a local USB webcam. Do not claim unattended operation without testing it.

## Tiger Data integration

Tiger Data will be our central database. Its account onboarding is in progress; do not assume a service or working credentials already exists. Prepare migrations and environment placeholders now, and connect once Saleh supplies credentials privately.

Use:

- A TimescaleDB hypertable for timestamped Arduino readings: fridge/device ID, temperature, raw moisture, raw air-quality value and validity/calibration metadata.
- Relational tables for products, donation proposals/events, inventory events and audit records/results.
- Product records with barcode, canonical name, brand/variant/size, image URL/source and identification/match method.
- Audit records with fridge ID, time, image quality, structured model output and reviewable differences.

Use private `TIGER_DATABASE_URL` in the backend. Browser/Arduino never receive database credentials. A separate local serial bridge forwards Arduino readings to the authenticated backend; coordinate its contract with the sensor teammate instead of rewriting their firmware. Raw moisture/air-quality values are not humidity percentages or food-safety scores.

Store retained image files in object/file storage and their references in Tiger Data; database records should not contain every raw video frame. Reuse the team's shared backend and agree on one inventory source of truth. Tiger CLI/MCP is a development tool, not the app's runtime connection.

## Security and API boundaries

Keep `GEMINI_API_KEY` and database credentials server-side, outside Git. Supply blank `.env.example` entries; Saleh enters secrets privately. Never print existing secrets or put them in `NEXT_PUBLIC_`/`VITE_` variables. Keep ElevenLabs private API credentials server-side while following the existing agent authentication flow.

Validate image format/size, barcode format, quantity, language and Gemini output. Authenticate publicly reachable endpoints and rate-limit costly calls. Use configured catalog endpoints and validated provider results rather than fetching arbitrary user/model-supplied URLs. Sanitize errors. No new paid services or billing activation without asking.

Suggested contracts, adapted to existing app conventions:

- `POST /identify`: front image + language → structured proposal.
- `GET /products/barcode/:code`: validated barcode → catalog match or explicit not-found.
- `POST /donations/confirm`: proposal + quantity + idempotency key → donation event.
- `POST /inventory/audits`: rear frame → saved audit and reviewable comparison.
- Inventory/history read endpoints and app update mechanism using the existing stack.

## Acceptance tests and delivery

Demonstrate these before declaring completion:

1. Two distinct physical cameras with correct roles.
2. Existing ElevenLabs conversation → Gemini front identification → spoken answer in the selected language.
3. Ambiguous product → ElevenLabs clarification → barcode scan → catalog details/image → donor confirmation.
4. Gemini unavailable but barcode lookup still works; missing barcode/catalog entry gets a useful fallback.
5. Non-food rejection, unknown quantities and uncertain product matches handled honestly.
6. At least three automatic rear audits in demo mode, with add/remove changes saved and displayed without manual Audit clicks.
7. Blocked frame preserves the last usable inventory and indicates uncertainty/staleness.
8. Duplicate donation submission and multiple-tab scheduling do not double-count/duplicate work.
9. Database persistence and safe restart; no secrets in Git or browser code.

Use mocks for failure cases, but label mocked tests separately from physical camera, live Gemini, live catalog and ElevenLabs tests. If credentials block a live test, finish all independent implementation and identify the exact missing step.

Finish with startup commands, required environment variable names, migrations, ElevenLabs tool schemas/dashboard instructions, API contracts, test results and honest remaining limitations. Stay focused on camera, barcode, voice and inventory integration; avoid an unrelated UI redesign or rebuilding teammates' sensor/Solana modules.

## Official references

- ElevenLabs client tools: https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools
- ElevenLabs JavaScript SDK: https://elevenlabs.io/docs/eleven-agents/libraries/java-script
- ElevenLabs React SDK: https://elevenlabs.io/docs/eleven-agents/libraries/react
- Open Food Facts barcode lookup: https://openfoodfacts.github.io/documentation/docs/Product-Opener/v2/products/get-product-by-code/
- Tiger Data service creation: https://www.tigerdata.com/docs/get-started/quickstart/create-service
- Tiger Data hypertables: https://www.tigerdata.com/docs/learn/hypertables/creating-and-configuring-hypertables
