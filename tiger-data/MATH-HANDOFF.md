# Nourish: thermal exposure + monitoring coverage

Two useful mathematical features are implemented in the existing Tiger Data module. Sensor collection remains paused until Saleh says **ready**; no test readings were inserted into Tiger Data for this work.

## Implemented mathematics

For consecutive valid samples `(t0,T0)` and `(t1,T1)`, assume linear temperature **only if the gap is at most 15 seconds** (configurable). Clip the interval to the requested observation window. Use seconds internally and divide integrals by 60 to obtain minute units.

Let `u=T0-L`, `v=T1-L`, and `d` be the clipped interval duration in minutes, where `L` is the configured temperature threshold.

- If both endpoints exceed the threshold: exposure `E=d(u+v)/2`, above-threshold duration `A=d`.
- If both are at or below the threshold: `E=A=0`.
- If the interval crosses the threshold: `p=max(u,v)`, `f=p/abs(v-u)`, `A=d*f`, `E=d*f*p/2`.

The crossing formula integrates a triangle exactly under the linear assumption; trapezoidal integration of already-clipped positive endpoints would overestimate exposure for a crossing.

Sum interval exposure to get **observed °C·minutes** and sum `A` to get **observed minutes above threshold**. This is a temperature excursion metric, never a validated food-safety or spoilage probability. Default `L=4°C` is an explicit, configurable operational setting, not a claim about a specific product.

Coverage `C = sum(covered interval durations) / observation duration`. Longest missing interval is the longest connected stretch outside those covered intervals, including window edges. Time-weighted mean `Tbar = sum(d*(T0+T1)/2) / sum(d)` over covered intervals only.

## Assumptions and edge cases

- Irregular timestamps are used directly; no fixed five-second interval is assumed.
- No interpolation across gaps exceeding the configured limit and no extrapolation before/after available samples.
- Invalid/null/non-finite/out-of-range temperature samples interrupt coverage. Values outside [-40,85]°C are invalid for this sensor pipeline; unusual but in-range temperatures are retained rather than silently discarded.
- Identical duplicate timestamps collapse; conflicting duplicates invalidate that point.
- One device is selected per calculation, so independent sensors are never interleaved.
- Latest valid sample older than 20 seconds (configurable) is marked stale. Invalid latest readings and no data have separate states.
- With zero coverage, the API's observed integral is zero **over an empty measured domain**; the UI displays **Unknown**, not zero exposure or a safe condition. Mean temperature is null.
- Missing intervals have unknown exposure. Report coverage beside exposure; never rank partially observed items by exposure alone.
- This measures fridge-air temperature at the sensor, not food core temperature.
- The configured gap/stale limits are transparent monitoring policies, not statistically estimated probabilities.

## Integration

Files: `thermal-math.js` (pure algorithms), `thermal-query.js` (indexed, parameterized Tiger Data reads), `server.js` (authenticated endpoint), `public/monitor.html` + `monitor.js` (live display).

`GET /fridges/orion-fridge-01/thermal` with existing bearer auth. Optional parameters:

```
start=ISO_timestamp
end=ISO_timestamp
device_id=arduino-uno-r4
threshold_c=4
max_gap_seconds=15
stale_seconds=20
```

Default window: last hour. Maximum: seven days; requests exceeding 150,000 rows are rejected rather than truncated into plausible but wrong totals. Tiger's existing `(fridge_id,captured_at)` index supports bounded reads. The query includes one timestamp immediately before/after the window so short bracketing intervals can be clipped correctly. There is no new table, migration, synthetic stored data, paid service or extra dependency.

Response fields include `observed_exposure_c_minutes`, `observed_minutes_above_threshold`, `coverage_fraction`, `longest_missing_interval_minutes`, `unmonitored_minutes`, `time_weighted_temperature_c`, `sensor_status`, sample counts, last-valid timestamp/age, settings, assumptions, and covered chart segments.

Open `http://127.0.0.1:3200/monitor` with the data API running. The local page connects automatically with a short-lived, HttpOnly, SameSite=Strict cookie restricted by the server to same-origin thermal reads. No token prompt is needed and the backend token is never sent to the browser. All write endpoints still require backend bearer authorization. Auto-refresh reads metrics every ten seconds; it does not start sensor collection or write any data. This standalone monitoring view is ready; the camera teammate can reuse the endpoint in their final dashboard via their authenticated backend. The data API remains localhost-only.

## Validation

`npm test`: 10 analytical mathematics tests plus 4 sensor parser tests pass. Known answers include 6°C for two minutes above a 4°C threshold → 4°C·minutes; a 2→6°C linear ramp over two minutes → 1°C·minute and one minute above threshold. Tests cover descent, threshold equality, irregular timing, clipped boundaries, long/edge gaps, invalid samples, duplicate timestamps, empty data and stale/invalid status.

Read-only live checks verified the Tiger query and API's empty-data response, 401 without auth, 400 for invalid parameters/oversized time windows, and dashboard assets. Browser verification confirmed Unknown exposure/mean, 0% coverage, and no fabricated chart while collection is paused. No database verification script that inserts rows was run.

## Intentionally deferred

Inventory currently has donation/pickup/adjustment events, but no held/discarded workflow, lot-level identities, or reliable physical entry/exit evidence. Existing idempotent donation confirmation remains intact. A full accepted=available+held+picked_up+discarded invariant and redistribution rate would invent categories we do not currently record, so they were not added. Per-food thermal attribution needs confirmed lot entry/exit times; product-level timestamps alone are insufficient.

Rescue optimization, CUSUM, dew point, freshness percentages, and air-quality spoilage claims were skipped. Timescale `time_weight`/continuous aggregates are unnecessary for the current volume, and averaging temperature into buckets before applying the positive-part integral would lose crossings. Raw readings are therefore used for these metrics.

## Judge explanation (about 25 seconds)

“Nourish measures temperature history, not just the current temperature. We integrate how far the fridge exceeds a configurable threshold using actual timestamps, with exact threshold crossings between short-spaced readings. Alongside that, we calculate monitoring coverage and the longest data gap, so a disconnected sensor cannot masquerade as successful monitoring. The result is transparent temperature exposure in degree-minutes—not an invented food-safety score.”
