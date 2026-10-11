// UNO R4 WiFi: SPA06 0x77 + Grove MMA7660FC 0x4C, 3.3V Grove shield.
// Local motion diagnostics only; database collection is controlled separately.
// Do NOT use Wire.begin(): this test never drives SDA/SCL HIGH and
// never enables internal pull-ups. External pull-ups must be to 3.3V.
// ADC voltage estimates are approximate, not a substitute for a multimeter.
const int DATA_PIN = A4;
const int CLOCK_PIN = A5;

void releaseLine(int pin) {
  digitalWrite(pin, LOW);
  pinMode(pin, INPUT);
}
void lowLine(int pin) {
  digitalWrite(pin, LOW);
  pinMode(pin, OUTPUT);
}
bool raiseClock() {
  releaseLine(CLOCK_PIN);
  unsigned long start = micros();
  while (!digitalRead(CLOCK_PIN)) {
    if (micros() - start > 2000) return false;
  }
  delayMicroseconds(20);
  return true;
}
void stopBus() {
  lowLine(CLOCK_PIN);
  lowLine(DATA_PIN);
  delayMicroseconds(20);
  raiseClock();
  releaseLine(DATA_PIN);
  delayMicroseconds(20);
}
bool probeAddress(byte address) {
  releaseLine(DATA_PIN);
  if (!raiseClock() || !digitalRead(DATA_PIN)) return false;
  lowLine(DATA_PIN);
  delayMicroseconds(20);
  lowLine(CLOCK_PIN);
  byte value = address << 1;
  for (int bit = 7; bit >= 0; bit--) {
    if (value & (1 << bit)) releaseLine(DATA_PIN);
    else lowLine(DATA_PIN);
    delayMicroseconds(20);
    if (!raiseClock()) { stopBus(); return false; }
    lowLine(CLOCK_PIN);
  }
  releaseLine(DATA_PIN);
  delayMicroseconds(20);
  if (!raiseClock()) { stopBus(); return false; }
  bool acknowledged = !digitalRead(DATA_PIN);
  lowLine(CLOCK_PIN);
  stopBus();
  return acknowledged;
}
float voltage(int pin) {
  analogRead(pin);
  long total = 0;
  for (int i = 0; i < 10; i++) total += analogRead(pin);
  releaseLine(pin);
  return (total / 10.0f) * (5.0f / 1023.0f);
}

// Register definitions/calibration follow Seeed's referenced SPL07 library:
// https://github.com/Kenneract/SPL07-003-Arduino-Library
const byte ADDRESS = 0x77;
int c0, c1;
bool initialized = false;
bool startBus() {
  releaseLine(DATA_PIN);
  if (!raiseClock() || !digitalRead(DATA_PIN)) return false;
  lowLine(DATA_PIN); delayMicroseconds(20); lowLine(CLOCK_PIN);
  return true;
}
bool sendByte(byte value) {
  for (int bit = 7; bit >= 0; bit--) {
    if (value & (1 << bit)) releaseLine(DATA_PIN); else lowLine(DATA_PIN);
    delayMicroseconds(20);
    if (!raiseClock()) return false;
    lowLine(CLOCK_PIN);
  }
  releaseLine(DATA_PIN); delayMicroseconds(20);
  if (!raiseClock()) return false;
  bool ack = !digitalRead(DATA_PIN);
  lowLine(CLOCK_PIN);
  return ack;
}
bool receiveByte(byte &value, bool ack) {
  value = 0; releaseLine(DATA_PIN);
  for (int bit = 0; bit < 8; bit++) {
    if (!raiseClock()) return false;
    value = (value << 1) | digitalRead(DATA_PIN);
    lowLine(CLOCK_PIN); delayMicroseconds(20);
  }
  if (ack) lowLine(DATA_PIN); else releaseLine(DATA_PIN);
  if (!raiseClock()) return false;
  lowLine(CLOCK_PIN); releaseLine(DATA_PIN);
  return true;
}
bool readRegistersAt(byte address, byte reg, byte *data, int count) {
  bool ok = startBus() && sendByte(address << 1) && sendByte(reg)
    && startBus() && sendByte((address << 1) | 1);
  for (int i = 0; ok && i < count; i++) ok = receiveByte(data[i], i < count - 1);
  stopBus(); return ok;
}
bool readRegisters(byte reg, byte *data, int count) { return readRegistersAt(ADDRESS, reg, data, count); }
bool writeRegisterAt(byte address, byte reg, byte value) {
  bool ok = startBus() && sendByte(address << 1) && sendByte(reg) && sendByte(value);
  stopBus(); return ok;
}
bool writeRegister(byte reg, byte value) { return writeRegisterAt(ADDRESS, reg, value); }
int signed12(int value) { return (value & 0x800) ? value - 4096 : value; }
bool initializeTemperature() {
  byte id, status, coef[3];
  if (!readRegisters(0x0D, &id, 1)) return false;
  Serial.print("Sensor ID: 0x"); Serial.println(id, HEX);
  if (id != 0x11) { Serial.println("Unexpected sensor ID; no configuration written."); return false; }
  if (!writeRegister(0x0C, 0x09)) return false;
  unsigned long started = millis();
  do {
    delay(10);
    if (!readRegisters(0x08, &status, 1)) return false;
    if (millis() - started > 1000) return false;
  } while ((status & 0xC0) != 0xC0);
  if (!readRegisters(0x10, coef, 3)) return false;
  c0 = signed12((int(coef[0]) << 4) | (coef[1] >> 4));
  c1 = signed12(((int(coef[1]) & 0x0F) << 8) | coef[2]);
  if (c0 == 0 && c1 == 0) return false;
  // 4 Hz, one sample (scale factor 524288), continuous temperature only.
  return writeRegister(0x07, 0x20) && writeRegister(0x09, 0) && writeRegister(0x08, 0x06);
}
int analogAverage(int pin) {
  analogRead(pin);
  long total = 0;
  for (int i = 0; i < 10; i++) total += analogRead(pin);
  return total / 10;
}
// MMA7660FC registers and 21 LSB/g conversion follow Seeed's official
// Accelerometer_MMA7660 library. Keep the existing open-drain bus implementation.
const byte ACCEL_ADDRESS = 0x4C;
bool accelInitialized = false, accelValid = false, previousValid = false;
float ax = 0, ay = 0, az = 0, previousX = 0, previousY = 0, previousZ = 0;
float motionPeak = 0;
unsigned long lastAccelAttempt = 0, lastReport = 0;
const float MOTION_THRESHOLD_G = 0.20f; // Provisional; tune on mounted fridge.
bool initializeAccelerometer() {
  if (!probeAddress(ACCEL_ADDRESS)) return false;
  return writeRegisterAt(ACCEL_ADDRESS, 0x07, 0x00) // standby
    && writeRegisterAt(ACCEL_ADDRESS, 0x08, 0x02) // 32 samples/sec
    && writeRegisterAt(ACCEL_ADDRESS, 0x07, 0x01); // active
}
int signed6(byte value) { return (value & 0x20) ? int(value & 0x3F) - 64 : int(value & 0x3F); }
void sampleAccelerometer() {
  if (!accelInitialized) {
    if (millis() - lastAccelAttempt < 2000) return;
    lastAccelAttempt = millis();
    accelInitialized = initializeAccelerometer();
    Serial.println(accelInitialized ? "MMA7660 at 0x4C: connected" : "MMA7660 at 0x4C: unavailable");
    return;
  }
  byte values[3];
  // Alert bit means a conversion overlapped the read: retry a bounded number.
  for (int attempt = 0; attempt < 3; attempt++) {
    if (!readRegistersAt(ACCEL_ADDRESS, 0x00, values, 3)) {
      accelInitialized = accelValid = previousValid = false; return;
    }
    if ((values[0] | values[1] | values[2]) & 0x40) { delay(1); continue; }
    ax = signed6(values[0]) / 21.0f;
    ay = signed6(values[1]) / 21.0f;
    az = signed6(values[2]) / 21.0f;
    if (previousValid) {
      float dx = ax - previousX, dy = ay - previousY, dz = az - previousZ;
      float change = sqrtf(dx*dx + dy*dy + dz*dz);
      if (change > motionPeak) motionPeak = change;
    }
    previousX = ax; previousY = ay; previousZ = az;
    previousValid = accelValid = true; return;
  }
  accelValid = previousValid = false;
}
void setup() {
  releaseLine(DATA_PIN); releaseLine(CLOCK_PIN);
  analogReadResolution(10); Serial.begin(115200);
}
void loop() {
  float dataV = voltage(DATA_PIN), clockV = voltage(CLOCK_PIN);
  if (dataV < 2.8f || dataV > 3.6f || clockV < 2.8f || clockV > 3.6f) {
    Serial.print("Bus voltage check failed. SDA: "); Serial.print(dataV);
    Serial.print(" SCL: "); Serial.println(clockV);
    initialized = false; delay(2000); return;
  }
  sampleAccelerometer();
  delay(40);
  if (millis() - lastReport < 1000) return;
  lastReport = millis();
  if (!initialized) {
    initialized = initializeTemperature();
    if (!initialized) { Serial.println("Temperature initialization failed."); delay(2000); return; }
    delay(300);
  }
  byte status, raw[3];
  if (!readRegisters(0x08, &status, 1)) {
    initialized = false; Serial.println("Temperature communication failed."); delay(1000); return;
  }
  if (status & 0x20) {
    if (!readRegisters(0x03, raw, 3)) { initialized = false; return; }
    int32_t value = (int32_t(raw[0]) << 16) | (int32_t(raw[1]) << 8) | raw[2];
    if (value & 0x800000) value -= 0x1000000;
    float tempC = c0 * 0.5f + c1 * (value / 524288.0f);
    if (tempC < -40 || tempC > 85) {
      Serial.println("Temperature outside sensor range; check calibration/connection.");
    } else {
      Serial.print("Temperature: "); Serial.print(tempC, 2);
      Serial.print(" C / "); Serial.print(tempC * 1.8f + 32, 2);
      Serial.print(" F | Moisture raw: "); Serial.print(analogAverage(A0));
      Serial.print(" | Air raw: "); Serial.print(analogAverage(A1));
      if (accelValid) {
        Serial.print(" | Accel g: "); Serial.print(ax, 3); Serial.print(",");
        Serial.print(ay, 3); Serial.print(","); Serial.print(az, 3);
        Serial.print(" | Motion peak g: "); Serial.print(motionPeak, 3);
        Serial.print(" | Motion: "); Serial.print(motionPeak >= MOTION_THRESHOLD_G ? 1 : 0);
        motionPeak = 0;
      } else Serial.print(" | Accel: unavailable");
      Serial.println();
    }
  } else Serial.println("Waiting for fresh temperature reading...");
}
