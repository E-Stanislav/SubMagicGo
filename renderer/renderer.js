// DOM elements
const $ = id => document.getElementById(id);
const video = $("video");
const openBtn = $("openBtn");
const playPauseBtn = $("playPauseBtn");
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const subBtn = $("subBtn");
const exportBtn = $("exportBtn");
const controls = $("controls");
const closeBtn = $("closeMediaBtn");
const videoTitle = $("videoTitle");
const overlay = $("subtitleOverlay");

// State variables
let currentFilePath = null;
let currentSrt = '';
let selectedModel = localStorage.getItem('whisperModel') || 'tiny';
let lang = 'ru'; // Always Russian
let availableModels = [];
let downloadedModels = [];
let downloading = false;

// Utility functions
const show = el => el.style.display = '';
const hide = el => el.style.display = 'none';

// Format file size
function formatModelSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  return (bytes / 1024 / 1024).toFixed(0) + ' MB';
}

// Show error dialog
function showErrorDialog(message) {
  console.log("showErrorDialog called with:", message);
  if (!message) return;
  
  // Remove existing modal if any
  let existingModal = document.getElementById('errorModal');
  if (existingModal) {
    existingModal.remove();
  }
  
  // Create new modal
  const modal = document.createElement('div');
  modal.id = 'errorModal';
  modal.style = 'position:fixed;left:0;top:0;width:100vw;height:100vh;background:#0007;z-index:99999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;color:#222;border-radius:12px;box-shadow:0 4px 24px #0003;padding:2rem 2.5rem;min-width:320px;max-width:90vw;text-align:center;">
      <div id="errorModalText" style="font-size:1.1rem;margin-bottom:1.5rem;"></div>
      <button id="errorModalOk" style="background:#4fa3ff;color:#fff;border:none;border-radius:8px;padding:0.5em 1.5em;font-size:1rem;cursor:pointer;">OK</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  document.getElementById('errorModalText').textContent = message;
  modal.style.display = 'flex';
  
  // Add click handler to close modal
  const okBtn = document.getElementById('errorModalOk');
  const closeModal = () => {
    modal.remove();
  };
  
  okBtn.addEventListener('click', closeModal);
  
  // Also close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

// Custom confirm dialog
function customConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('deleteConfirmModal');
    const text = document.getElementById('deleteConfirmText');
    const yes = document.getElementById('deleteConfirmYes');
    const no = document.getElementById('deleteConfirmNo');
    
    text.textContent = message;
    modal.style.display = 'flex';
    
    function cleanup(result) {
      modal.style.display = 'none';
      yes.removeEventListener('click', onYes);
      no.removeEventListener('click', onNo);
      resolve(result);
    }
    
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    
    yes.addEventListener('click', onYes);
    no.addEventListener('click', onNo);
  });
}

// Tab switching
const editorTab = document.querySelector('.menu-btn.active');
const settingsTab = document.querySelectorAll('.menu-btn')[1];
const editorPanel = document.getElementById('editorPanel');
const settingsPanel = document.getElementById('settingsPanel');

function showEditor() {
  editorPanel.style.display = '';
  settingsPanel.style.display = 'none';
  editorTab.classList.add('active');
  settingsTab.classList.remove('active');
}

function showSettings() {
  editorPanel.style.display = 'none';
  settingsPanel.style.display = '';
  editorTab.classList.remove('active');
  settingsTab.classList.add('active');
  loadModels();
}

editorTab.addEventListener('click', showEditor);
settingsTab.addEventListener('click', showSettings);

// Video controls
playPauseBtn.addEventListener("click", () => {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
});

video.addEventListener("play", () => {
  playPauseBtn.textContent = "⏸";
});

video.addEventListener("pause", () => {
  playPauseBtn.textContent = "▶";
});

// File handling
openBtn.addEventListener("click", async () => {
  try {
    const filePath = await window.electronAPI.openFileDialog();
    if (filePath) {
      loadVideo(filePath);
    }
  } catch (error) {
    console.error('Error opening file:', error);
    showErrorDialog("Ошибка при открытии файла: " + error.message);
  }
});

// Drag and drop handling
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropzone.classList.remove("dragover");
  
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];
    console.log('File dropped:', file.name);
    
    // In Electron, we need to use the file dialog to get the full path
    showErrorDialog(`Файл "${file.name}" перетащен. Пожалуйста, используйте кнопку "Открыть" для выбора файла.`);
  }
});

dropzone.addEventListener("click", () => {
  openBtn.click();
});

// Load video function
function loadVideo(filePath) {
  console.log('Loading video:', filePath);
  
  if (!filePath) {
    showErrorDialog("Ошибка: не удалось получить путь к файлу.");
    return;
  }
  
  currentFilePath = filePath;
  const fileName = filePath.split(/[\\/]/).pop();
  
  // Check file extension
  const fileExtension = fileName.toLowerCase().split('.').pop();
  const supportedFormats = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'];
  
  if (!supportedFormats.includes(fileExtension)) {
    showErrorDialog(`Неподдерживаемый формат файла: .${fileExtension}. Поддерживаемые форматы: ${supportedFormats.join(', ')}`);
    return;
  }
  
  try {
    video.src = filePath;
    videoTitle.textContent = fileName;
    
    // Video event handlers
    video.onerror = (e) => {
      console.error('Video loading error:', e);
      showErrorDialog("Ошибка загрузки видео. Проверьте, что файл существует и поддерживается.");
      currentFilePath = null;
      hide(video);
      hide(videoTitle);
      hide(controls);
      show(dropzone);
    };
    
    video.onloadeddata = () => {
      console.log('Video loaded successfully, duration:', video.duration);
      show(video);
      show(videoTitle);
      show(controls);
      hide(dropzone);
    };
    
  } catch (error) {
    console.error('Error in loadVideo:', error);
    showErrorDialog("Ошибка при загрузке видео: " + error.message);
    currentFilePath = null;
  }
}

// Subtitle generation
subBtn.addEventListener("click", async () => {
  console.log("currentFilePath on subBtn click:", currentFilePath);
  
  if (!currentFilePath) {
    showErrorDialog("Сначала выберите видео! Используйте кнопку 'Открыть' или перетащите файл.");
    return;
  }
  
  if (!currentFilePath.trim()) {
    showErrorDialog("Ошибка: путь к файлу пустой. Попробуйте выбрать файл заново.");
    return;
  }
  
  // Check if model is available
  if (!selectedModel) {
    showErrorDialog("Сначала выберите модель Whisper в настройках!");
    return;
  }
  
  console.log("Starting subtitle generation for file:", currentFilePath);
  
  subBtn.disabled = true;
  subBtn.textContent = "Генерация...";
  
  overlay.style.display = "";
  
  let chunkSec = 10;
  let duration = Math.floor(video.duration);
  let subtitles = [];
  let isGenerating = false;
  let interval = null;
  
  function showSubtitle(text) {
    overlay.textContent = text;
    overlay.style.opacity = text ? "1" : "0";
  }
  
  async function fetchAndShowChunk(chunkIdx) {
    if (isGenerating) return; // Prevent multiple simultaneous requests
    
    let start = chunkIdx * chunkSec;
    let end = Math.min(start + chunkSec, duration);
    if (start >= duration) {
      showSubtitle("");
      return;
    }
    
    console.log(`Generating chunk ${chunkIdx}: ${start}s - ${end}s`);
    
    isGenerating = true;
    
    try {
      const srt = await window.electronAPI.generateSubtitlesChunk({
        filePath: currentFilePath,
        modelName: selectedModel,
        lang: 'ru', // Always Russian
        startSec: start,
        endSec: end
      });
      
      let text = srt.split("\n").filter(line => line && !/^\d+$/.test(line) && !/^\d{2}:\d{2}/.test(line)).join(" ");
      subtitles[chunkIdx] = text;
      showSubtitle(text);
      console.log(`Chunk ${chunkIdx} generated successfully`);
    } catch (err) {
      console.error(`Error generating chunk ${chunkIdx}:`, err);
      // Only show error for first chunk, for others just show error text
      if (chunkIdx === 0) {
        showErrorDialog("Ошибка генерации субтитров: " + (err && err.message ? err.message : err));
      }
      showSubtitle("[Ошибка субтитров]");
    } finally {
      isGenerating = false;
    }
  }
  
  // Start interval for subtitle generation
  interval = setInterval(() => {
    if (video.paused || video.ended) return;
    let chunkIdx = Math.floor(video.currentTime / chunkSec);
    if (subtitles[chunkIdx] === undefined) {
      fetchAndShowChunk(chunkIdx);
    } else {
      showSubtitle(subtitles[chunkIdx]);
    }
  }, 500);
  
  // Clean up function
  const cleanup = () => {
    showSubtitle("");
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    overlay.style.display = "none";
  };
  
  video.addEventListener("ended", cleanup);
  
  closeBtn.addEventListener("click", cleanup);
  
  // Generate first chunk
  try {
    await fetchAndShowChunk(0);
  } catch (error) {
    console.error("Error generating first chunk:", error);
    showErrorDialog("Ошибка при запуске генерации субтитров: " + error.message);
    cleanup();
  }
  
  subBtn.disabled = false;
  subBtn.textContent = "Создать субтитры";
});

// Export SRT
exportBtn.addEventListener("click", async () => {
  if (!currentSrt) {
    showErrorDialog("Нет субтитров для экспорта. Сначала создайте субтитры.");
    return;
  }
  
  try {
    const fileName = currentFilePath ? currentFilePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '.srt') : 'subtitles.srt';
    const savedPath = await window.electronAPI.saveSrt({
      content: currentSrt,
      defaultPath: fileName
    });
    
    if (savedPath) {
      console.log('SRT saved to:', savedPath);
    }
  } catch (error) {
    console.error('Error saving SRT:', error);
    showErrorDialog("Ошибка при сохранении файла: " + error.message);
  }
});

// Close media
closeBtn.addEventListener("click", () => {
  video.pause();
  video.removeAttribute("src");
  video.load();
  hide(video);
  hide(videoTitle);
  hide(exportBtn);
  hide(controls);
  dropzone.querySelector("span").innerHTML = "Перетащите видеофайл сюда<br>или нажмите, чтобы выбрать";
  show(dropzone);
  currentFilePath = null;
  currentSrt = '';
  fileInput.value = "";
  overlay.style.display = "none";
});

// Model management
async function loadModels() {
  const modelSelect = document.getElementById('modelSelect');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadProgressDiv = document.getElementById('downloadProgress');
  const modelsListDiv = document.getElementById('modelsList');
  const emptyListDiv = document.getElementById('emptyList');
  
  modelSelect.innerHTML = '';
  modelsListDiv.innerHTML = '';
  emptyListDiv.style.display = 'none';
  
  try {
    const all = await window.electronAPI.listModels();
    
    // Sort by size
    availableModels = all.filter(m => !m.local).sort((a, b) => (a.expectedSize || a.size || 0) - (b.expectedSize || b.size || 0));
    downloadedModels = all.filter(m => m.local).sort((a, b) => (a.expectedSize || a.size || 0) - (b.expectedSize || b.size || 0));
    
    // Update selected model if current one is not available
    if (selectedModel && !downloadedModels.find(m => m.name === selectedModel)) {
      if (downloadedModels.length > 0) {
        selectedModel = downloadedModels[0].name;
        localStorage.setItem('whisperModel', selectedModel);
      } else {
        selectedModel = null;
        localStorage.removeItem('whisperModel');
      }
    }
    
    // Render download block
    if (availableModels.length === 0) {
      modelSelect.disabled = true;
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Нет новых моделей';
    } else {
      modelSelect.disabled = false;
      downloadBtn.disabled = false;
      
      // Group models by size
      const modelGroups = {
        'tiny': availableModels.filter(m => m.name.includes('tiny')),
        'base': availableModels.filter(m => m.name.includes('base') && !m.name.includes('distil')),
        'small': availableModels.filter(m => m.name.includes('small')),
        'medium': availableModels.filter(m => m.name.includes('medium') && !m.name.includes('distil')),
        'large': availableModels.filter(m => m.name.includes('large')),
        'distil': availableModels.filter(m => m.name.includes('distil'))
      };
      
      // Add options to select with grouping
      Object.entries(modelGroups).forEach(([groupName, models]) => {
        if (models.length > 0) {
          // Add group separator
          const groupOpt = document.createElement('option');
          groupOpt.disabled = true;
          groupOpt.textContent = `--- ${groupName.toUpperCase()} ---`;
          modelSelect.appendChild(groupOpt);
          
          // Add group models
          models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            const size = formatModelSize(m.expectedSize || m.size);
            const lang = m.name.includes('.en') ? ' (EN)' : m.name.includes('distil') ? ' (Fast)' : '';
            opt.textContent = `${m.name}${lang} (${size})`;
            modelSelect.appendChild(opt);
          });
        }
      });
      
      modelSelect.value = availableModels[0].name;
      downloadBtn.textContent = 'Скачать';
    }
    
    // Download button logic
    let selectedModelForDownload = modelSelect.value;
    modelSelect.onchange = e => { selectedModelForDownload = e.target.value; };
    
    downloadBtn.onclick = async () => {
      if (!selectedModelForDownload || downloading) return;
      
      downloading = true;
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Загрузка...';
      downloadProgressDiv.style.display = 'block';
      downloadProgressDiv.textContent = '0%';
      
      try {
        await window.electronAPI.downloadModel(selectedModelForDownload);
      } catch (e) {
        console.error('Download error:', e);
        downloadProgressDiv.textContent = 'Ошибка загрузки';
        showErrorDialog("Ошибка загрузки модели: " + e.message);
      } finally {
        downloading = false;
        loadModels();
        downloadProgressDiv.style.display = 'none';
      }
    };
    
    // Render downloaded models
    if (downloadedModels.length === 0) {
      emptyListDiv.style.display = 'block';
      emptyListDiv.textContent = 'Нет загруженных моделей Whisper';
      return;
    }
    
    emptyListDiv.style.display = 'none';
    
    // Group downloaded models by size
    const downloadedGroups = {
      'tiny': downloadedModels.filter(m => m.name.includes('tiny')),
      'base': downloadedModels.filter(m => m.name.includes('base') && !m.name.includes('distil')),
      'small': downloadedModels.filter(m => m.name.includes('small')),
      'medium': downloadedModels.filter(m => m.name.includes('medium') && !m.name.includes('distil')),
      'large': downloadedModels.filter(m => m.name.includes('large')),
      'distil': downloadedModels.filter(m => m.name.includes('distil'))
    };
    
    Object.entries(downloadedGroups).forEach(([groupName, models]) => {
      if (models.length > 0) {
        // Add group header
        const groupHeader = document.createElement('div');
        groupHeader.className = 'whisper-group-header';
        groupHeader.textContent = groupName.toUpperCase();
        modelsListDiv.appendChild(groupHeader);
        
        // Add group models
        models.forEach(model => {
          const card = document.createElement('div');
          card.className = 'whisper-model-card';
          
          // Left part: icon + radio + name + status
          const info = document.createElement('div');
          info.className = 'whisper-model-info';
          
          const icon = document.createElement('span');
          icon.className = 'whisper-model-icon';
          icon.innerHTML = `<svg fill='none' stroke='currentColor' stroke-width='2' viewBox='0 0 24 24'><rect x='3' y='7' width='18' height='13' rx='3'/><path d='M16 3v4M8 3v4'/></svg>`;
          
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'activeModel';
          radio.value = model.name;
          radio.checked = selectedModel === model.name;
          radio.className = 'whisper-radio';
          radio.onchange = () => {
            selectedModel = model.name;
            localStorage.setItem('whisperModel', selectedModel);
            loadModels();
          };
          
          const name = document.createElement('span');
          name.textContent = model.filename || model.name;
          name.className = 'whisper-model-name';
          
          const status = document.createElement('span');
          status.className = 'whisper-model-status downloaded';
          status.innerHTML = formatModelSize(model.expectedSize || model.size);
          
          info.appendChild(icon);
          info.appendChild(radio);
          info.appendChild(name);
          info.appendChild(status);
          
          // Right part: delete
          const actions = document.createElement('div');
          actions.className = 'whisper-model-actions';
          
          const btnDelete = document.createElement('button');
          btnDelete.className = 'whisper-btn-delete';
          btnDelete.textContent = 'Удалить';
          btnDelete.onclick = async (e) => {
            e.stopPropagation();
            const confirmed = await customConfirm(`Удалить модель ${model.filename || model.name}?`);
            if (confirmed) {
              try {
                await window.electronAPI.deleteModel(model.name);
                loadModels();
              } catch (error) {
                console.error('Delete error:', error);
                showErrorDialog("Ошибка удаления модели: " + error.message);
              }
            }
          };
          
          actions.appendChild(btnDelete);
          card.appendChild(info);
          card.appendChild(actions);
          modelsListDiv.appendChild(card);
        });
      }
    });
    
  } catch (e) {
    console.error('Load models error:', e);
    emptyListDiv.style.display = 'block';
    emptyListDiv.textContent = 'Ошибка загрузки моделей Whisper';
  }
}

// Download progress handler
window.electronAPI.onDownloadProgress((data) => {
  const downloadProgressDiv = document.getElementById('downloadProgress');
  if (!downloadProgressDiv) return;
  
  if (data.modelName === document.getElementById('modelSelect').value) {
    downloadProgressDiv.style.display = 'block';
    downloadProgressDiv.textContent = data.progress + '%';
    if (data.progress >= 100) {
      downloadProgressDiv.style.display = 'none';
    }
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('SubMagic Electron app loaded');
}); 