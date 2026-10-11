# Nourish sensor conditions / ElevenLabs handoff

Implemented in the existing Tiger Data backend. Raw measurements remain saved in
`fridge.sensor_readings`; condition flags are calculated from those measurements
on request. They are not a separately persisted alert/event log.

## Partner integration

From your backend, poll `GET /fridges/orion-fridge-01/conditions` every two seconds
on the local data API (`http://127.0.0.1:3200`). Use the existing private
`DATA_API_TOKEN` in the Authorization Bearer header, supplied through your own
server environment. Do not put it in front-end code or GitHub. Localhost refers
to the Mac running this service; a teammate's machine needs its own service or
an explicitly configured authenticated network bridge.

The response includes `conditions`, `alerts`, `channels`,
`monitoring_confidence_percent`, `status`, and `last_reading_at`. Alert keys:
`temperature`, `moisture`, `air`, `movement`. States: `normal`, `pending`, `alert`,
`unknown`. React to changes into `alert`; do not repeat speech every poll. Keep
the previous state for each key and apply a speech cooldown. `since` is the
start of the observed run within the bounded query window, not a durable event
ID or the original incident onset. Do not deduplicate on that timestamp.

Example ElevenLabs speech:

- Temperature: "The temperature has risen above our demo baseline. Please check the cooling."
- Moisture: "The contact sensor is wet. Please check for a leak or spill."
- Air: "The air sensor has changed. Please inspect the fridge."
- Movement: "Movement was detected. Please check the fridge."
- Unknown: "Sensor monitoring is unavailable."

Speech is not connected by this module; the partner's ElevenLabs application
must consume this endpoint. The local `/monitor` page already displays alerts
without asking for a token.

## Score meaning

`monitoring_confidence_percent` = 100 × fully monitored seconds / 300 seconds.
An interval counts only when all four channels have valid endpoints, at most
15 seconds apart. Unobserved tails and longer gaps do not count. Each channel
also reports its own coverage. Current readings older than 20 seconds produce
`unknown` conditions, even if historical coverage is high. A high percentage
means data completeness, not a probability of safe food or correct diagnosis.

## Demo calibration

`condition-baseline.json` stores a provisional pre-unplug reference from 174
actual readings, 03:47–03:50 UTC on October 11 (October 10 local time):

| Channel | Reference | Trigger | Persistence |
|---|---:|---:|---|
| Temperature | −17.2 °C | ≥ −15.2 °C (+2 °C rise) | 5 seconds |
| Contact moisture | 0 raw | ≥ 10 raw | 2 seconds |
| Air sensor | 51 raw | ≥ 81 raw | 2 seconds |
| Accelerometer motion peak | quiet peak ≤ 0.208 g | > 0.20 g | one reading, held 10 seconds |

Thresholds are explicit demo settings, not scientifically validated food safety
limits. Firmware motion flag still uses 0.2 g; this endpoint uses
the raw motion peak with a strictly greater than 0.20 g threshold, lowered at
Saleh's request. The quiet peak of 0.208 g can trigger this setting; sensitivity
is higher but false alarms are possible.
Air only alerts on an increase: lower raw readings do not mean worse quality.
The moisture sensor measures wet contact, not relative humidity. The sensor is
an accelerometer, not a gyro, and a bump does not prove theft. Constant-speed
rolling may produce little acceleration; start/stop and tilt are better tests.

Test each trigger physically before judging. Tape the accelerometer rigidly to
the fridge body, rather than letting its cable swing. Put a small drop on the
moisture probe's exposed sensing area, keeping connectors/electronics dry. For
the air demo bring a sanitizer-damp tissue near the sensor away from food; do
not spray directly into the fridge or onto electronics. Check that normal
readings resume after removing each stimulus.

Moisture wet-trigger test confirmed: dry baseline 0; wet-contact readings
37–118 raw, with the alert activated at 10 or higher for two seconds.
Keep 10 as the wet-alert threshold, per Saleh's preference. Values 1–9 may
indicate slight contact wetness but do not trigger the alert. Dry recovery
was confirmed at raw 0; this is not a humidity calibration.

If demonstrating an operational room-temperature fridge instead of this
freezer, the freezer baseline must be replaced after collecting a new normal
reference. Edit the baseline/threshold configuration and restart the data API;
do not stop the serial uploader. No auto-rebaselining occurs during a fault.

Temperature exposure calculations remain available at the separate `/thermal`
endpoint, using its independently configured absolute threshold. Changing that
page's thermal threshold does not change these relative demo alert thresholds.

Air vapor test confirmed: pre-test raw 41–42, peak 260, alert triggered at
81 for two seconds, then cleared after removal with recovery raw 48.
This verifies vapor response and alert clearance, not spoilage detection.

Cart movement trials: gentle roll peaked at 0.172 g (no trigger); a quicker
controlled start/stop peaked at 0.269 g at 04:47:11.895 UTC and crossed the
0.25 g trigger once. By the follow-up check, the ten-second alert hold had
expired and latest motion was 0.135 g. The threshold crossing is saved; the
live alert was not visually observed during this test. Smooth rolling remains
a limitation; do not advertise reliable whole-fridge theft detection.
