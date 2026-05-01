document.addEventListener("DOMContentLoaded", () => {
  const video = document.getElementById("video");
  const captureButton = document.getElementById("capture-button");
  const statusDiv = document.getElementById("status");
  const modelSelect = document.getElementById("model-select");
  const modeSelect = document.getElementById("mode-select");
  const intervalControl = document.getElementById("interval-control");
  const intervalInput = document.getElementById("interval-input");
  const directionsButton = document.getElementById("directions-button");

  const settingsButton = document.getElementById("settings-button");
  const settingsPanel = document.getElementById("settings-panel");
  const closeSettingsButton = document.getElementById("close-settings");

  const speechSpeedButton = document.getElementById("speech-speed-button");
  const currentSpeedDisplay = document.getElementById("current-speed-display");
  const enableAudioButton = document.getElementById("enable-audio-button");
  const audioStatusDisplay = document.getElementById("audio-status-display");

  const calibrationButton = document.getElementById("calibration-button");
  const calibrationModal = document.getElementById("calibration-modal");
  const closeCalibration = document.getElementById("close-calibration");
  const nextCalibrationStep = document.getElementById("next-calibration-step");
  const backCalibrationStep = document.getElementById("back-calibration-step");
  const captureCalibration = document.getElementById("capture-calibration");
  const calibrationStep1 = document.getElementById("calibration-step-1");
  const calibrationStep2 = document.getElementById("calibration-step-2");
  const calibrationHeight = document.getElementById("calibration-height");
  const calibrationVideo = document.getElementById("calibration-video");
  const calibrationStatus = document.getElementById("calibration-status");

  let calibrationStream = null;
  let currentTTSSpeed = 3;
  let speechRecognition = null;
  let isListeningForSpeed = false;

  let globalAudioContext = null;
  let audioInitialized = false;

  function initializeAudio() {
    if (audioInitialized) return;
    try {
      globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioInitialized = true;
      console.log("Audio context initialized successfully.");
    } catch (e) {
      console.error("Could not initialize audio context.", e);
    }
  }

  function playWarningBeep() {
    try {
      const beepSound = document.getElementById('beep-sound');
      // play() works best when called within a user interaction.
      // analyzeDepthForObstacles is called asynchronously, so calling play() directly here
      // may be blocked on mobile. Instead, preload audio and play when needed.
      if (beepSound && beepSound.src) {
        beepSound.play().catch(e => console.error("Warning beep playback failed:", e));
      }
    } catch (error) {
      console.error("Warning beep playback error:", error);
    }
  }

  let isProcessing = false;
  let isAutoCapturing = false;
  let captureLoop = null;
  let isNavigating = false;
  let navigationQueue = [];
  let navigationSession = null;
  let watchId = null;

  settingsButton.addEventListener("click", () => {
    settingsPanel.classList.remove("hidden");
    setTimeout(() => {
      speechSpeedButton.focus();
    }, 100);
  });

  closeSettingsButton.addEventListener("click", () => {
    settingsPanel.classList.add("hidden");
    settingsButton.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsPanel.classList.contains("hidden")) {
      settingsPanel.classList.add("hidden");
      settingsButton.focus();
      return;
    }

    if (
      event.key === "Escape" &&
      settingsPanel.classList.contains("hidden") &&
      isNavigating
    ) {
      event.preventDefault();
      const shouldStop = confirm("Stop navigation?");
      if (shouldStop) {
        stopNavigation();
      }
      return;
    }

    if (event.key === " " && settingsPanel.classList.contains("hidden")) {
      event.preventDefault();
      captureButton.click();
      return;
    }
  });

  settingsPanel.addEventListener("click", (event) => {
    if (event.target === settingsPanel) {
      settingsPanel.classList.add("hidden");
      settingsButton.focus();
    }
  });

  enableAudioButton.addEventListener("click", () => {
    try {
      const beepSound = document.getElementById('beep-sound');

      // Load audio at user interaction time so it's ready to play
      beepSound.load();

      enableAudioButton.textContent = "🔊 Warning Sound Enabled";
      enableAudioButton.disabled = true;
      audioStatusDisplay.textContent = "Warning sound: enabled";
      audioStatusDisplay.style.color = "#00ff00";

      console.log("Warning sound enabled. Playing test beep.");

      beepSound.oncanplaythrough = () => {
        playWarningBeep();
        beepSound.oncanplaythrough = null;
      };

    } catch (e) {
      console.error("Error enabling warning sound", e);
      audioStatusDisplay.textContent = "Warning sound: failed to enable";
      audioStatusDisplay.style.color = "#ff0000";
    }
  });

  calibrationButton.addEventListener("click", () => {
    calibrationModal.classList.remove("hidden");
    calibrationStep1.style.display = "block";
    calibrationStep2.style.display = "none";
    calibrationHeight.focus();
  });

  closeCalibration.addEventListener("click", () => {
    calibrationModal.classList.add("hidden");
    stopCalibrationCamera();
  });

  nextCalibrationStep.addEventListener("click", () => {
    if (!calibrationHeight.value || calibrationHeight.value <= 0) {
      alert("Please enter a valid height.");
      return;
    }
    calibrationStep1.style.display = "none";
    calibrationStep2.style.display = "block";
    startCalibrationCamera();
  });

  backCalibrationStep.addEventListener("click", () => {
    calibrationStep2.style.display = "none";
    calibrationStep1.style.display = "block";
    stopCalibrationCamera();
  });

  captureCalibration.addEventListener("click", async () => {
    if (!calibrationStream) {
      alert("Camera is not ready.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = calibrationVideo.videoWidth;
    canvas.height = calibrationVideo.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(calibrationVideo, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append("image", blob, "calibration.jpg");
      formData.append("height", calibrationHeight.value);

      try {
        const response = await fetch("/calibrate", {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (response.ok) {
          sessionStorage.setItem("calibrationFactor", data.calibrationFactor);
          calibrationStatus.textContent = `Calibrated (factor: ${data.calibrationFactor.toFixed(3)})`;
          calibrationStatus.style.color = "#00ff00";
          alert("Calibration completed.");
          calibrationModal.classList.add("hidden");
          stopCalibrationCamera();
        } else {
          throw new Error(data.error || "Unknown error");
        }
      } catch (error) {
        alert(`Calibration failed: ${error.message}`);
        calibrationStatus.textContent = "Calibration failed";
        calibrationStatus.style.color = "#ff0000";
      }
    }, "image/jpeg");
  });

  async function startCalibrationCamera() {
    try {
      if (!calibrationStream) {
        calibrationStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      }
      calibrationVideo.srcObject = calibrationStream;
    } catch (error) {
      console.error("Failed to start calibration camera:", error);
      alert("Could not start the calibration camera.");
    }
  }

  function stopCalibrationCamera() {
    if (calibrationStream) {
      calibrationStream.getTracks().forEach(track => track.stop());
      calibrationStream = null;
      const calibrationVideo = document.getElementById("calibration-video");
      if (calibrationVideo) {
        calibrationVideo.srcObject = null;
      }
    }
    startCamera();
  }

  function logPerformance(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 30000,
      });
    });
  }

  function initializeSpeechRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error("This browser does not support speech recognition.");
      speechSpeedButton.disabled = true;
      speechSpeedButton.textContent = "Speech recognition unsupported";
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = "en-US";
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;

    speechRecognition.onstart = () => {
      logPerformance("Speech recognition started");
      speechSpeedButton.textContent = "🎤 Listening...";
      speechSpeedButton.disabled = true;
      isListeningForSpeed = true;
    };

    speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      logPerformance(`Speech recognition result: "${transcript}"`);

      const speed = extractSpeedFromText(transcript);
      if (speed) {
        setTTSSpeed(speed);
      } else {
        speak("No recognized speed. Please say a number from one to ten.");
      }
    };

    speechRecognition.onend = () => {
      logPerformance("Speech recognition ended");
      speechSpeedButton.textContent = "🎤 Set Speech Speed";
      speechSpeedButton.disabled = false;
      isListeningForSpeed = false;
    };

    speechRecognition.onerror = (event) => {
      logPerformance(`Speech recognition error: ${event.error}`);
      speechSpeedButton.textContent = "🎤 Set Speech Speed";
      speechSpeedButton.disabled = false;
      isListeningForSpeed = false;
      speak("Speech recognition failed. Please try again.");
    };
  }

  function extractSpeedFromText(text) {
    logPerformance(`Speed extraction attempt: "${text}"`);

    const englishNumbers = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };

    const lowered = text.toLowerCase();

    const patterns = [
      /(\d+)\s*x/g,
      /(\d+)\s*times/g,
      /([a-z]+)\s*x/g,
      /([a-z]+)\s*times/g,
      /\b(\d+)\b/g,
      /\b([a-z]+)\b/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(lowered)) !== null) {
        const token = match[1];
        let number = parseInt(token);

        if (isNaN(number)) {
          number = englishNumbers[token];
        }

        if (number && number >= 1 && number <= 10) {
          logPerformance(`Speed extracted: ${number}x`);
          return number;
        }
      }
    }

    logPerformance("Speed extraction failed");
    return null;
  }

  function setTTSSpeed(speed) {
    currentTTSSpeed = speed;
    localStorage.setItem("tts-speed", speed);
    currentSpeedDisplay.textContent = `Current speed: ${speed}x`;
    logPerformance(`TTS speed set: ${speed}x`);

    speak(`Speech speed set to ${speed} times.`);
  }

  function loadTTSSpeed() {
    const savedSpeed = localStorage.getItem("tts-speed");
    if (savedSpeed) {
      const speed = parseInt(savedSpeed);
      if (speed >= 1 && speed <= 10) {
        currentTTSSpeed = speed;
        currentSpeedDisplay.textContent = `Current speed: ${speed}x`;
        logPerformance(`Loaded saved TTS speed: ${speed}x`);
      }
    }
  }

  speechSpeedButton.addEventListener("click", () => {
    if (isListeningForSpeed) {
      return;
    }

    if (!speechRecognition) {
      speak("This browser does not support speech recognition.");
      return;
    }

    speak("What speed would you like? Say a number from one to ten.", () => {
      setTimeout(() => {
        speechRecognition.start();
      }, 500);
    });
  });

  async function loadModels() {
    try {
      logPerformance("Loading model list");
      const response = await fetch("/get_models");
      const data = await response.json();

      modelSelect.innerHTML = "";
      data.models.forEach((model) => {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.name;
        if (model.id === "gemini-2.0-flash") {
          option.selected = true;
        }
        modelSelect.appendChild(option);
      });
      logPerformance(`Model list loaded - ${data.models.length} models`);
    } catch (err) {
      logPerformance(`Failed to load model list - error: ${err}`);
      console.error("Model list load error:", err);
      modelSelect.innerHTML =
        '<option value="gemini-2.0-flash">Gemini 2.0 Flash (default)</option>';
    }
  }

  modeSelect.addEventListener("change", () => {
    if (modeSelect.value === "interval") {
      intervalControl.style.display = "flex";
    } else {
      intervalControl.style.display = "none";
    }
  });

  async function startCamera() {
    const cameraStart = performance.now();
    logPerformance("Camera initialization started");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        const cameraTime = performance.now() - cameraStart;
        logPerformance(
          `Camera initialized - elapsed: ${cameraTime.toFixed(3)}ms`
        );
        statusDiv.textContent =
          "Ready! (Space: start analysis, 📍: directions, ESC: stop)";
        captureButton.disabled = false;
        directionsButton.disabled = false;
      };
    } catch (err) {
      const cameraTime = performance.now() - cameraStart;
      logPerformance(
        `Camera initialization failed - elapsed: ${cameraTime.toFixed(
          3
        )}ms, error: ${err}`
      );
      console.error("Camera access error:", err);
      statusDiv.textContent = "Camera unavailable.";
    }
  }

  // Re-activate the camera after blocking calls (prompt, confirm) freeze it
  async function unfreezeCamera() {
    logPerformance("Re-activating camera stream.");
    try {
      if (video.srcObject) {
        video.srcObject.getVideoTracks().forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      logPerformance("Camera stream re-activated.");
    } catch (error) {
      console.error("Camera re-activation failed:", error);
    }
  }

  async function captureAndDescribe(onComplete, includeLocation = false) {
    if (isProcessing) {
      logPerformance("Already processing, ignoring request");
      if (onComplete) onComplete();
      return;
    }

    const totalStart = performance.now();
    const selectedModel = modelSelect.value || "gemini-2.0-flash";
    logPerformance(
      `=== New image capture and analysis started - model: ${selectedModel} ===`
    );

    isProcessing = true;
    statusDiv.textContent = `Analyzing... (${modelSelect.options[modelSelect.selectedIndex].text
      })`;

    const captureStart = performance.now();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const captureTime = performance.now() - captureStart;
    logPerformance(
      `Image capture completed - resolution: ${canvas.width}x${canvas.height
      }, elapsed: ${captureTime.toFixed(3)}ms`
    );

    const blobStart = performance.now();
    canvas.toBlob(async (blob) => {
      const blobTime = performance.now() - blobStart;
      logPerformance(
        `Blob conversion completed - size: ${blob.size
        } bytes, elapsed: ${blobTime.toFixed(3)}ms`
      );

      const formDataStart = performance.now();
      const formData = new FormData();
      formData.append("image", blob, "capture.jpg");
      formData.append("model", selectedModel);

      let endpoint = "/describe";
      if (isNavigating && navigationSession) {
        endpoint = "/navigation_describe";
        formData.append("session_id", navigationSession.id);

        if (includeLocation) {
          try {
            const position = await getCurrentPosition();
            const currentLocation = `${position.coords.longitude},${position.coords.latitude}`;
            formData.append("location", currentLocation);
            logPerformance(`Location attached: ${currentLocation}`);
          } catch (locationError) {
            logPerformance(`Failed to get location: ${locationError.message}`);
          }
        }
      }

      const formDataTime = performance.now() - formDataStart;
      logPerformance(
        `FormData prepared - endpoint: ${endpoint}, elapsed: ${formDataTime.toFixed(
          3
        )}ms`
      );

      try {
        analyzeDepthForObstacles(canvas);

        const requestStart = performance.now();
        logPerformance(`Server request started (${endpoint})...`);

        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });

        const requestTime = performance.now() - requestStart;
        logPerformance(
          `Server response received - status: ${response.status
          }, elapsed: ${requestTime.toFixed(3)}ms`
        );

        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);

        const parseStart = performance.now();
        const data = await response.json();
        const parseTime = performance.now() - parseStart;
        logPerformance(`Response parsed - elapsed: ${parseTime.toFixed(3)}ms`);

        if (data.description) {
          statusDiv.textContent = data.description;
          logPerformance(
            `Analysis result: "${data.description}" (${data.description.length} chars)`
          );
          logPerformance(
            `Model used: ${data.model_name
            }, server processing time: ${data.processing_time?.toFixed(3)}s`
          );

          if (data.navigation) {
            logPerformance(
              `Navigation info received: progress ${data.navigation.instruction_index + 1
              }/${data.navigation.total_instructions}`
            );

            if (data.navigation.updated && navigationSession) {
              navigationSession.current_instruction =
                data.navigation.current_instruction;
              logPerformance(
                `Navigation updated: ${data.navigation.current_instruction}`
              );
            }

            if (data.location_updated) {
              logPerformance("Location updated");
            }
          }

          const ttsStart = performance.now();
          speak(data.description, () => {
            const ttsTime = performance.now() - ttsStart;
            const totalTime = performance.now() - totalStart;
            logPerformance(`TTS completed - elapsed: ${ttsTime.toFixed(3)}ms`);
            logPerformance(
              `=== Full processing completed - total elapsed: ${totalTime.toFixed(3)}ms ===`
            );
            logPerformance(
              `Time breakdown: capture(${captureTime.toFixed(
                1
              )}ms) + Blob(${blobTime.toFixed(
                1
              )}ms) + server(${requestTime.toFixed(1)}ms) + TTS(${ttsTime.toFixed(
                1
              )}ms)`
            );

            if (onComplete) onComplete();
          });
        } else {
          throw new Error(data.error || "Empty content");
        }
      } catch (err) {
        const errorTime = performance.now() - totalStart;
        logPerformance(
          `Analysis request failed - total elapsed: ${errorTime.toFixed(
            3
          )}ms, error: ${err}`
        );
        console.error("Analysis request error:", err);
        statusDiv.textContent = "Analysis failed.";
        speak("An error occurred.", onComplete);
      } finally {
        isProcessing = false;
      }
    }, "image/jpeg");
  }

  async function analyzeDepthForObstacles(canvas) {
    const calibrationFactor = sessionStorage.getItem("calibrationFactor");
    if (!calibrationFactor) return;

    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append("image", blob, "depth_check.jpg");
      formData.append("calibrationFactor", calibrationFactor);

      try {
        const response = await fetch("/analyze_depth", {
          method: "POST",
          body: formData,
        });
        const data = await response.json();

        if (response.ok && data.should_warn) {
          playWarningBeep();
        }
      } catch (error) {
        console.warn("Depth analysis request error:", error);
      }
    }, "image/jpeg");
  }

  function speak(text, onEndCallback) {
    const ttsStart = performance.now();
    logPerformance(`TTS started - text: "${text}", speed: ${currentTTSSpeed}x`);

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = currentTTSSpeed;

    utterance.onend = () => {
      const ttsTime = performance.now() - ttsStart;
      logPerformance(`TTS ended normally - elapsed: ${ttsTime.toFixed(3)}ms`);
      if (onEndCallback) {
        onEndCallback();
      }
    };
    utterance.onerror = (event) => {
      const ttsTime = performance.now() - ttsStart;
      logPerformance(
        `TTS error - elapsed: ${ttsTime.toFixed(3)}ms, error: ${event.error
        }`
      );
      console.error("SpeechSynthesis Error:", event.error);
      if (onEndCallback) {
        onEndCallback();
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  function runAutoCapture() {
    if (!isAutoCapturing) return;

    const mode = modeSelect.value;
    logPerformance(`Auto capture run - mode: ${mode}`);

    if (mode === "tts_end") {
      captureAndDescribe(runAutoCapture, isNavigating);
    } else {
      const interval = (parseInt(intervalInput.value, 10) || 3) * 1000;
      logPerformance(`Interval mode - waiting ${interval}ms until next run`);
      captureLoop = setTimeout(() => {
        captureAndDescribe(() => {
          runAutoCapture();
        }, isNavigating);
      }, interval);
    }
  }

  captureButton.addEventListener("click", () => {
    initializeAudio();

    if (isAutoCapturing) {
      logPerformance("Auto capture stop requested");

      if (isNavigating) {
        const stopAll = confirm(
          "Stopping scene analysis.\nAlso stop navigation?"
        );

        unfreezeCamera();

        if (stopAll) {
          stopNavigation();
          return;
        }
      }

      isAutoCapturing = false;
      clearTimeout(captureLoop);
      window.speechSynthesis.cancel();

      fetch("/stop_auto_processing", { method: "POST" })
        .then((res) => res.json())
        .then((data) =>
          logPerformance(
            `Server stop response: ${data.message || JSON.stringify(data)}`
          )
        )
        .catch((err) => logPerformance(`Server stop request failed: ${err}`));

      captureButton.textContent = "🔄 Start";
      captureButton.classList.remove("stop");
      modeSelect.disabled = false;
      modelSelect.disabled = false;
      intervalInput.disabled = false;
      if (!isNavigating) {
        directionsButton.disabled = false;
      }
      settingsButton.disabled = false;

      if (isNavigating) {
        statusDiv.textContent =
          "📍 Navigation in progress - scene analysis stopped (ESC: stop nav, Space: restart analysis)";
        speak("Scene analysis stopped. Navigation continues.");
      } else {
        statusDiv.textContent = "Auto analysis stopped (Space: start)";
      }
      logPerformance("Auto capture stopped");
    } else {
      const selectedModel = modelSelect.options[modelSelect.selectedIndex].text;
      logPerformance(
        `Auto capture started - mode: ${modeSelect.value}, model: ${selectedModel}`
      );
      isAutoCapturing = true;
      captureButton.textContent = isNavigating ? "🔄 Stop Analysis" : "🔄 Stop";
      captureButton.classList.add("stop");
      modeSelect.disabled = true;
      modelSelect.disabled = true;
      intervalInput.disabled = true;
      if (!isNavigating) {
        directionsButton.disabled = true;
      }
      settingsButton.disabled = true;

      if (isNavigating) {
        statusDiv.textContent =
          "📍 Navigation + 🔄 scene analysis in progress (ESC: stop nav)";
        speak("Starting scene analysis during navigation.");
      } else {
        statusDiv.textContent = "🔄 Scene auto-analysis running (Space: stop)";
        speak("Starting scene auto-analysis.");
      }

      runAutoCapture();
    }
  });

  directionsButton.addEventListener("click", async () => {
    if (isNavigating) {
      logPerformance("Navigation stop requested");
      stopNavigation();
      return;
    }

    const destination = prompt("Enter destination (e.g., Seoul Station):");

    // The prompt freezes the camera; re-activate the stream.
    unfreezeCamera();

    if (!destination) {
      logPerformance("Destination input cancelled");
      return;
    }

    logPerformance(`Directions started - destination: ${destination}`);
    statusDiv.textContent = "Confirming current location and searching destination...";
    speak("Confirming current location and searching destination. Please wait.");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const startCoords = `${longitude},${latitude}`;
        logPerformance(`Current location: ${startCoords}`);

        try {
          const response = await fetch("/start_navigation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              start: startCoords,
              goal: destination,
            }),
          });
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Could not find a route.");
          }

          if (data.session_id) {
            navigationSession = {
              id: data.session_id,
              total_instructions: data.total_instructions,
              current_instruction: data.current_instruction,
            };
            startGPSNavigation();
          } else {
            throw new Error("Could not start navigation session.");
          }
        } catch (err) {
          logPerformance(`Directions error: ${err.message}`);
          statusDiv.textContent = `Error: ${err.message}`;
          speak(`An error occurred. ${err.message}`);
        }
      },
      (error) => {
        logPerformance(`GPS location failed: ${error.message}`);
        statusDiv.textContent = "Could not confirm GPS location.";
        speak("Could not confirm GPS location, so directions cannot start.");
      },
      { enableHighAccuracy: true }
    );
  });

  function startGPSNavigation() {
    isNavigating = true;
    directionsButton.textContent = "📍 Stop Navigation";
    settingsButton.disabled = true;
    logPerformance("GPS-linked navigation started");

    if (!isAutoCapturing) {
      const startAnalysis = confirm(
        "Also start scene analysis along with navigation?\\n\\n" +
        "- Yes: navigation + scene analysis simultaneously\\n" +
        "- No: navigation only (you can start analysis later with Space)"
      );

      unfreezeCamera();

      if (startAnalysis) {
        isAutoCapturing = true;
        captureButton.textContent = "🔄 Stop Analysis";
        captureButton.classList.add("stop");
        modeSelect.disabled = true;
        modelSelect.disabled = true;
        intervalInput.disabled = true;
        logPerformance("Starting auto image analysis with navigation");

      } else {
        logPerformance("Navigation only - user controls image analysis manually");
      }
    }

    if (navigationSession.current_instruction) {
      logPerformance(`First instruction: ${navigationSession.current_instruction}`);

      if (isAutoCapturing) {
        statusDiv.textContent = `📍 Navigation + 🔄 analysis: ${navigationSession.current_instruction} (ESC: stop nav)`;
        speak(
          "Starting route guidance with scene analysis. " +
          navigationSession.current_instruction,
          () => {
            runAutoCapture();
          }
        );
      } else {
        statusDiv.textContent = `📍 Navigation in progress: ${navigationSession.current_instruction} (ESC: stop nav, Space: start analysis)`;
        speak(
          "Starting route guidance. You can start scene analysis separately with the space bar. " +
          navigationSession.current_instruction
        );
      }
    }

    startLocationTracking();
  }

  function startLocationTracking() {
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        updateNavigationLocation,
        (error) => {
          logPerformance(`GPS tracking error: ${error.message}`);
          speak("An error occurred during GPS tracking.");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        }
      );
      logPerformance("GPS tracking started");
    } else {
      logPerformance("Browser does not support GPS.");
      speak("This browser does not support GPS.");
    }
  }

  async function updateNavigationLocation(position) {
    if (!isNavigating || !navigationSession) return;

    const { latitude, longitude } = position.coords;
    const currentLocation = `${longitude},${latitude}`;

    try {
      const response = await fetch("/update_location", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: navigationSession.id,
          location: currentLocation,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (
          data.current_instruction &&
          data.current_instruction !== navigationSession.current_instruction
        ) {
          navigationSession.current_instruction = data.current_instruction;

          if (isAutoCapturing) {
            statusDiv.textContent = `📍 Navigation + 🔄 analysis: ${data.current_instruction} (ESC: stop nav)`;
          } else {
            statusDiv.textContent = `📍 Navigation in progress: ${data.current_instruction} (ESC: stop nav, Space: start analysis)`;
          }

          logPerformance(`New instruction: ${data.current_instruction}`);
          speak(data.current_instruction);
        }

        if (data.status === "completed") {
          finishNavigation();
        }
      } else {
        logPerformance(`Location update failed: ${data.error}`);
      }
    } catch (err) {
      logPerformance(`Location update error: ${err.message}`);
    }
  }

  function stopNavigation() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      logPerformance("GPS tracking stopped");
    }

    if (navigationSession) {
      fetch("/end_navigation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: navigationSession.id,
        }),
      }).catch((err) => {
        logPerformance(`Session end request failed: ${err.message}`);
      });
      navigationSession = null;
    }

    isNavigating = false;
    isProcessing = false;
    if (isAutoCapturing) {
      isAutoCapturing = false;
      clearTimeout(captureLoop);
      window.speechSynthesis.cancel();
      fetch("/stop_auto_processing", { method: "POST" })
        .then((res) => res.json())
        .then((data) =>
          logPerformance(
            `Server stop response: ${data.message || JSON.stringify(data)}`
          )
        )
        .catch((err) => logPerformance(`Server stop request failed: ${err}`));
    }

    captureButton.textContent = "Start";
    captureButton.classList.remove("stop");
    captureButton.disabled = false;
    directionsButton.textContent = "📍 Directions";
    directionsButton.disabled = false;
    settingsButton.disabled = false;
    modelSelect.disabled = false;
    intervalInput.disabled = false;
    modeSelect.disabled = false;

    statusDiv.textContent = "Navigation stopped. (Space: start analysis)";
    logPerformance("Navigation stopped");
    speak("Navigation stopped.");
  }

  function finishNavigation() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      logPerformance("GPS tracking finished");
    }

    if (navigationSession) {
      fetch("/end_navigation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session_id: navigationSession.id,
        }),
      }).catch((err) => {
        logPerformance(`Session end request failed: ${err.message}`);
      });
      navigationSession = null;
    }

    isNavigating = false;
    isProcessing = false;
    if (isAutoCapturing) {
      isAutoCapturing = false;
      clearTimeout(captureLoop);
      window.speechSynthesis.cancel();
      fetch("/stop_auto_processing", { method: "POST" })
        .then((res) => res.json())
        .then((data) =>
          logPerformance(
            `Server stop response: ${data.message || JSON.stringify(data)}`
          )
        )
        .catch((err) => logPerformance(`Server stop request failed: ${err}`));
    }

    captureButton.textContent = "Start";
    captureButton.classList.remove("stop");
    captureButton.disabled = false;
    directionsButton.textContent = "📍 Directions";
    directionsButton.disabled = false;
    settingsButton.disabled = false;
    modelSelect.disabled = false;
    intervalInput.disabled = false;
    modeSelect.disabled = false;

    statusDiv.textContent = "🎉 Destination reached! (Space: start analysis)";
    logPerformance("Navigation finished");
    speak("You have reached your destination. Ending navigation.");
  }

  logPerformance("Page loaded, initializing model list and camera");

  loadTTSSpeed();
  initializeSpeechRecognition();

  loadModels().then(() => {
    startCamera();
  });
});
