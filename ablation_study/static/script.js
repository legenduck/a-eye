document.addEventListener("DOMContentLoaded", () => {
  const currentImage = document.getElementById("current-image");
  const captureButton = document.getElementById("capture-button");
  const statusDiv = document.getElementById("status");
  const modeSelect = document.getElementById("mode-select");
  const modelSelect = document.getElementById("model-select");
  const imageInfo = document.getElementById("image-info");
  const performanceInfo = document.getElementById("performance-info");
  const prevButton = document.getElementById("prev-button");
  const nextButton = document.getElementById("next-button");
  const reportButton = document.getElementById("report-button");
  const clearDataButton = document.getElementById("clear-data-button");
  const reportModal = document.getElementById("report-modal");
  const closeModal = document.querySelector(".close");
  const reportContent = document.getElementById("report-content");

  let isProcessing = false;
  let isAutoCapturing = false;
  let imageList = [];
  let currentImageIndex = 0;
  let modelList = [];
  let currentModelId = "";

  function logPerformance(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  async function loadModelList() {
    try {
      logPerformance("Model list loading started");
      const response = await fetch("/get_models");
      const data = await response.json();

      if (data.models && data.models.length > 0) {
        modelList = data.models;
        updateModelSelect();
        logPerformance(`Model list loaded: ${modelList.length} models`);
      } else {
        statusDiv.textContent = "No available models";
        logPerformance("Model list is empty");
      }
    } catch (error) {
      statusDiv.textContent = "Failed to load model list";
      logPerformance(`Failed to load model list: ${error}`);
      console.error("Error loading model list:", error);
    }
  }

  function updateModelSelect() {
    modelSelect.innerHTML = "";

    modelList.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name} (${model.type})`;
      modelSelect.appendChild(option);
    });

    if (modelList.length > 0) {
      currentModelId = modelList[0].id;
      modelSelect.value = currentModelId;
      logPerformance(`Default model selected: ${currentModelId}`);
    }
  }

  async function loadImageList() {
    try {
      logPerformance("Image list loading started");
      const response = await fetch("/get_image_list");
      const data = await response.json();

      if (data.images && data.images.length > 0) {
        imageList = data.images;
        currentImageIndex = 0;
        logPerformance(`Image list loaded: ${imageList.length} files`);
        updateImageInfo();
        await loadCurrentImage();
        enableControls();
      } else {
        statusDiv.textContent =
          "No test images found. Add images to the test_file folder.";
        logPerformance("Image file not found");
      }
    } catch (error) {
      statusDiv.textContent = "Failed to load image list";
      logPerformance(`Failed to load image list: ${error}`);
      console.error("Error loading image list:", error);
    }
  }

  async function loadCurrentImage() {
    if (imageList.length === 0) return;

    const imageName = imageList[currentImageIndex];
    logPerformance(
      `Image loading started: ${imageName} (${currentImageIndex + 1}/${
        imageList.length
      })`
    );

    return new Promise((resolve, reject) => {
      try {
        currentImage.onload = () => {
          logPerformance(`Image loaded: ${imageName}`);
          updateImageInfo();
          updateNavigationButtons();
          resolve();
        };
        currentImage.onerror = () => {
          logPerformance(`Image load failed: ${imageName}`);
          statusDiv.textContent = `Image load failed: ${imageName}`;
          reject(new Error(`Image load failed: ${imageName}`));
        };
        currentImage.src = `/get_image/${imageName}`;
      } catch (error) {
        logPerformance(`Image load error: ${error}`);
        console.error("Error loading image:", error);
        reject(error);
      }
    });
  }

  function updateImageInfo() {
    if (imageList.length > 0) {
      imageInfo.textContent = `${currentImageIndex + 1}/${imageList.length}`;
      statusDiv.textContent = `Current image: ${imageList[currentImageIndex]}`;
    }
  }

  function updatePerformanceInfo(performance) {
    if (performance) {
      performanceInfo.textContent = `${performance.model_name}: ${performance.total_time} (API: ${performance.api_call_time})`;
    } else {
      performanceInfo.textContent = "-";
    }
  }

  function updateNavigationButtons() {
    prevButton.disabled = currentImageIndex === 0;
    nextButton.disabled = currentImageIndex === imageList.length - 1;
  }

  function enableControls() {
    captureButton.disabled = false;
    statusDiv.textContent = "Ready";
  }

  async function moveToNextImage() {
    if (currentImageIndex < imageList.length - 1) {
      currentImageIndex++;
      await loadCurrentImage();
      logPerformance(
        `Moved to next image: ${currentImageIndex + 1}/${imageList.length}`
      );
    } else {
      logPerformance("Reached the last image");
      if (isAutoCapturing) {
        stopAutoCapture();
        statusDiv.textContent = "All images processed";
        showPerformanceReport();
      }
    }
  }

  async function moveToPrevImage() {
    if (currentImageIndex > 0) {
      currentImageIndex--;
      await loadCurrentImage();
      logPerformance(
        `Moved to previous image: ${currentImageIndex + 1}/${imageList.length}`
      );
    }
  }

  async function captureAndDescribe(onComplete) {
    if (isProcessing) {
      logPerformance("Already processing, ignoring request");
      if (onComplete) onComplete();
      return;
    }

    if (
      !currentImage.src ||
      !currentImage.complete ||
      currentImage.naturalWidth === 0
    ) {
      logPerformance("Image not loaded yet, waiting...");
      setTimeout(() => captureAndDescribe(onComplete), 100);
      return;
    }

    const totalStart = performance.now();
    logPerformance("=== New image analysis started ===");

    isProcessing = true;
    statusDiv.textContent = "Analyzing...";
    currentModelId = modelSelect.value;

    try {
      const captureStart = performance.now();
      const canvas = document.createElement("canvas");
      canvas.width = currentImage.naturalWidth || currentImage.width;
      canvas.height = currentImage.naturalHeight || currentImage.height;
      const context = canvas.getContext("2d");
      context.drawImage(currentImage, 0, 0);
      const captureTime = performance.now() - captureStart;
      logPerformance(
        `Image capture completed - resolution: ${canvas.width}x${
          canvas.height
        }, time: ${captureTime.toFixed(3)}ms`
      );

      const blobStart = performance.now();
      canvas.toBlob(
        async (blob) => {
          const blobTime = performance.now() - blobStart;
          logPerformance(
            `Blob conversion completed - size: ${
              blob.size
            } bytes, time: ${blobTime.toFixed(3)}ms`
          );

          const formDataStart = performance.now();
          const formData = new FormData();
          formData.append("image", blob, `test_${currentImageIndex + 1}.jpg`);
          formData.append("model", currentModelId);
          formData.append("image_name", imageList[currentImageIndex]);
          const formDataTime = performance.now() - formDataStart;
          logPerformance(
            `FormData prepared - model: ${currentModelId}, time: ${formDataTime.toFixed(
              3
            )}ms`
          );

          try {
            const requestStart = performance.now();
            logPerformance("Server request started...");

            const response = await fetch("/describe", {
              method: "POST",
              body: formData,
            });

            const requestTime = performance.now() - requestStart;
            logPerformance(
              `Server response received - status: ${
                response.status
              }, time: ${requestTime.toFixed(3)}ms`
            );

            if (!response.ok)
              throw new Error(`Server error: ${response.statusText}`);

            const parseStart = performance.now();
            const data = await response.json();
            const parseTime = performance.now() - parseStart;
            logPerformance(
              `Response parsing completed - time: ${parseTime.toFixed(3)}ms`
            );

            if (data.description) {
              statusDiv.textContent = data.description;
              updatePerformanceInfo(data.performance);
              logPerformance(
                `Analysis result: "${data.description}" (${data.description.length} chars)`
              );

              const ttsStart = performance.now();
              speak(data.description, () => {
                const ttsTime = performance.now() - ttsStart;
                const totalTime = performance.now() - totalStart;
                logPerformance(`TTS completed - time: ${ttsTime.toFixed(3)}ms`);
                logPerformance(
                  `=== Total processing completed - total time: ${totalTime.toFixed(
                    3
                  )}ms ===`
                );
                logPerformance(
                  `Time analysis: capture(${captureTime.toFixed(
                    1
                  )}ms) + Blob(${blobTime.toFixed(
                    1
                  )}ms) + server(${requestTime.toFixed(
                    1
                  )}ms) + TTS(${ttsTime.toFixed(1)}ms)`
                );

                if (onComplete) onComplete();
              });
            } else {
              throw new Error(data.error || "No content");
            }
          } catch (err) {
            const errorTime = performance.now() - totalStart;
            logPerformance(
              `Analysis request failed - total time: ${errorTime.toFixed(
                3
              )}ms, error: ${err}`
            );
            console.error("Analysis request error:", err);
            statusDiv.textContent = "Analysis failed";
            updatePerformanceInfo(null);
            speak("Error occurred", onComplete);
          } finally {
            isProcessing = false;
          }
        },
        "image/jpeg",
        0.9
      );
    } catch (error) {
      const errorTime = performance.now() - totalStart;
      logPerformance(
        `Capture process error - total time: ${errorTime.toFixed(
          3
        )}ms, error: ${error}`
      );
      console.error("Capture error:", error);
      statusDiv.textContent = "Image capture failed";
      updatePerformanceInfo(null);
      isProcessing = false;
      if (onComplete) onComplete();
    }
  }

  function speak(text, onEndCallback) {
    const ttsStart = performance.now();
    logPerformance(`TTS started - text: "${text}"`);

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 1.2;

    utterance.onend = () => {
      const ttsTime = performance.now() - ttsStart;
      logPerformance(`TTS completed - time: ${ttsTime.toFixed(3)}ms`);
      if (onEndCallback) {
        onEndCallback();
      }
    };

    utterance.onerror = (event) => {
      const ttsTime = performance.now() - ttsStart;
      logPerformance(
        `TTS error occurred - time: ${ttsTime.toFixed(3)}ms, error: ${
          event.error
        }`
      );
      console.error("SpeechSynthesis Error:", event.error);
      if (onEndCallback) {
        onEndCallback();
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  async function runAutoCapture() {
    if (!isAutoCapturing) return;

    const mode = modeSelect.value;
    logPerformance(`Auto capture started - mode: ${mode}`);

    if (mode === "tts_end") {
      await new Promise((resolve) => {
        captureAndDescribe(async () => {
          if (isAutoCapturing) {
            try {
              await moveToNextImage();
              if (currentImageIndex < imageList.length) {
                logPerformance("Image loaded, next analysis started");
                setTimeout(() => runAutoCapture(), 200);
              } else {
                stopAutoCapture();
              }
            } catch (error) {
              logPerformance(`Image load failed: ${error}`);
              stopAutoCapture();
            }
          }
          resolve();
        });
      });
    }
  }

  // Stop auto capture
  function stopAutoCapture() {
    logPerformance("Auto capture stop requested");
    isAutoCapturing = false;
    window.speechSynthesis.cancel();

    captureButton.textContent = "Start";
    captureButton.classList.remove("stop");
    modeSelect.disabled = false;
    modelSelect.disabled = false;
    prevButton.disabled = false;
    nextButton.disabled = false;
    statusDiv.textContent = "Auto capture stopped";
    logPerformance("Auto capture stopped");
    updateNavigationButtons();
  }

  async function showPerformanceReport() {
    try {
      reportContent.innerHTML = "<p>Generating report...</p>";
      reportModal.style.display = "block";

      const response = await fetch("/performance_report");
      const data = await response.json();

      if (data.error) {
        reportContent.innerHTML = `<p>Error: ${data.error}</p>`;
        return;
      }

      generateReportHTML(data);
      logPerformance("Performance report display completed");
    } catch (error) {
      reportContent.innerHTML = `<p>Error generating report: ${error}</p>`;
      logPerformance(`Error generating report: ${error}`);
    }
  }

  function generateReportHTML(data) {
    let html = `<h3>Total tests: ${data.total_tests}개</h3>`;

    if (Object.keys(data.report).length === 0) {
      html += "<p>No successful tests</p>";
      reportContent.innerHTML = html;
      return;
    }

    for (const [modelId, stats] of Object.entries(data.report)) {
      html += `
                <div class="model-report">
                    <div class="model-header">
                        ${stats.model_name} (${stats.count} tests)
                    </div>
                    <div class="performance-summary">
                        <h4>Average performance</h4>
                        <table>
                            <tr><th>Item</th><th>Time</th></tr>
                            <tr><td>Total</td><td>${stats.average_times.total}</td></tr>
                            <tr><td>API call</td><td>${stats.average_times.api_call}</td></tr>
                            <tr><td>File receive</td><td>${stats.average_times.file_receive}</td></tr>
                            <tr><td>PIL conversion</td><td>${stats.average_times.pil_conversion}</td></tr>
                            <tr><td>Prompt preparation</td><td>${stats.average_times.prompt_preparation}</td></tr>
                            <tr><td>Response processing</td><td>${stats.average_times.response_processing}</td></tr>
                        </table>
                    </div>
                    <div class="responses-section">
                        <h4>Response results</h4>`;

      stats.responses.forEach((resp) => {
        html += `
                    <div class="response-item">
                        <div class="response-header">${resp.image} (${resp.total_time})</div>
                        <div class="response-text">"${resp.response}"</div>
                    </div>`;
      });

      html += `</div></div>`;
    }

    reportContent.innerHTML = html;
  }

  async function clearPerformanceData() {
    try {
      const response = await fetch("/clear_performance_data", {
        method: "POST",
      });
      const data = await response.json();

      if (data.message) {
        logPerformance("Performance data cleared");
        updatePerformanceInfo(null);
        alert("Performance data cleared");
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (error) {
      logPerformance(`Error clearing performance data: ${error}`);
      alert(`Data initialization failed: ${error}`);
    }
  }

  captureButton.addEventListener("click", () => {
    if (isAutoCapturing) {
      stopAutoCapture();
    } else {
      logPerformance(
        `Auto capture started - model: ${currentModelId}, mode: ${modeSelect.value}`
      );
      isAutoCapturing = true;
      captureButton.textContent = "Stop";
      captureButton.classList.add("stop");
      modeSelect.disabled = true;
      modelSelect.disabled = true;
      prevButton.disabled = true;
      nextButton.disabled = true;

      runAutoCapture();
    }
  });

  modelSelect.addEventListener("change", () => {
    currentModelId = modelSelect.value;
    logPerformance(`Model changed: ${currentModelId}`);
  });

  prevButton.addEventListener("click", async () => {
    if (!isAutoCapturing && !isProcessing) {
      await moveToPrevImage();
    }
  });

  nextButton.addEventListener("click", async () => {
    if (!isAutoCapturing && !isProcessing) {
      await moveToNextImage();
    }
  });

  reportButton.addEventListener("click", showPerformanceReport);
  clearDataButton.addEventListener("click", clearPerformanceData);

  closeModal.addEventListener("click", () => {
    reportModal.style.display = "none";
  });

  window.addEventListener("click", (event) => {
    if (event.target === reportModal) {
      reportModal.style.display = "none";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!isAutoCapturing && !isProcessing) {
      if (event.key === "ArrowLeft") {
        moveToPrevImage();
      } else if (event.key === "ArrowRight") {
        moveToNextImage();
      } else if (event.key === " ") {
        event.preventDefault();
        captureAndDescribe(() => {});
      } else if (event.key === "r" || event.key === "R") {
        showPerformanceReport();
      }
    }
  });

  async function initialize() {
    logPerformance("Model Performance Study page loaded");
    await loadModelList();
    await loadImageList();
  }

  initialize();
});
