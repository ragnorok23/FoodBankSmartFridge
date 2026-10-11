import {thermalMetrics} from './thermal-math.js';
// Existing sensor_fridge_time index bounds the scan. Include one point each side
// for clipping at window boundaries; keep invalid points to break coverage.
export async function getThermalMetrics(pool,{fridgeId,deviceId,start,end,thresholdC,maxGapSeconds,staleSeconds}) {
  const result=await pool.query(`
    WITH before_window AS (
      SELECT captured_at FROM fridge.sensor_readings
      WHERE fridge_id=$1 AND device_id=$2 AND captured_at<$3 AND COALESCE(metadata->>'recording_phase','monitoring')<>'cooldown'
      ORDER BY captured_at DESC LIMIT 1
    ), after_window AS (
      SELECT captured_at FROM fridge.sensor_readings
      WHERE fridge_id=$1 AND device_id=$2 AND captured_at>$4 AND COALESCE(metadata->>'recording_phase','monitoring')<>'cooldown'
      ORDER BY captured_at ASC LIMIT 1
    )
    SELECT captured_at,temperature_c FROM fridge.sensor_readings
    WHERE fridge_id=$1 AND device_id=$2 AND COALESCE(metadata->>'recording_phase','monitoring')<>'cooldown' AND
      (captured_at BETWEEN $3 AND $4 OR captured_at=(SELECT captured_at FROM before_window)
       OR captured_at=(SELECT captured_at FROM after_window))
    ORDER BY captured_at ASC LIMIT 150001`,[fridgeId,deviceId,start,end]);
  if(result.rowCount>150000){const error=new Error('Reduce observation window');error.code='METRICS_WINDOW_TOO_LARGE';throw error;}
  return {fridge_id:fridgeId,device_id:deviceId,...thermalMetrics(result.rows,{start,end,thresholdC,maxGapSeconds,staleSeconds})};
}
