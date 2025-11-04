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

  // 오디오 컨텍스트 초기화
  let globalAudioContext = null;
  let audioInitialized = false;

  function initializeAudio() {
    if (audioInitialized) return;
    try {
      globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioInitialized = true;
      console.log("✅ 오디오 컨텍스트가 성공적으로 초기화되었습니다.");
    } catch (e) {
      console.error("오디오 컨텍스트를 초기화할 수 없습니다.", e);
    }
  }

  function playWarningBeep() {
    try {
      const beepSound = document.getElementById('beep-sound');
      // play()는 사용자의 상호작용 내에서 호출될 때 가장 잘 동작합니다.
      // analyzeDepthForObstacles는 비동기적으로 호출되므로, 여기서 직접 play()를 부르는 것은
      // 모바일에서 차단될 수 있습니다. 대신, 오디오를 미리 로드해두고 필요할 때 재생합니다.
      if (beepSound && beepSound.src) {
        beepSound.play().catch(e => console.error("경고음 재생 실패:", e));
      }
    } catch (error) {
      console.error("경고음 재생 오류:", error);
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
      const shouldStop = confirm("길안내를 중지하시겠습니까?");
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

      // 사용자가 버튼을 누른 이 시점에 오디오를 로드하여 재생 준비
      beepSound.load();

      enableAudioButton.textContent = "🔊 경고음 활성화됨";
      enableAudioButton.disabled = true;
      audioStatusDisplay.textContent = "경고음: 활성화됨";
      audioStatusDisplay.style.color = "#00ff00";

      console.log("✅ 경고음이 활성화되었습니다. 테스트 경고음을 재생합니다.");

      // 로드가 완료되면 테스트 비프음을 재생
      beepSound.oncanplaythrough = () => {
        playWarningBeep();
        // 이벤트 리스너가 반복해서 실행되지 않도록 null 처리
        beepSound.oncanplaythrough = null;
      };

    } catch (e) {
      console.error("경고음 활성화 중 오류 발생", e);
      audioStatusDisplay.textContent = "경고음: 활성화 실패";
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
      alert("올바른 키를 입력해주세요.");
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
      alert("카메라가 준비되지 않았습니다.");
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
          calibrationStatus.textContent = `보정 완료 (계수: ${data.calibrationFactor.toFixed(3)})`;
          calibrationStatus.style.color = "#00ff00";
          alert("보정이 완료되었습니다.");
          calibrationModal.classList.add("hidden");
          stopCalibrationCamera();
        } else {
          throw new Error(data.error || "알 수 없는 오류");
        }
      } catch (error) {
        alert(`보정 실패: ${error.message}`);
        calibrationStatus.textContent = "보정 실패";
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
      console.error("보정 카메라 시작 실패:", error);
      alert("보정용 카메라를 시작할 수 없습니다.");
    }
  }

  function stopCalibrationCamera() {
    if (calibrationStream) {
      calibrationStream.getTracks().forEach(track => track.stop());
      calibrationStream = null;
      // 메인 비디오 스트림은 건드리지 않도록 수정
      const calibrationVideo = document.getElementById("calibration-video");
      if (calibrationVideo) {
        calibrationVideo.srcObject = null;
      }
    }
    // 보정이 끝나면 메인 카메라를 다시 시작해준다.
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
      console.error("이 브라우저는 음성 인식을 지원하지 않습니다.");
      speechSpeedButton.disabled = true;
      speechSpeedButton.textContent = "음성 인식 미지원";
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = "ko-KR";
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;

    speechRecognition.onstart = () => {
      logPerformance("음성 인식 시작");
      speechSpeedButton.textContent = "🎤 듣고 있습니다...";
      speechSpeedButton.disabled = true;
      isListeningForSpeed = true;
    };

    speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      logPerformance(`음성 인식 결과: "${transcript}"`);

      const speed = extractSpeedFromText(transcript);
      if (speed) {
        setTTSSpeed(speed);
      } else {
        speak("인식된 속도가 없습니다. 1배부터 10배까지 말씀해주세요.");
      }
    };

    speechRecognition.onend = () => {
      logPerformance("음성 인식 종료");
      speechSpeedButton.textContent = "🎤 음성 속도 설정";
      speechSpeedButton.disabled = false;
      isListeningForSpeed = false;
    };

    speechRecognition.onerror = (event) => {
      logPerformance(`음성 인식 오류: ${event.error}`);
      speechSpeedButton.textContent = "🎤 음성 속도 설정";
      speechSpeedButton.disabled = false;
      isListeningForSpeed = false;
      speak("음성 인식에 실패했습니다. 다시 시도해주세요.");
    };
  }

  function extractSpeedFromText(text) {
    logPerformance(`속도 추출 시도: "${text}"`);

    const koreanNumbers = {
      일: 1,
      한: 1,
      하나: 1,
      이: 2,
      두: 2,
      둘: 2,
      삼: 3,
      세: 3,
      셋: 3,
      사: 4,
      네: 4,
      넷: 4,
      오: 5,
      다섯: 5,
      육: 6,
      여섯: 6,
      칠: 7,
      일곱: 7,
      팔: 8,
      여덟: 8,
      구: 9,
      아홉: 9,
      십: 10,
      열: 10,
    };

    const patterns = [
      /(\d+)\s*배/g,
      /([가-힣]+)\s*배/g,
      /(\d+)\s*빼/g, // 발음 유사
      /([가-힣]+)\s*빼/g,
      /(\d+)\s*배속/g,
      /([가-힣]+)\s*배속/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const numberStr = match[1];
        let number = parseInt(numberStr);

        if (isNaN(number)) {
          number = koreanNumbers[numberStr];
        }

        if (number && number >= 1 && number <= 10) {
          logPerformance(`속도 추출 성공: ${number}배`);
          return number;
        }
      }
    }

    logPerformance("속도 추출 실패");
    return null;
  }

  function setTTSSpeed(speed) {
    currentTTSSpeed = speed;
    localStorage.setItem("tts-speed", speed);
    currentSpeedDisplay.textContent = `현재 속도: ${speed}배`;
    logPerformance(`TTS 속도 설정: ${speed}배`);

    speak(`음성 속도가 ${speed}배로 설정되었습니다.`);
  }

  function loadTTSSpeed() {
    const savedSpeed = localStorage.getItem("tts-speed");
    if (savedSpeed) {
      const speed = parseInt(savedSpeed);
      if (speed >= 1 && speed <= 10) {
        currentTTSSpeed = speed;
        currentSpeedDisplay.textContent = `현재 속도: ${speed}배`;
        logPerformance(`저장된 TTS 속도 불러오기: ${speed}배`);
      }
    }
  }

  speechSpeedButton.addEventListener("click", () => {
    if (isListeningForSpeed) {
      return;
    }

    if (!speechRecognition) {
      speak("음성 인식을 지원하지 않는 브라우저입니다.");
      return;
    }

    speak("몇 배로 설정하시겠습니까? 1배부터 10배까지 말씀해주세요.", () => {
      setTimeout(() => {
        speechRecognition.start();
      }, 500);
    });
  });

  async function loadModels() {
    try {
      logPerformance("모델 목록 로드 시작");
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
      logPerformance(`모델 목록 로드 완료 - ${data.models.length}개 모델`);
    } catch (err) {
      logPerformance(`모델 목록 로드 실패 - 오류: ${err}`);
      console.error("모델 목록 로드 에러:", err);
      modelSelect.innerHTML =
        '<option value="gemini-2.0-flash">Gemini 2.0 Flash (기본)</option>';
    }
  }

  modeSelect.addEventListener("change", () => {
    if (modeSelect.value === "interval") {
      intervalControl.style.display = "flex";
    } else {
      intervalControl.style.display = "none";
    }
  });

  // 카메라 스트림 가져오기
  async function startCamera() {
    const cameraStart = performance.now();
    logPerformance("카메라 초기화 시작");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        const cameraTime = performance.now() - cameraStart;
        logPerformance(
          `카메라 초기화 완료 - 소요시간: ${cameraTime.toFixed(3)}ms`
        );
        statusDiv.textContent =
          "준비 완료! (스페이스: 분석 시작, 📍버튼: 길찾기, ESC: 중지)";
        captureButton.disabled = false;
        directionsButton.disabled = false;
      };
    } catch (err) {
      const cameraTime = performance.now() - cameraStart;
      logPerformance(
        `카메라 초기화 실패 - 소요시간: ${cameraTime.toFixed(
          3
        )}ms, 오류: ${err}`
      );
      console.error("카메라 접근 에러:", err);
      statusDiv.textContent = "카메라를 사용할 수 없습니다.";
    }
  }

  // 동기/블로킹 함수(prompt, confirm) 호출 후 멈춘 카메라를 재활성화하는 함수
  async function unfreezeCamera() {
    logPerformance("카메라 스트림을 재활성화합니다.");
    try {
      if (video.srcObject) {
        video.srcObject.getVideoTracks().forEach(track => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      logPerformance("카메라 스트림 재활성화 완료.");
    } catch (error) {
      console.error("카메라 재활성화 실패:", error);
    }
  }

  // 이미지 캡처 및 서버 전송
  async function captureAndDescribe(onComplete, includeLocation = false) {
    if (isProcessing) {
      logPerformance("이미 처리 중이므로 요청 무시");
      if (onComplete) onComplete();
      return;
    }

    const totalStart = performance.now();
    const selectedModel = modelSelect.value || "gemini-2.0-flash";
    logPerformance(
      `=== 새로운 이미지 캡처 및 분석 시작 - 모델: ${selectedModel} ===`
    );

    isProcessing = true;
    statusDiv.textContent = `분석 중... (${modelSelect.options[modelSelect.selectedIndex].text
      })`;

    const captureStart = performance.now();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const captureTime = performance.now() - captureStart;
    logPerformance(
      `이미지 캡처 완료 - 해상도: ${canvas.width}x${canvas.height
      }, 소요시간: ${captureTime.toFixed(3)}ms`
    );

    const blobStart = performance.now();
    canvas.toBlob(async (blob) => {
      const blobTime = performance.now() - blobStart;
      logPerformance(
        `Blob 변환 완료 - 크기: ${blob.size
        } bytes, 소요시간: ${blobTime.toFixed(3)}ms`
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
            logPerformance(`위치 정보 포함됨: ${currentLocation}`);
          } catch (locationError) {
            logPerformance(`위치 정보 가져오기 실패: ${locationError.message}`);
          }
        }
      }

      const formDataTime = performance.now() - formDataStart;
      logPerformance(
        `FormData 준비 완료 - 엔드포인트: ${endpoint}, 소요시간: ${formDataTime.toFixed(
          3
        )}ms`
      );

      try {
        // 깊이 분석 병렬 실행
        analyzeDepthForObstacles(canvas);

        const requestStart = performance.now();
        logPerformance(`서버 요청 시작 (${endpoint})...`);

        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
        });

        const requestTime = performance.now() - requestStart;
        logPerformance(
          `서버 응답 수신 - 상태: ${response.status
          }, 소요시간: ${requestTime.toFixed(3)}ms`
        );

        if (!response.ok) throw new Error(`서버 에러: ${response.statusText}`);

        const parseStart = performance.now();
        const data = await response.json();
        const parseTime = performance.now() - parseStart;
        logPerformance(`응답 파싱 완료 - 소요시간: ${parseTime.toFixed(3)}ms`);

        if (data.description) {
          statusDiv.textContent = data.description;
          logPerformance(
            `분석 결과: "${data.description}" (${data.description.length}자)`
          );
          logPerformance(
            `사용 모델: ${data.model_name
            }, 서버 처리시간: ${data.processing_time?.toFixed(3)}초`
          );

          // 길안내 정보 처리
          if (data.navigation) {
            logPerformance(
              `길안내 정보 수신: 진행상황 ${data.navigation.instruction_index + 1
              }/${data.navigation.total_instructions}`
            );

            if (data.navigation.updated && navigationSession) {
              navigationSession.current_instruction =
                data.navigation.current_instruction;
              logPerformance(
                `길안내 업데이트됨: ${data.navigation.current_instruction}`
              );
            }

            if (data.location_updated) {
              logPerformance("위치 업데이트 완료");
            }
          }

          const ttsStart = performance.now();
          speak(data.description, () => {
            const ttsTime = performance.now() - ttsStart;
            const totalTime = performance.now() - totalStart;
            logPerformance(`TTS 완료 - 소요시간: ${ttsTime.toFixed(3)}ms`);
            logPerformance(
              `=== 전체 처리 완료 - 총 소요시간: ${totalTime.toFixed(3)}ms ===`
            );
            logPerformance(
              `시간 분석: 캡처(${captureTime.toFixed(
                1
              )}ms) + Blob(${blobTime.toFixed(
                1
              )}ms) + 서버(${requestTime.toFixed(1)}ms) + TTS(${ttsTime.toFixed(
                1
              )}ms)`
            );

            if (onComplete) onComplete();
          });
        } else {
          throw new Error(data.error || "내용 없음");
        }
      } catch (err) {
        const errorTime = performance.now() - totalStart;
        logPerformance(
          `분석 요청 실패 - 총 소요시간: ${errorTime.toFixed(
            3
          )}ms, 오류: ${err}`
        );
        console.error("분석 요청 에러:", err);
        statusDiv.textContent = "분석에 실패했습니다.";
        speak("오류가 발생했습니다.", onComplete);
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
        console.warn("깊이 분석 요청 오류:", error);
      }
    }, "image/jpeg");
  }

  function speak(text, onEndCallback) {
    const ttsStart = performance.now();
    logPerformance(`TTS 시작 - 텍스트: "${text}", 속도: ${currentTTSSpeed}배`);

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = currentTTSSpeed;

    utterance.onend = () => {
      const ttsTime = performance.now() - ttsStart;
      logPerformance(`TTS 정상 종료 - 소요시간: ${ttsTime.toFixed(3)}ms`);
      if (onEndCallback) {
        onEndCallback();
      }
    };
    utterance.onerror = (event) => {
      const ttsTime = performance.now() - ttsStart;
      logPerformance(
        `TTS 오류 발생 - 소요시간: ${ttsTime.toFixed(3)}ms, 오류: ${event.error
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
    logPerformance(`자동 캡처 실행 - 모드: ${mode}`);

    if (mode === "tts_end") {
      captureAndDescribe(runAutoCapture, isNavigating);
    } else {
      const interval = (parseInt(intervalInput.value, 10) || 3) * 1000;
      logPerformance(`시간 간격 모드 - 다음 실행까지 ${interval}ms 대기`);
      captureLoop = setTimeout(() => {
        captureAndDescribe(() => {
          runAutoCapture();
        }, isNavigating);
      }, interval);
    }
  }

  // 시작/정지 토글 버튼
  captureButton.addEventListener("click", () => {
    // 오디오 컨텍스트를 사용자의 첫 상호작용 시점에 초기화
    initializeAudio();

    if (isAutoCapturing) {
      logPerformance("자동 캡처 정지 요청");

      if (isNavigating) {
        const stopAll = confirm(
          "주변 상황 분석을 중지합니다.\n길안내도 함께 중지하시겠습니까?"
        );

        // confirm 창으로 인해 카메라가 멈추므로 재활성화합니다.
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
            `서버 중지 응답: ${data.message || JSON.stringify(data)}`
          )
        )
        .catch((err) => logPerformance(`서버 중지 요청 실패: ${err}`));

      captureButton.textContent = "🔄 시작";
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
          "📍 길안내 진행 중 - 주변 상황 분석 정지됨 (ESC: 길안내 중지, 스페이스: 분석 재시작)";
        speak("주변 상황 분석을 중지했습니다. 길안내는 계속됩니다.");
      } else {
        statusDiv.textContent = "자동 분석 정지됨 (스페이스: 시작)";
      }
      logPerformance("자동 캡처 정지됨");
    } else {
      const selectedModel = modelSelect.options[modelSelect.selectedIndex].text;
      logPerformance(
        `자동 캡처 시작 - 모드: ${modeSelect.value}, 모델: ${selectedModel}`
      );
      isAutoCapturing = true;
      captureButton.textContent = isNavigating ? "🔄 분석 정지" : "🔄 정지";
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
          "📍 길안내 + 🔄 상황 분석 진행 중 (ESC: 길안내 중지)";
        speak("길안내 중 주변 상황 분석을 시작합니다.");
      } else {
        statusDiv.textContent = "🔄 주변 상황 자동 분석 중 (스페이스: 정지)";
        speak("주변 상황 자동 분석을 시작합니다.");
      }

      runAutoCapture();
    }
  });

  // 길찾기 버튼
  directionsButton.addEventListener("click", async () => {
    if (isNavigating) {
      logPerformance("길찾기 안내 중지 요청");
      stopNavigation();
      return;
    }

    const destination = prompt("목적지를 입력하세요 (예: 서울역):");

    // prompt로 인해 카메라가 멈추는 현상을 해결하기 위해 스트림을 재활성화합니다.
    unfreezeCamera();

    if (!destination) {
      logPerformance("목적지 입력 취소됨");
      return;
    }

    logPerformance(`길찾기 시작 - 목적지: ${destination}`);
    statusDiv.textContent = "현재 위치를 확인하고 목적지를 검색 중입니다...";
    speak("현재 위치를 확인하고 목적지를 검색합니다. 잠시만 기다려주세요.");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const startCoords = `${longitude},${latitude}`;
        logPerformance(`현재 위치 확인됨: ${startCoords}`);

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
            throw new Error(data.error || "경로를 찾을 수 없습니다.");
          }

          if (data.session_id) {
            navigationSession = {
              id: data.session_id,
              total_instructions: data.total_instructions,
              current_instruction: data.current_instruction,
            };
            startGPSNavigation();
          } else {
            throw new Error("네비게이션 세션을 시작할 수 없습니다.");
          }
        } catch (err) {
          logPerformance(`길찾기 오류: ${err.message}`);
          statusDiv.textContent = `오류: ${err.message}`;
          speak(`오류가 발생했습니다. ${err.message}`);
        }
      },
      (error) => {
        logPerformance(`GPS 위치 확인 실패: ${error.message}`);
        statusDiv.textContent = "GPS 위치를 확인할 수 없습니다.";
        speak("GPS 위치를 확인할 수 없어 길찾기를 시작할 수 없습니다.");
      },
      { enableHighAccuracy: true }
    );
  });

  // GPS 연동 길찾기 안내 시작
  function startGPSNavigation() {
    isNavigating = true;
    directionsButton.textContent = "📍 안내 중지";
    settingsButton.disabled = true;
    logPerformance("GPS 연동 길찾기 안내 시작");

    // 길안내 시작 시, 자동 분석이 이미 실행중이 아니라면 사용자에게 물어봄
    if (!isAutoCapturing) {
      const startAnalysis = confirm(
        "길안내와 함께 주변 상황 분석도 시작하시겠습니까?\\n\\n" +
        "- 예: 길안내 + 주변 상황 분석 동시 진행\\n" +
        "- 아니오: 길안내만 진행 (나중에 스페이스바로 분석 시작 가능)"
      );

      // confirm 창으로 인해 카메라가 멈추므로 재활성화합니다.
      unfreezeCamera();

      if (startAnalysis) {
        // "예"를 누르면 자동 분석 시작
        isAutoCapturing = true;
        captureButton.textContent = "🔄 분석 정지";
        captureButton.classList.add("stop");
        modeSelect.disabled = true;
        modelSelect.disabled = true;
        intervalInput.disabled = true;
        logPerformance("길안내와 함께 자동 이미지 분석 시작");

        // runAutoCapture는 speak 이후에 호출되어 자연스러운 흐름을 만듬
      } else {
        logPerformance("길안내만 시작 - 이미지 분석은 사용자가 수동으로 제어");
      }
    }

    if (navigationSession.current_instruction) {
      logPerformance(`첫 안내: ${navigationSession.current_instruction}`);

      if (isAutoCapturing) {
        statusDiv.textContent = `📍 길안내 + 🔄 상황 분석: ${navigationSession.current_instruction} (ESC: 길안내 중지)`;
        speak(
          "경로 안내와 주변 상황 분석을 함께 시작합니다. " +
          navigationSession.current_instruction,
          () => {
            // TTS가 끝난 후 자동 캡처 시작
            runAutoCapture();
          }
        );
      } else {
        statusDiv.textContent = `📍 길안내 진행 중: ${navigationSession.current_instruction} (ESC: 길안내 중지, 스페이스: 상황 분석 시작)`;
        speak(
          "경로 안내를 시작합니다. 주변 상황 분석은 스페이스바를 눌러 별도로 시작할 수 있습니다. " +
          navigationSession.current_instruction
        );
      }
    }

    // 카메라 스트림을 멈추지 않으므로, 이 부분에서 별도의 카메라 제어 로직은 불필요
    startLocationTracking();
  }

  function startLocationTracking() {
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        updateNavigationLocation,
        (error) => {
          logPerformance(`GPS 위치 추적 오류: ${error.message}`);
          speak("GPS 위치 추적에 오류가 발생했습니다.");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000,
        }
      );
      logPerformance("GPS 위치 추적 시작됨");
    } else {
      logPerformance("GPS를 지원하지 않는 브라우저입니다.");
      speak("GPS를 지원하지 않는 브라우저입니다.");
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

          // 현재 상태에 따라 적절한 상태 메시지 표시
          if (isAutoCapturing) {
            statusDiv.textContent = `📍 길안내 + 🔄 상황 분석: ${data.current_instruction} (ESC: 길안내 중지)`;
          } else {
            statusDiv.textContent = `📍 길안내 진행 중: ${data.current_instruction} (ESC: 길안내 중지, 스페이스: 상황 분석 시작)`;
          }

          logPerformance(`새 안내: ${data.current_instruction}`);
          speak(data.current_instruction);
        }

        if (data.status === "completed") {
          finishNavigation();
        }
      } else {
        logPerformance(`위치 업데이트 실패: ${data.error}`);
      }
    } catch (err) {
      logPerformance(`위치 업데이트 오류: ${err.message}`);
    }
  }

  function stopNavigation() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      logPerformance("GPS 위치 추적 중지됨");
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
        logPerformance(`세션 종료 요청 실패: ${err.message}`);
      });
      navigationSession = null;
    }

    isNavigating = false;
    isProcessing = false; // 분석 중 상태 플래그를 확실하게 초기화
    if (isAutoCapturing) {
      isAutoCapturing = false;
      clearTimeout(captureLoop);
      window.speechSynthesis.cancel();
      // 서버에도 자동 처리 중지를 명시적으로 요청
      fetch("/stop_auto_processing", { method: "POST" })
        .then((res) => res.json())
        .then((data) =>
          logPerformance(
            `서버 중지 응답: ${data.message || JSON.stringify(data)}`
          )
        )
        .catch((err) => logPerformance(`서버 중지 요청 실패: ${err}`));
    }

    // 버튼 및 UI 상태를 완전히 초기 상태로 복원
    captureButton.textContent = "시작";
    captureButton.classList.remove("stop");
    captureButton.disabled = false;
    directionsButton.textContent = "📍 길찾기";
    directionsButton.disabled = false;
    settingsButton.disabled = false;
    modelSelect.disabled = false;
    intervalInput.disabled = false;
    modeSelect.disabled = false;

    statusDiv.textContent = "길안내를 중지했습니다. (스페이스: 분석 시작)";
    logPerformance("길찾기 안내 중지됨");
    speak("길찾기 안내를 중지했습니다.");
  }

  function finishNavigation() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      logPerformance("GPS 위치 추적 완료됨");
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
        logPerformance(`세션 종료 요청 실패: ${err.message}`);
      });
      navigationSession = null;
    }

    isNavigating = false;
    isProcessing = false; // 분석 중 상태 플래그를 확실하게 초기화
    if (isAutoCapturing) {
      isAutoCapturing = false;
      clearTimeout(captureLoop);
      window.speechSynthesis.cancel();
      // 서버에도 자동 처리 중지를 명시적으로 요청
      fetch("/stop_auto_processing", { method: "POST" })
        .then((res) => res.json())
        .then((data) =>
          logPerformance(
            `서버 중지 응답: ${data.message || JSON.stringify(data)}`
          )
        )
        .catch((err) => logPerformance(`서버 중지 요청 실패: ${err}`));
    }

    // 버튼 및 UI 상태를 완전히 초기 상태로 복원
    captureButton.textContent = "시작";
    captureButton.classList.remove("stop");
    captureButton.disabled = false;
    directionsButton.textContent = "📍 길찾기";
    directionsButton.disabled = false;
    settingsButton.disabled = false;
    modelSelect.disabled = false;
    intervalInput.disabled = false;
    modeSelect.disabled = false;

    statusDiv.textContent = "🎉 목적지 도착! (스페이스: 분석 시작)";
    logPerformance("길찾기 안내 완료");
    speak("목적지에 도착했습니다. 길안내를 종료합니다.");
  }

  logPerformance("페이지 로드 완료, 모델 목록 및 카메라 초기화 시작");

  loadTTSSpeed();
  initializeSpeechRecognition();

  loadModels().then(() => {
    startCamera();
  });
});
