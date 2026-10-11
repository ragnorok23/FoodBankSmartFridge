export function parseSensorLine(line) {
  const [base,...suffix]=line.split(/\s*\|\s*(?=Accel)/);
  const match=base.trim().match(/^Temperature:\s*(-?\d+(?:\.\d+)?)\s*C\s*\/\s*-?\d+(?:\.\d+)?\s*F\s*\|\s*Moisture raw:\s*(\d+)\s*\|\s*Air raw:\s*(\d+)\s*$/);
  if (!match) return null;
  const [temperature_c,moisture_raw,air_quality_raw]=match.slice(1).map(Number);
  if (temperature_c < -40 || temperature_c > 85 || moisture_raw > 1023 || air_quality_raw > 1023) return null;
  const reading={temperature_c,moisture_raw,air_quality_raw};
  if (!suffix.length) return reading;
  if (suffix.length !== 1) return null;
  if (suffix[0].trim()==='Accel: unavailable') return {...reading,accelerometer_available:false};
  const motion=suffix[0].trim().match(/^Accel g:\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*\|\s*Motion peak g:\s*(\d+(?:\.\d+)?)\s*\|\s*Motion:\s*([01])$/);
  if (!motion) return null;
  const [x,y,z,peak,detected]=motion.slice(1).map(Number);
  if ([x,y,z].some(v=>Math.abs(v)>1.6) || peak>6) return null;
  return {...reading,accelerometer_available:true,acceleration_g:{x,y,z},motion_peak_g:peak,movement_detected:!!detected};
}
