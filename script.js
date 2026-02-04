import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// --- Enums ---
const EyesIdx = {
  UPPER_LEFT: 0,
  UPPER_MID: 1,
  UPPER_RIGHT: 2,
  MID_LEFT: 3,
  MID_MID: 4,
  MID_RIGHT: 5,
  LOWER_LEFT: 6,
  LOWER_MID: 7,
  LOWER_RIGHT: 8,
  CLOSE: 9,
  CLOSE_TIGHTLY: 10,
  WINK_LEFT: 11,
  WINK_RIGHT: 12,
  OPEN: 13,
  TT_POSE: 14
};

const MouthIdx = {
  SMILE: 0,
  SCOWL: 1,
  CLOSE: 2,
  OPEN: 3,
  KISS: 4
};

const EYE_PATTERNS = [
  // UPPER_LEFT
  [0b11100111, 0b00000000, 0b00100001, 0b00000000, 0b00000000],
  // UPPER_MID
  [0b11100111, 0b00000000, 0b01000010, 0b00000000, 0b00000000],
  // UPPER_RIGHT
  [0b11100111, 0b00000000, 0b10000100, 0b00000000, 0b00000000],
  // MID_LEFT
  [0b11100111, 0b00000000, 0b00000000, 0b00100001, 0b00000000],
  // MID_MID
  [0b11100111, 0b00000000, 0b00000000, 0b01000010, 0b00000000],
  // MID_RIGHT
  [0b11100111, 0b00000000, 0b00000000, 0b10000100, 0b00000000],
  // LOWER_LEFT
  [0b11100111, 0b00000000, 0b00000000, 0b00000000, 0b00100001],
  // LOWER_MID
  [0b11100111, 0b00000000, 0b00000000, 0b00000000, 0b01000010],
  // LOWER_RIGHT
  [0b11100111, 0b00000000, 0b00000000, 0b00000000, 0b10000100],
  // CLOSE
  [0b00000000, 0b00000000, 0b00000000, 0b11100111, 0b00000000],
  // CLOSE_TIGHTLY
  [0b10000001, 0b01000010, 0b00100100, 0b01000010, 0b10000001],
  // WINK_LEFT
  [0b10000000, 0b01000000, 0b00100111, 0b01000000, 0b10000000],
  // WINK_RIGHT
  [0b00000001, 0b00000010, 0b11100100, 0b00000010, 0b00000001],
  // OPEN
  [0b01000010, 0b10100101, 0b10100101, 0b10100101, 0b01000010],
  // TT_POSE ("T T" shape)
  [0b00000000, 0b11100111, 0b01000010, 0b01000010, 0b01000010]
];

const MOUTH_PATTERNS = [
  // SMILE
  [0b00000000, 0b01000010, 0b00111100],
  // SCOWL
  [0b00000000, 0b00111100, 0b01000010],
  // CLOSE
  [0b00000000, 0b01111110, 0b00000000],
  // OPEN
  [0b00111100, 0b00100100, 0b00111100],
  // KISS
  [0b00011000, 0b00011000, 0b00000000]
];

// --- Config / Parameters ---
const Config = {
  eyeOpenThreshold: 0.095,      // Below this = Closed
  eyeWideOpenThreshold: 0.53,   // Above this = Wide Open
  eyeTightThreshold: 0.15,     // Below this = Tightly Closed
  eyeWinkDiff: 0.15,           // Diff between L/R for wink
  gazeHLeft: 0.4,              // Iris normalized X < this = Looking Right (Mirrored) -> Actually user's right
  gazeHRight: 0.6,
  gazeVUp: 0.35,
  gazeVDown: 0.65,
  mouthOpenThreshold: 0.15,    // MAR > this = Open
  mouthSmileThreshold: -0.02,  // Corner Y - Center Y. Negative = Smile (corners higher)
  mouthKissWidthRatio: 0.25    // Mouth Width / Face Width < this = Kiss
};

// --- State ---
const state = {
  eyes: EyesIdx.MID_MID,
  mouth: MouthIdx.CLOSE,
  videoPlaying: false,
  serialPort: null,
  serialWriter: null,
  lastSent: "",
  lastSentTime: 0,
  isProcessing: false,
  stream: null,
  showOverlay: false, // Initial state is OFF
  rotation: 0,
  mirror: false
};

// --- Helper Functions ---

function rotate8x8(src, angle) {
  if (angle === 0) return src;

  let dst = new Uint8Array(8);
  if (angle === 90) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (src[i] & (1 << (7 - j))) {
          dst[j] |= (1 << i);
        }
      }
    }
  } else if (angle === 180) {
    for (let i = 0; i < 8; i++) {
      let row = 0;
      for (let j = 0; j < 8; j++) {
        if (src[7 - i] & (1 << j)) {
          row |= (1 << (7 - j));
        }
      }
      dst[i] = row;
    }
  } else if (angle === 270) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (src[i] & (1 << (7 - j))) {
          dst[7 - j] |= (1 << (7 - i));
        }
      }
    }
  }
  return dst;
}

function mirror8x8(src) {
  let dst = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let b = src[i];
    let rev = 0;
    for (let bit = 0; bit < 8; bit++) {
      if ((b >> bit) & 1) {
        rev |= (1 << (7 - bit));
      }
    }
    dst[i] = rev;
  }
  return dst;
}

// --- Elements ---
const video = document.getElementById("webcam");
const canvas = document.getElementById("output_canvas");
const ctx = canvas.getContext("2d");
const eyesStatusEl = document.getElementById("eyesStatus");
const mouthStatusEl = document.getElementById("mouthStatus");
const connectionStatusEl = document.getElementById("connectionStatus");
const connectionStatusHeaderEl = document.getElementById("connectionStatusHeader");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("errorMsg");
const debugInfoEl = document.getElementById("debugInfo");
const connectBleBtn = document.getElementById("connectBleBtn");
const slidersContainer = document.getElementById("slidersContainer");
const overlayToggle = document.getElementById("overlayToggle");

// Menu elements
const menuToggle = document.getElementById("menuToggle");
const controlsSidebar = document.getElementById("controlsSidebar");
const closeMenuBtn = document.getElementById("closeMenuBtn");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function toggleMenu() {
    controlsSidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("visible");
}

menuToggle.addEventListener("click", toggleMenu);
closeMenuBtn.addEventListener("click", toggleMenu);
sidebarOverlay.addEventListener("click", toggleMenu);

let faceLandmarker;
let handLandmarker;
let runningMode = "VIDEO";
let lastVideoTime = -1;

// --- Initialization ---

async function createFaceLandmarker() {
  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      runningMode: runningMode,
      numFaces: 1
    });
    // Next, load Hand Landmarker
    createHandLandmarker();
  } catch (e) {
    showError("Failed to load Face Landmarker: " + e.message);
  }
}

async function createHandLandmarker() {
  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU"
      },
      runningMode: runningMode,
      numHands: 2
    });
    loadingEl.classList.add("hidden");
    startWebcam();
  } catch (e) {
    showError("Failed to load Hand Landmarker: " + e.message);
  }
}

async function startWebcam() {
  if (!faceLandmarker || !handLandmarker) return;

  try {
    // Constraint: 640x480
    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      }
    };

    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = state.stream;
    video.addEventListener("loadeddata", predictWebcam);
    state.videoPlaying = true;
  } catch (e) {
    console.error(e);
    showError("Camera not found or access denied. Please allow camera access.");
  }
}

function showError(msg) {
  loadingEl.classList.add("hidden");
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
}

// --- Communication (Web Serial API) ---

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("Web Serial API not supported. Use Chrome or Edge.");
    return;
  }

  try {
    state.serialPort = await navigator.serial.requestPort();
    await state.serialPort.open({ baudRate: 115200 });
    state.serialWriter = state.serialPort.writable.getWriter();

    onConnected();
    connectBleBtn.disabled = true;

  } catch (e) {
    console.error("Serial connection failed:", e);
    alert("Failed to connect: " + e.message);
  }
}

function onConnected() {
    connectionStatusEl.textContent = "Connected (USB)";
    connectionStatusEl.classList.remove("disconnected");
    connectionStatusEl.classList.add("connected");
    if (connectionStatusHeaderEl) {
        connectionStatusHeaderEl.classList.remove("disconnected");
        connectionStatusHeaderEl.classList.add("connected");
    }
}

function onDisconnected() {
    state.serialWriter = null;
    state.serialPort = null;
    connectionStatusEl.textContent = "Disconnected";
    connectionStatusEl.classList.add("disconnected");
    connectionStatusEl.classList.remove("connected");
    if (connectionStatusHeaderEl) {
        connectionStatusHeaderEl.classList.add("disconnected");
        connectionStatusHeaderEl.classList.remove("connected");
    }
    connectBleBtn.disabled = false;
}

async function sendData(eyeIdx, mouthIdx) {
  if (!state.serialWriter) return;

  // Throttling: Max 20 packets per second (50ms interval)
  const now = performance.now();
  if (now - state.lastSentTime < 50) return;

  const eyeBytes = EYE_PATTERNS[eyeIdx] || EYE_PATTERNS[EyesIdx.MID_MID];
  const mouthBytes = MOUTH_PATTERNS[mouthIdx] || MOUTH_PATTERNS[MouthIdx.CLOSE];

  let allBytes = new Uint8Array([...eyeBytes, ...mouthBytes]);

  // Apply rotation
  if (state.rotation !== 0) {
    allBytes = rotate8x8(allBytes, state.rotation);
  }

  // Apply mirror
  if (state.mirror) {
    allBytes = mirror8x8(allBytes);
  }

  const hexString = Array.from(allBytes).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  const data = hexString + "\n";

  if (state.lastSent === data) return;

  try {
    const encoder = new TextEncoder();
    await state.serialWriter.write(encoder.encode(data));
    state.lastSent = data;
    state.lastSentTime = now;
  } catch (e) {
    console.error("Write error:", e);
    onDisconnected();
  }
}


// --- Logic / Math ---

// Euclidean distance
function dist(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Eye Aspect Ratio
function getEAR(p1, p2, p3, p4, p5, p6) {
  // p1, p4 are corners. p2,p6 are top. p3,p5 are bottom.
  // indices provided in logic plan were corners: 33/133.
  const top = dist(p2, p6) + dist(p3, p5);
  const horizontal = dist(p1, p4);
  return top / (2.0 * horizontal);
}

// Mouth Aspect Ratio (Simple Height/Width)
function getMAR(top, bottom, left, right) {
  return dist(top, bottom) / dist(left, right);
}

// Get Iris Position Ratio (0.0 - 1.0) inside Eye Box
// Ref: Iris center vs Inner/Outer corners.
// pLeft, pRight are eye corners. pIris is center.
function getIrisRatio(pLeft, pRight, pIris) {
  const dTotal = dist(pLeft, pRight);
  const dIris = dist(pLeft, pIris); // Distance from left corner
  // Project Iris onto the vector connecting corners for more accuracy?
  // Simple distance ratio is usually sufficient for 2D frontal face.
  return dIris / dTotal; 
}


// --- Main Loop ---

async function predictWebcam() {
  // Resize canvas to match video
  if (video.videoWidth !== canvas.width) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  let startTimeMs = performance.now();

  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    
    // Detect
    const faceResults = faceLandmarker.detectForVideo(video, startTimeMs);
    const handResults = handLandmarker.detectForVideo(video, startTimeMs);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (faceResults.faceLandmarks && faceResults.faceLandmarks.length > 0) {
      const landmarks = faceResults.faceLandmarks[0];
      processFace(landmarks, handResults);
      
      // Draw landmarks only if overlay is enabled
      if (state.showOverlay) {
        const drawingUtils = new DrawingUtils(ctx);
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "#FFFF00", lineWidth: 1 });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "#FFFF00", lineWidth: 1 });
        drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "#FFFF00", lineWidth: 1 });
      }
    }

    if (state.showOverlay && handResults.landmarks) {
      const drawingUtils = new DrawingUtils(ctx);
      for (const landmarks of handResults.landmarks) {
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00FF00", lineWidth: 1 });
        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1, radius: 2 });
      }
    }
  }

  if (state.videoPlaying) {
    window.requestAnimationFrame(predictWebcam);
  }
}

function processFace(lm, handResults) {
  // --- Landmark Definitions ---
  // Left Eye
  const lLeft = lm[33];
  const lRight = lm[133];
  const lTop = lm[159];
  const lBot = lm[145];
  const lIris = lm[468]; // Left Iris Center

  // Right Eye
  const rLeft = lm[362]; // Inner
  const rRight = lm[263]; // Outer
  const rTop = lm[386];
  const rBot = lm[374];
  const rIris = lm[473]; // Right Iris Center

  // Mouth
  const mLeft = lm[61];
  const mRight = lm[291];
  const mTop = lm[13]; // Inner lip
  const mBot = lm[14]; // Inner lip
  // Face Width Reference (Cheek to Cheek) for "Kiss" normalization
  const fLeft = lm[234];
  const fRight = lm[454];

  // --- Calculations ---

  // 1. EAR (Eye Openness)
  // Approximate EAR using vertical/horizontal
  const lEAR = dist(lTop, lBot) / dist(lLeft, lRight);
  const rEAR = dist(rTop, rBot) / dist(rLeft, rRight);
  const avgEAR = (lEAR + rEAR) / 2;

  // 2. Gaze (Iris Position)
  const lRatioH = (lIris.x - lLeft.x) / (lRight.x - lLeft.x); // Left Eye Horizontal
  const rRatioH = (rIris.x - rLeft.x) / (rRight.x - rLeft.x); // Right Eye Horizontal
  const avgH = (lRatioH + rRatioH) / 2;

  const lRatioV = (lIris.y - lTop.y) / (lBot.y - lTop.y); // Vertical (0=Top, 1=Bottom)
  const rRatioV = (rIris.y - rTop.y) / (rBot.y - rTop.y);
  const avgV = (lRatioV + rRatioV) / 2;

  // 3. Mouth Metrics
  const mWidth = dist(mLeft, mRight);
  const faceWidth = dist(fLeft, fRight);
  const mouthWidthRatio = mWidth / faceWidth;
  
  const mOpenDist = dist(mTop, mBot);
  const mMAR = mOpenDist / mWidth; // Aspect Ratio

  const mCenterY = (mTop.y + mBot.y) / 2;
  const cornersY = (mLeft.y + mRight.y) / 2;
  const smileVal = (cornersY - mCenterY) / mWidth; // Negative = Smile

  // --- Classification ---

  let finalEyes = EyesIdx.MID_MID;
  let finalMouth = MouthIdx.CLOSE;

  // Detect Eyes
  if (lEAR < Config.eyeTightThreshold && rEAR < Config.eyeTightThreshold) {
    finalEyes = EyesIdx.CLOSE_TIGHTLY;
  } else if (avgEAR < Config.eyeOpenThreshold) {
    finalEyes = EyesIdx.CLOSE;
  } else if (Math.abs(lEAR - rEAR) > Config.eyeWinkDiff) {
    if (lEAR < rEAR) finalEyes = EyesIdx.WINK_RIGHT; 
    else finalEyes = EyesIdx.WINK_LEFT;
  } else if (avgEAR > Config.eyeWideOpenThreshold) {
    finalEyes = EyesIdx.OPEN;
  } else {
    // Gaze Detection
    let col = 1; // Mid
    if (avgH < Config.gazeHLeft) col = 2; // Screen Left -> Enum Right
    else if (avgH > Config.gazeHRight) col = 0; // Screen Right -> Enum Left

    let row = 1; // Mid
    if (avgV < Config.gazeVUp) row = 0; // Up
    else if (avgV > Config.gazeVDown) row = 2; // Down
    
    finalEyes = row * 3 + col;
  }

  // Detect Mouth
  if (mouthWidthRatio < Config.mouthKissWidthRatio) {
    finalMouth = MouthIdx.KISS;
  } else if (mMAR > Config.mouthOpenThreshold) {
    finalMouth = MouthIdx.OPEN;
  } else if (smileVal < Config.mouthSmileThreshold) {
    finalMouth = MouthIdx.SMILE;
  } else if (smileVal > Math.abs(Config.mouthSmileThreshold * 2)) {
      finalMouth = MouthIdx.SCOWL;
  } else {
    finalMouth = MouthIdx.CLOSE;
  }

  // --- Gesture Detection (TT Pose) ---
  if (handResults && handResults.landmarks && handResults.landmarks.length >= 2) {
    const noseTip = lm[1]; 
    let screenLeftHandValid = false; 
    let screenRightHandValid = false; 

    for (const hand of handResults.landmarks) {
      const wrist = hand[0];
      const thumbTip = hand[4];
      const thumbIP = hand[3];
      const indexTip = hand[8];
      const indexMCP = hand[5];

      const isIndexDown = indexTip.y > indexMCP.y; 
      
      if (wrist.x < noseTip.x) { // Screen Left Side (User Right Hand)
        const isThumbInward = thumbTip.x > thumbIP.x;
        if (isIndexDown && isThumbInward) screenLeftHandValid = true;
      } else { // Screen Right Side (User Left Hand)
        const isThumbInward = thumbTip.x < thumbIP.x;
        if (isIndexDown && isThumbInward) screenRightHandValid = true;
      }
    }
    
    if (screenLeftHandValid && screenRightHandValid) {
      finalEyes = EyesIdx.TT_POSE;
    }
  }

  // Update UI
  updateStatus(finalEyes, finalMouth);
  updateDebug(lEAR, rEAR, avgH, avgV, smileVal, mMAR, mouthWidthRatio);
  
  // Send Data via BLE
  sendData(finalEyes, finalMouth);
}

function updateStatus(e, m) {
  const eyeKeys = Object.keys(EyesIdx).find(key => EyesIdx[key] === e);
  const mouthKeys = Object.keys(MouthIdx).find(key => MouthIdx[key] === m);
  
  eyesStatusEl.textContent = eyeKeys || "UNKNOWN";
  mouthStatusEl.textContent = mouthKeys || "UNKNOWN";
}

function updateDebug(lEAR, rEAR, gazeH, gazeV, smile, mar, widthRatio) {
  debugInfoEl.textContent = 
`L-EAR: ${lEAR.toFixed(2)}  R-EAR: ${rEAR.toFixed(2)}
` +
`Gaze H: ${gazeH.toFixed(2)} (L<${Config.gazeHLeft}, R>${Config.gazeHRight})
` +
`Gaze V: ${gazeV.toFixed(2)} (U<${Config.gazeVUp}, D>${Config.gazeVDown})
` +
`Mouth Smile: ${smile.toFixed(2)} (<${Config.mouthSmileThreshold})
` +
`Mouth MAR: ${mar.toFixed(2)} (>${Config.mouthOpenThreshold})
` +
`Mouth Width: ${widthRatio.toFixed(2)} (<${Config.mouthKissWidthRatio})
`;
}

// --- UI / Sliders ---

function createSliders() {
  const createSlider = (key, min, max, step, labelText) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'slider-group';
    
    const header = document.createElement('div');
    header.className = 'slider-header';
    
    const label = document.createElement('span');
    label.textContent = labelText;
    
    const valDisplay = document.createElement('span');
    valDisplay.className = 'slider-val';
    valDisplay.textContent = Config[key];
    
    header.appendChild(label);
    header.appendChild(valDisplay);
    
    const input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = Config[key];
    
    input.addEventListener('input', (e) => {
      Config[key] = parseFloat(e.target.value);
      valDisplay.textContent = Config[key];
    });
    
    wrapper.appendChild(header);
    wrapper.appendChild(input);
    slidersContainer.appendChild(wrapper);
  };

  createSlider('eyeOpenThreshold', 0.01, 0.1, 0.005, 'Eye Open Thresh');
  createSlider('eyeWideOpenThreshold', 0.1, 0.6, 0.01, 'Eye Wide Open Thresh');
  createSlider('gazeHLeft', 0.1, 0.5, 0.01, 'Gaze Left Boundary');
  createSlider('gazeHRight', 0.5, 0.9, 0.01, 'Gaze Right Boundary');
  createSlider('mouthOpenThreshold', 0.05, 0.5, 0.01, 'Mouth Open MAR');
  createSlider('mouthSmileThreshold', -0.1, 0.1, 0.01, 'Smile Thresh (Neg)');
  createSlider('mouthKissWidthRatio', 0.1, 0.6, 0.01, 'Kiss Width Ratio');
}

// Reset button
document.getElementById('resetParamsBtn').addEventListener('click', () => {
    if(confirm("Reset all parameters to default?")) {
        location.reload();
    }
});

// Start
createSliders();
connectBleBtn.addEventListener('click', connectSerial);
overlayToggle.addEventListener('change', (e) => {
    state.showOverlay = e.target.checked;
});
document.getElementById('rotationSelect').addEventListener('change', (e) => {
    state.rotation = parseInt(e.target.value);
});
document.getElementById('mirrorToggle').addEventListener('change', (e) => {
    state.mirror = e.target.checked;
});
createFaceLandmarker();
