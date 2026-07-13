/**
 * AgriWeight - ESP32 Weight Scale Firmware (HX711_ADC + LCD 20x4)
 * 
 * Program ini membaca berat menggunakan HX711_ADC, menampilkan status
 * dan berat di LCD 20x4 I2C, dan mengirim data ke Firebase Realtime Database.
 * 
 * Logika pengiriman:
 * - Tare harus selesai dulu sebelum pembacaan berat dan timer diproses.
 * - Berat 0 -> data tidak dikirim.
 * - Berat > 0 -> mulai hitung mundur 20 detik.
 * - Beban diangkat sebelum 20 detik selesai -> timer reset ke awal.
 * - Setelah 20 detik penuh -> berat dikirim sekali ke Firebase, nilai dikunci.
 * - Nilai yang dikunci tetap tertampil sampai status berubah jadi selain "menimbang".
 * 
 * Library yang dibutuhkan:
 * 1. Firebase Arduino Client Library for ESP8266 and ESP32 (oleh Mobizt)
 * 2. HX711_ADC (oleh Olav Kallhovd)
 * 3. LiquidCrystal I2C
 */

#include <Arduino.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>

// Helper untuk token dan RTDB dari Firebase ESP Client
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// Library HX711_ADC
#include <HX711_ADC.h>
#if defined(ESP8266)|| defined(ESP32) || defined(AVR)
#include <EEPROM.h>
#endif

// Library LCD I2C
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// 1. KREDENSIAL WI-FI
#define WIFI_SSID "wuluh"
#define WIFI_PASSWORD "12345678"

// 2. CONFIG FIREBASE
#define API_KEY "AIzaSyAeubcrhuUalmJ1VE8V6jQlFarw0UkIlPY"
#define DATABASE_URL "https://agriweight-dd945-default-rtdb.firebaseio.com/"

// 3. FIREBASE AUTH
#define FIREBASE_EMAIL "admin@gmail.com"
#define FIREBASE_PASSWORD "12345678"

// 4. CONFIG DEVICE
#define DEVICE_ID "SCALE-01"

// 5. PIN HX711
const int HX711_dout = 18; // pin dout HX711
const int HX711_sck = 19;  // pin sck HX711

// 6. CALIBRATION FACTOR
const float calibrationValue = -22.37;

// 7. KONFIGURASI LOGIKA TIMBANG
const float weightThreshold = 0.01f;         // ambang batas dianggap "ada beban", dalam kg
const unsigned long weighingDuration = 20000; // durasi hitung sebelum kirim, dalam ms

// Objek HX711_ADC
HX711_ADC LoadCell(HX711_dout, HX711_sck);

// Objek LCD, alamat I2C 0x27, ukuran 20x4
LiquidCrystal_I2C lcd(0x27, 20, 4);

// Objek Firebase
FirebaseData fbdoStream;
FirebaseData fbdoWrite;
FirebaseAuth auth;
FirebaseConfig config;

const int calVal_eepromAdress = 0;
unsigned long t = 0;

// Path database Firebase
String parentPath = "/devices/" + String(DEVICE_ID);
String statusPath = parentPath + "/status";
String weightPath = parentPath + "/current_weight";
String onlinePath = parentPath + "/is_online";

// Status perangkat
bool isWeighing = false;
bool firebaseInitialized = false;

// Status proses hitung dan kirim
bool timerStarted = false;
bool dataSent = false;
bool tareComplete = false;
unsigned long weighingStartTime = 0;
float lockedWeightKg = 0.0f;

// Helper untuk cetak satu baris di LCD, otomatis dibersihkan dulu
void lcdPrintLine(int row, String text) {
  lcd.setCursor(0, row);
  lcd.print("                    "); // bersihkan baris (20 spasi)
  lcd.setCursor(0, row);
  lcd.print(text);
}

// Reset semua status hitung dan kirim, dipanggil saat mulai/berhenti menimbang
void resetWeighingState() {
  timerStarted = false;
  dataSent = false;
  tareComplete = false;
  weighingStartTime = 0;
  lockedWeightKg = 0.0f;
}

void connectWiFi() {
  Serial.print("Menghubungkan ke Wi-Fi...");
  lcdPrintLine(1, "Menghubungkan WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    retryCount++;
    if (retryCount > 40) { // Jika gagal setelah 20 detik, restart ESP32
      Serial.println("\nGagal terhubung ke Wi-Fi. Memulai ulang ESP32...");
      lcdPrintLine(1, "WiFi gagal, restart");
      delay(1500);
      ESP.restart();
    }
  }

  Serial.println("\nWi-Fi terhubung!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  lcdPrintLine(1, "WiFi: Terhubung");
}

void setup() {
  Serial.begin(57600);
  delay(10);
  Serial.println();
  Serial.println("Memulai HX711...");

  // Inisialisasi LCD
  lcd.init();
  lcd.backlight();
  lcdPrintLine(0, "AgriWeight Scale");
  lcdPrintLine(1, "Memulai sensor...");

  LoadCell.begin();

  unsigned long stabilizingtime = 2000; // waktu stabilisasi sensor, dalam ms
  boolean _tare = true; // tare otomatis saat start

  LoadCell.start(stabilizingtime, _tare);

  if (LoadCell.getTareTimeoutFlag() || LoadCell.getSignalTimeoutFlag()) {
    Serial.println("Timeout. Cek kabel HX711 ke ESP32.");
    lcdPrintLine(0, "Sensor error!");
    lcdPrintLine(1, "Cek kabel HX711");
    while (1);
  } else {
    LoadCell.setCalFactor(calibrationValue);
    Serial.println("Sensor siap. Membaca berat dalam kg.");
    lcdPrintLine(2, "Sensor HX711 siap");
  }

  // Hubungkan ke Wi-Fi
  connectWiFi();

  // Konfigurasi Firebase Client
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  auth.user.email = FIREBASE_EMAIL;
  auth.user.password = FIREBASE_PASSWORD;

  // Daftarkan callback untuk auto-renew token Firebase
  config.token_status_callback = tokenStatusCallback;

  // Memulai koneksi Firebase
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  lcdPrintLine(3, "Status: idle");
}

void loop() {
  static boolean newDataReady = false;

  // Update pembacaan dari HX711, harus tetap jalan tiap loop
  if (LoadCell.update()) newDataReady = true;

  // Kirim 't' lewat Serial Monitor untuk tare ulang manual
  if (Serial.available() > 0) {
    char inByte = Serial.read();
    if (inByte == 't') LoadCell.tareNoDelay();
  }

  if (LoadCell.getTareStatus() == true) {
    Serial.println("Tare selesai.");
    lcdPrintLine(2, "Tare selesai");
    tareComplete = true;
  }

  // Jika Wi-Fi terputus, coba hubungkan kembali
  if (WiFi.status() != WL_CONNECTED) {
    lcdPrintLine(1, "WiFi: Terputus");
    connectWiFi();
    firebaseInitialized = false; // Reset status agar inisialisasi ulang
  }

  // Lakukan inisialisasi awal Firebase setelah token terhubung
  if (Firebase.ready() && !firebaseInitialized) {
    Serial.println("Firebase siap! Mengatur status online...");
    lcdPrintLine(2, "Firebase siap");

    // 1. Atur status online ke true
    if (Firebase.RTDB.setBool(&fbdoWrite, onlinePath, true)) {
      Serial.println("Status perangkat: ONLINE");
    } else {
      Serial.printf("Gagal mengatur status online: %s\n", fbdoWrite.errorReason().c_str());
    }

    // 2. Pastikan node status memiliki nilai default
    if (Firebase.RTDB.getString(&fbdoWrite, statusPath)) {
      if (fbdoWrite.dataType() == "null" || fbdoWrite.stringData() == "") {
        Firebase.RTDB.setString(&fbdoWrite, statusPath, "idle");
      }
    }

    // 3. Mulai Firebase Stream untuk memantau perubahan status penimbangan secara real-time
    if (Firebase.RTDB.beginStream(&fbdoStream, statusPath)) {
      Serial.println("Firebase Stream dimulai.");
      firebaseInitialized = true;
    } else {
      Serial.printf("Gagal memulai Firebase Stream: %s\n", fbdoStream.errorReason().c_str());
    }
  }

  // Proses monitoring stream & pengiriman data berat
  if (firebaseInitialized) {
    // Kirim heartbeat (last_active & is_online) setiap 2 detik
    unsigned long heartbeatMillis = millis();
    static unsigned long lastHeartbeatTime = 0;
    const unsigned long heartbeatInterval = 2000;
    if (heartbeatMillis - lastHeartbeatTime >= heartbeatInterval) {
      lastHeartbeatTime = heartbeatMillis;
      FirebaseJson json;
      json.set("last_active/.sv", "timestamp");
      json.set("is_online", true);
      Firebase.RTDB.updateNode(&fbdoWrite, parentPath, &json);
    }

    // Baca pembaruan dari Firebase Stream
    if (!Firebase.RTDB.readStream(&fbdoStream)) {
      Serial.printf("Gagal membaca Firebase Stream: %s\n", fbdoStream.errorReason().c_str());
    }

    // Tangani timeout stream secara otomatis
    if (fbdoStream.streamTimeout()) {
      Serial.println("Firebase Stream timeout, menghubungkan kembali...");
    }

    // Jika ada data baru masuk dari Stream status
    if (fbdoStream.streamAvailable()) {
      String status = fbdoStream.stringData();
      Serial.printf("Pembaruan Status dari Aplikasi: %s\n", status.c_str());
      lcdPrintLine(3, "Status: " + status);

      if (status == "menimbang") {
        if (!isWeighing) {
          Serial.println("Memulai sesi penimbangan. Melakukan Tare...");
          lcdPrintLine(2, "Tare...");
          resetWeighingState();
          LoadCell.tareNoDelay(); // Otomatis lakukan tare di awal sesi timbang
          isWeighing = true;
          // Set berat di database ke 0 agar sinkron di awal
          Firebase.RTDB.setFloat(&fbdoWrite, weightPath, 0.0f);
        }
      } else {
        if (isWeighing) {
          Serial.println("Sesi penimbangan selesai/kembali ke idle.");
          isWeighing = false;
          resetWeighingState();
        }
      }
    }

    // Proses hitung dan kirim, hanya jalan selama status "menimbang"
    if (isWeighing) {
      if (!tareComplete) {
        lcdPrintLine(2, "Menunggu tare...");
      } else if (!dataSent) {
        // Selama belum ada nilai terkunci, terus baca berat real-time
        if (newDataReady) {
          float gramValue = LoadCell.getData();

          // Debug: lihat raw value sebelum dikonversi ke kg
          Serial.print("Raw gramValue: ");
          Serial.println(gramValue);

          float kgValue = gramValue / 1000.0;
          if (kgValue < 0.0f) kgValue = 0.0f;

          lcdPrintLine(2, "Berat: " + String(kgValue, 3) + " kg");
          newDataReady = false;

          if (kgValue > weightThreshold) {
            // Ada beban, mulai atau lanjutkan timer 20 detik
            if (!timerStarted) {
              timerStarted = true;
              weighingStartTime = millis();
              Serial.println("Beban terdeteksi. Mulai hitung mundur 20 detik.");
              lcdPrintLine(3, "Menghitung...");
            }

            unsigned long elapsed = millis() - weighingStartTime;
            if (elapsed < weighingDuration) {
              int sisaDetik = (weighingDuration - elapsed) / 1000;
              lcdPrintLine(3, "Sisa: " + String(sisaDetik) + " detik");
            } else {
              // 20 detik selesai, kunci nilai dan kirim sekali
              lockedWeightKg = kgValue;
              dataSent = true;

              Serial.print("Waktu hitung selesai. Berat dikirim: ");
              Serial.print(lockedWeightKg, 3);
              Serial.println(" kg");

              lcdPrintLine(2, "Berat: " + String(lockedWeightKg, 3) + " kg");

              if (Firebase.RTDB.setFloat(&fbdoWrite, weightPath, lockedWeightKg)) {
                lcdPrintLine(3, "Data terkirim");
              } else {
                Serial.printf("Gagal mengirim berat: %s\n", fbdoWrite.errorReason().c_str());
                lcdPrintLine(3, "Gagal kirim data");
              }
            }
          } else {
            // Berat kembali 0 sebelum 20 detik selesai, reset timer
            if (timerStarted) {
              Serial.println("Beban diangkat sebelum 20 detik. Timer direset.");
            }
            timerStarted = false;
            lcdPrintLine(3, "Menunggu beban...");
          }
        }
      }
      // Kalau dataSent == true, nilai lockedWeightKg tetap ditampilkan,
      // tidak diproses ulang sampai status berubah jadi selain "menimbang".
    }
  }
}