#include <LedControl.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// MAX7219 Pins (SPI)
// DIN -> GPIO23 (MOSI)
// CS  -> GPIO5
// CLK -> GPIO18 (SCK)
#define MAX7219_DIN  23
#define MAX7219_CS   5
#define MAX7219_CLK  18

// LedControl(DIN, CLK, CS, numDevices)
LedControl lc = LedControl(MAX7219_DIN, MAX7219_CLK, MAX7219_CS, 1);

// BLE UUIDs
#define SERVICE_UUID           "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define CHARACTERISTIC_UUID_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"

BLEServer *pServer = NULL;
bool deviceConnected = false;
String bleInputBuffer = "";

void setup();
void loop();
void processCommand(String inputStr);

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
    };
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      // Restart advertising to allow re-connection
      pServer->getAdvertising()->start();
    }
};

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String value = pCharacteristic->getValue();
      if (value.length() > 0) {
        for (int i = 0; i < value.length(); i++) {
          char c = value[i];
          if (c == '\n') {
            processCommand(bleInputBuffer);
            bleInputBuffer = "";
          } else {
            bleInputBuffer += c;
          }
        }
      }
    }
};

void setup() {
  Serial.begin(115200);

  // Init MAX7219
  lc.shutdown(0, false);      // Wake up display
  lc.setIntensity(0, 2);      // Brightness (0-15)
  lc.clearDisplay(0);         // Clear display

  // Init BLE
  BLEDevice::init("FaceLED-ESP32");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);
  BLECharacteristic *pCharacteristic = pService->createCharacteristic(
                                         CHARACTERISTIC_UUID_RX,
                                         BLECharacteristic::PROPERTY_WRITE |
                                         BLECharacteristic::PROPERTY_WRITE_NR
                                       );
  pCharacteristic->setCallbacks(new MyCallbacks());
  pService->start();

  // Advertising setup
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("FaceLED-ESP32 Ready!");
}

void loop() {
  // BLE reception is handled via callbacks
  delay(10);
}

void processCommand(String inputStr) {
  inputStr.trim();

  // Verify that it is 16 hexadecimal characters (8 bytes)
  if (inputStr.length() == 16) {
    uint8_t displayData[8];
    bool valid = true;

    for (int i = 0; i < 8; i++) {
      String hexByte = inputStr.substring(i * 2, i * 2 + 2);
      // Verify that each character is a hexadecimal digit
      if (isxdigit(hexByte[0]) && isxdigit(hexByte[1])) {
        displayData[i] = (uint8_t)strtol(hexByte.c_str(), NULL, 16);
      } else {
        valid = false;
        break;
      }
    }

    if (valid) {
      // Display on MAX7219
      for (int row = 0; row < 8; row++) {
        lc.setRow(0, row, displayData[row]);
      }
      Serial.println("Display updated: " + inputStr);
    }
  }
}
