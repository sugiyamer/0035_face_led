#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_LEDBackpack.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

Adafruit_8x8matrix matrix = Adafruit_8x8matrix();
static const uint8_t matrixAddr = 0x70;
static const int ledPin = 2;

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
  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);
  
  // Init Matrix
  matrix.begin(matrixAddr);
  matrix.setBrightness(1);
  matrix.clear();
  matrix.writeDisplay();

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
  pAdvertising->setMinPreferred(0x06);  // help with iPhone connections issue
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
}

void loop() {
  // BLE reception is handled via callbacks (MyCallbacks::onWrite)
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
      // Verify that each character is a hexadecimal digit (0-9, A-F, a-f)
      if (isxdigit(hexByte[0]) && isxdigit(hexByte[1])) {
        displayData[i] = (uint8_t)strtol(hexByte.c_str(), NULL, 16);
      } else {
        valid = false;
        break;
      }
    }
    
    if (valid) {
      matrix.clear();
      // Draw each byte as one row (x=0, y=0, data, width=8, height=8, color)
      matrix.drawBitmap(0, 0, displayData, 8, 8, LED_ON);
      matrix.writeDisplay();
    }
  }
}