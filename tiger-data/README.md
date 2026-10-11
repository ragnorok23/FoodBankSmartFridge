# Tiger Data — working fridge database module

Database created: **foodbank-smart-fridge**, service `ym0p9v6xv2`, project `szwh1q76nh`, free shared DEV service, TimescaleDB enabled. No paid compute or billing activation was selected. Region: us-east-1.

## What is ready

- Tables in the `fridge` schema for fridges, timestamped sensor readings, products, donation proposals, inventory events and camera audits.
- TimescaleDB sensor hypertable and five-minute sensor aggregation view.
- Inventory balances computed from confirmed events. Camera audits are observations requiring review; they never blindly overwrite stock.
- Local data API on `127.0.0.1:3200`, with a private bearer token for all data operations. `/health` only reports connectivity.
- Local USB serial bridge parses the actual Arduino sketch's output and saves real sensor readings at most once every five seconds.
- Private `.env`, mode 600, contains a restricted app database login. It cannot create/drop tables or delete rows; admin credentials stay in the Tiger CLI keyring.
- Project-local Cursor Tiger MCP configuration and FOODBANK.code-workspace tasks. MCP uses the CLI's account authorization, selects this service by default, and blocks writes to PROD services. The service selection is not an organization-wide permission boundary.

## Start in Cursor

Saleh's current demo configuration uses `SENSOR_INTERVAL_MS=1000` in the private `.env`, verified at roughly 1.03 seconds between stored readings. The default remains 5000 for other checkouts. Timestamps represent when a valid serial line arrives, rather than when its database write finishes. Increasing the save rate adds temporal detail, not independent experimental duration; missing data is still not filled in. Unparsed Arduino diagnostics are now logged locally at most once every 15 seconds to help distinguish sensor/bus faults from silence.

For an initial stable baseline, run `npm run sensors -- --wait-stable` with `.sensor-paused` removed. It monitors locally without database writes until a full five-minute window has temperature range ≤0.5°C, absolute least-squares trend ≤0.1°C/min and no sample gaps over 15 seconds. These are provisional engineering settings, not a validated fridge specification. Once the initial gate passes, all later temperatures are recorded, including genuine excursions; unstable readings must not be censored during normal monitoring. Disconnects/missing samples restart the initial window. Existing startup readings have `metadata.recording_phase='cooldown'` and are excluded from the thermal endpoint, but remain in the raw sensor table. New readings are tagged `stable_baseline` with a baseline start timestamp. The live view shows when the local gate is waiting. Historical coverage shown is coverage of the selected baseline data, not of excluded startup measurements.

Collection on Saleh's Mac is deliberately paused until the sensors are in the fridge and he says **ready**. A local ignored `.sensor-paused` file blocks bridge startup and further writes. Keep it in place during bench testing. To pause an existing bridge, create this file and stop the bridge; an already in-flight write may finish. Remove the file only when explicitly ready to collect, then start the sensor task. `npm run verify` performs temporary database writes, so do not run that task when all database writes must stay paused.

Open `FOODBANK.code-workspace`. Run tasks through Terminal → Run Task:

1. **Tiger: verify database** — real database writes/reads inside a transaction that rolls back all test rows.
2. **Tiger: run data API** — local authenticated storage API.
3. **Tiger: list Arduino ports** — find the USB Arduino path.
4. Put that exact path in private `tiger-data/.env` as `SERIAL_PORT`. Close Arduino Serial Monitor first.
5. **Tiger: stream Arduino sensors** — continuous writes while Mac/USB/network are available. The bridge has no durable offline buffer; missed readings during database outages are not replayed.

Equivalent commands from `tiger-data`: `npm run verify`, `npm start`, `npm run ports`, `npm run sensors`.

Expected firmware line:
```
Temperature: 22.50 C / 72.50 F | Moisture raw: 0 | Air raw: 20
```
Diagnostics are skipped. Moisture and air-quality readings remain raw/unvalidated, not relative humidity, an AQI or a food safety verdict. Ingest timestamps currently come from the Mac. The firmware emits ADC values 0–1023.

## Accelerometer / movement diagnostics

`hardware/fridge_all_sensors/fridge_all_sensors.ino` adds the Grove MMA7660FC (±1.5g, v1.3) on I²C address `0x4C` alongside the SPA06 at `0x77`. It preserves the existing open-drain A4/A5 bus and does not enable 5V internal pull-ups. No extra Arduino library is required. MPU6050/ADXL345 libraries are not for this sensor.

Connect via a spare Grove I²C socket with the shield at 3V3, power disconnected while wiring. Secure the sensor firmly to the main fridge body with an insulated mount, away from water/condensation; leave INT unused. Do not mount on the door or a loose shelf.

The firmware samples acceleration roughly 20 times/sec and appends diagnostics to the once/sec temperature line:
```
 | Accel g: 0.048,-0.048,1.048 | Motion peak g: 0.151 | Motion: 0
```
X/Y/Z include gravity: around 1g on the vertical axis at rest is normal. `motion_peak_g` is the largest consecutive-sample vector change, not speed/distance. The provisional 0.20g threshold flags movement only; it is not an armed theft alarm, and slow smooth rolling may be missed. Tune against stationary compressor operation, door opening and deliberate rolling after mounting. Do not claim theft detection until those physical tests and an explicit armed/disarmed workflow are implemented.

Once collection is resumed, the bridge stores `accelerometer_available`, `acceleration_g`, `motion_peak_g`, `movement_detected`, `motion_threshold_g`, and `motion_status` inside each sensor row's existing `metadata` JSON. It accumulates peaks/flags between five-second writes, including short bumps between saved readings. No table migration is needed. Missing accelerometer data is marked unavailable rather than fabricated as zero. The sensors API already returns the metadata for teammate integration. There are no motion notifications yet, and no durable offline buffering.

## Teammate integration

Thermal mathematics and the monitoring page are implemented: see [MATH-HANDOFF.md](MATH-HANDOFF.md). Read-only authenticated `GET /fridges/:id/thermal` computes observed degree-minute exposure, above-threshold duration, monitoring coverage, longest gap, staleness and time-weighted mean from actual Tiger timestamps. `http://127.0.0.1:3200/monitor` provides a live view without starting sensor uploads. Integrate the same endpoint into the teammate's final dashboard through their backend.

Use the data API from your **backend**, not by placing its bearer token in browser bundles. Each request needs `Authorization: Bearer <DATA_API_TOKEN>` and JSON Content-Type for writes. No permissive CORS is enabled. For a remote frontend, connect through an authenticated backend/local bridge design; this API binds localhost and is not a hosted teammate-accessible server.

- `POST /products`: `canonical_name`, optional barcode/brand/variant/package_size, `display_image_url`, `image_source_url`, `match_method` (`barcode`, `visual`, `manual`, `generic`), optional metadata. Returns product ID. Barcode lookup is implemented by the camera teammate; this endpoint stores its verified result. Barcode must remain a string. Same barcode updates its product record; reuse product IDs for non-barcoded items.
- `POST /donations/propose`: client-generated UUID `id`, `fridge_id`, `product_id`, integer `quantity`, `identification_method` (`gemini`, `barcode`, `manual`), `certainty` (`high`, `medium`, `low`, `unknown`), optional observation image URL/details. Same proposal ID is idempotent and does not create stock.
- `POST /donations/confirm`: `proposal_id`. Transaction locks proposal and creates at most one donation event even on retries. Returns donor-confirmed status, explicitly `camera_verified:false`. Verbal confirmation is not sufficient for reward verification.
- `POST /inventory/audits`: client-generated UUID `id`, `fridge_id`, ISO `captured_at`, `image_quality` (`usable`, `limited`, `unusable`), `model`, structured `result`, optional `comparison` and observation image URL. Saves observation without changing recorded stock. Audit item schema is the camera service's responsibility; this storage endpoint validates the envelope.
- `GET /fridges/orion-fridge-01/inventory`: recorded balances and product display images.
- `GET /fridges/orion-fridge-01/audits`: latest 100 observations.
- `GET /fridges/orion-fridge-01/sensors`: latest 100 readings.

The UI must fetch/update after successful calls, or the teammate must implement their existing subscription/polling mechanism. The data module does not implement ElevenLabs, Gemini calls, barcode scanning, camera scheduling, stock reconciliation, pickups, operator adjustments or object storage. It provides storage boundaries for those modules; do not claim those features are finished.

Schema supports pickup/adjustment events, but no HTTP endpoint yet exposes them. Before adding them, enforce stock policy and operator authentication; do not allow uncontrolled negative balances. Counts from rear vision may be partial and should be reconciled explicitly.

## SQL for judges/dashboard

```sql
SELECT * FROM fridge.sensor_five_minute
WHERE fridge_id='orion-fridge-01'
ORDER BY bucket DESC LIMIT 100;

SELECT * FROM fridge.inventory_balances
WHERE fridge_id='orion-fridge-01';

SELECT captured_at,image_quality,result,comparison
FROM fridge.camera_audits
WHERE fridge_id='orion-fridge-01'
ORDER BY captured_at DESC LIMIT 20;
```

## Secrets, TLS and teammates

Never commit `.env`, print its connection string/token or give the restricted app credentials to the frontend. Share credentials privately only with teammates who need server access; each teammate can instead create their own Tiger login. `tiger-ca.crt` is a public certificate authority pin for this module; it is not a password. The private URL uses verified TLS with hostname checking and a local CA file path. On another machine set its `sslrootcert` path to that machine's copy of this certificate file.

`setup-private.js` was used once locally to create `fridge_app`; it refuses to overwrite existing credentials/roles. Do not rerun it as a teammate provisioning mechanism. `npm run migrate` requires an admin connection; the restricted app login intentionally cannot run migrations. Use `tiger db query ym0p9v6xv2 --file tiger-data/migrations/001_fridge.sql` from the repo root with an authorized admin CLI.

Restart/reload Cursor's MCP connection if Tiger is not listed. MCP authenticates with your CLI account, not the app's private database role. No keys are embedded in the MCP config.

## Verification

Database verification covers real sensor/product/donation/audit writes, duplicate donation prevention and preservation of recorded inventory on an unusable audit. All test writes are rolled back. Parser tests verify the real sketch format and reject diagnostics/out-of-range values. Physical live ingestion requires the Arduino to be connected and the serial monitor closed; check saved timestamps rather than assuming the bridge is receiving data.
