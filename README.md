# Face LED Controller

A web application that analyzes facial expressions and gestures from a camera feed in real-time and displays them as abstracted expressions on an 8x8 LED matrix. It uses MediaPipe Face Landmarker and Hand Landmarker for analysis and sends dot-matrix data to connected devices (e.g., ESP32) via the Web Bluetooth API.

https://github.com/user-attachments/assets/0bf36bae-a4ec-40c4-a796-54f761245063

## Repository Structure

- /: Web application (HTML/CSS/JS)
- /firmware: Microcontroller code
  - /esp32_8x8_matrix_led: ESP32 firmware for Adafruit LED Backpack (HT16K33) with BLE support.

## Key Features

- **Multi-Modal Detection**: Simultaneously recognizes facial landmarks and hand gestures using MediaPipe.
- **Expression Classification**:
  - **Eyes**: Gaze direction (9 directions), blinking, squinting (tightly closed), winking, and surprise (wide open).
  - **Mouth**: Smile, scowl, closed, open, and kiss (puckered).
- **Special Gestures**:
  - **TT Pose**: Displays a special "T T" crying face pattern when both index fingers are pointed down and thumbs are pointed toward the center of the face.
- **Matrix Rotation & Mirroring**: Rotate the output bitmap by 0°, 90°, 180°, or 270° and optionally mirror it horizontally to match the physical orientation and wiring of your LED matrix.
- **Bluetooth Communication**: Sends 8x8 bitmap data as a 16-character hexadecimal string (+ LF) via BLE (Nordic UART Service compatible).
- **Real-time Calibration**: Instantly adjust detection thresholds using on-screen sliders.
- **Visual Feedback**: Toggle an overlay of facial and hand landmarks for debugging and alignment.

## Hardware Requirements

- **Microcontroller**: ideaspark ESP32 0.96inch OLED Board (or any ESP32 with BLE)
- **LED Matrix**: 8x8 Dot Matrix LED Module with **HT16K33** I2C LED driver chip
- **Communication**: Bluetooth Low Energy (BLE)

## Firmware Setup (ESP32)

1.  Open `firmware/esp32_8x8_matrix_led/esp32_8x8_matrix_led.ino` in the Arduino IDE.
2.  Install required libraries via Library Manager:
    - **Adafruit GFX Library**
    - **Adafruit LED Backpack Library**
3.  Connect your ESP32 and the HT16K33 LED Matrix (Default I2C address: `0x70`).
4.  Upload the code to your ESP32.

## Web App Setup and Execution

1.  **Running the App**:
    - Due to browser security restrictions (Web Bluetooth and Camera APIs), this app must be served via **HTTPS or localhost**.
    - **Recommended**: Start a local development server.
        - Python: `python3 -m http.server`
        - Node.js: `npx serve`

2.  **Compatible Browsers**:
    - Google Chrome, Microsoft Edge, or any browser that supports the Web Bluetooth API.

## Usage

1.  Open the application in a compatible browser.
2.  Grant access to the camera.
3.  Click the **"Connect Bluetooth"** button and choose the device named **"FaceLED-ESP32"**.
4.  Face the camera and use the sliders to calibrate sensitivity based on your lighting and environment.
5.  Turn on **"Show Overlay"** to verify that landmarks are being detected correctly.
6.  Perform the TT pose (index fingers down, thumbs inward) to trigger the special "T T" pattern.

## Troubleshooting

### "Failed to connect Bluetooth: Web Bluetooth API globally disabled." on Mobile Browsers

If you encounter this error on mobile devices (especially Chrome or Brave), you may need to manually enable the Web Bluetooth API in the browser's experimental flags:

1.  Open your browser (Chrome or Brave) and enter `chrome://flags` in the address bar.
2.  Search for **"Web Bluetooth"** in the search box.
3.  Locate flags such as **"Web Bluetooth new permissions backend"** or **"Enable Web Bluetooth"** and set them to **"Enabled"**.
4.  Relaunch your browser.

## Bluetooth Communication Protocol

When an expression or gesture changes, the app sends an 8-byte bitmap (hexadecimal string) followed by a newline character (`\n`) via the BLE RX characteristic.

**Format**: `[ROW0][ROW1][ROW2][ROW3][ROW4][ROW5][ROW6][ROW7]\n`

- Each `ROW` is a 2-digit hex value (e.g., `E7` = `11100111`).
- **ROW 0-4 (5 rows)**: Eye patterns.
- **ROW 5-7 (3 rows)**: Mouth patterns.

**Example**: `00E742424200423C\n` (Represents TT eyes and a smile).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Dependencies

- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe/solutions/vision/face_landmarker) (Loaded via CDN)
- [Adafruit GFX Library](https://github.com/adafruit/Adafruit-GFX-Library)
- [Adafruit LED Backpack Library](https://github.com/adafruit/Adafruit_LED_Backpack)
