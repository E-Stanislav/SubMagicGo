const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const os = require('os');
const urlModule = require('url');

// Keep a global reference of the window object
let mainWindow;

// Whisper models configuration
const whisperModels = {
  // Tiny models (smallest)
  "tiny-q5_1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin", size: 31 * 1024 * 1024 },
  "tiny.en-q5_1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin", size: 31 * 1024 * 1024 },
  "tiny-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q8_0.bin", size: 42 * 1024 * 1024 },
  "tiny.en-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q8_0.bin", size: 42 * 1024 * 1024 },
  "tiny": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin", size: 75 * 1024 * 1024 },
  "tiny.en": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin", size: 75 * 1024 * 1024 },
  
  // Base models
  "base-q5_1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin", size: 57 * 1024 * 1024 },
  "base.en-q5_1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin", size: 57 * 1024 * 1024 },
  "base-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin", size: 78 * 1024 * 1024 },
  "base.en-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q8_0.bin", size: 78 * 1024 * 1024 },
  "base": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin", size: 142 * 1024 * 1024 },
  "base.en": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin", size: 142 * 1024 * 1024 },
  
  // Small models
  "small-q5_1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin", size: 181 * 1024 * 1024 },
  "small.en-q5_1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin", size: 181 * 1024 * 1024 },
  "small-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q8_0.bin", size: 252 * 1024 * 1024 },
  "small.en-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q8_0.bin", size: 252 * 1024 * 1024 },
  "small": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin", size: 466 * 1024 * 1024 },
  "small.en": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin", size: 466 * 1024 * 1024 },
  "small.en-tdrz": { url: "https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-small.en-tdrz.bin", size: 465 * 1024 * 1024 },
  
  // Medium models
  "medium-q5_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin", size: 514 * 1024 * 1024 },
  "medium.en-q5_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-q5_0.bin", size: 514 * 1024 * 1024 },
  "medium-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q8_0.bin", size: 785 * 1024 * 1024 },
  "medium.en-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-q8_0.bin", size: 785 * 1024 * 1024 },
  "medium": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin", size: 1531 * 1024 * 1024 },
  "medium.en": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin", size: 1531 * 1024 * 1024 },
  
  // Large models
  "large-v2-q5_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v2-q5_0.bin", size: 1100 * 1024 * 1024 },
  "large-v3-q5_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin", size: 1100 * 1024 * 1024 },
  "large-v2-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v2-q8_0.bin", size: 1500 * 1024 * 1024 },
  "large-v3-turbo": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin", size: 1500 * 1024 * 1024 },
  "large-v3-turbo-q5_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin", size: 547 * 1024 * 1024 },
  "large-v3-turbo-q8_0": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin", size: 834 * 1024 * 1024 },
  "large-v1": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v1.bin", size: 2900 * 1024 * 1024 },
  "large-v2": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v2.bin", size: 2900 * 1024 * 1024 },
  "large-v3": { url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin", size: 2902 * 1024 * 1024 },
  
  // Distil models
  "distil-medium.en": { url: "https://huggingface.co/distil-whisper/distil-medium.en/resolve/main/ggml-distil-medium.en.bin", size: 418 * 1024 * 1024 },
  "distil-large-v2": { url: "https://huggingface.co/distil-whisper/distil-large-v2/resolve/main/ggml-distil-large-v2.bin", size: 1100 * 1024 * 1024 }
};

// Get models directory
const getModelsDir = () => {
  const modelsDir = path.join(app.getPath('userData'), 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
};

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'renderer/assets/icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App event handlers
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers

// File dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// List models
ipcMain.handle('list-models', async () => {
  const modelsDir = getModelsDir();
  const models = [];
  
  // Sort models by size
  const sortedModelNames = Object.keys(whisperModels).sort((a, b) => 
    whisperModels[a].size - whisperModels[b].size
  );
  
  for (const modelName of sortedModelNames) {
    const modelInfo = whisperModels[modelName];
    const fileName = path.basename(modelInfo.url);
    const localPath = path.join(modelsDir, fileName);
    
    try {
      const stats = fs.statSync(localPath);
      models.push({
        name: modelName,
        url: modelInfo.url,
        local: true,
        size: stats.size,
        expectedSize: modelInfo.size,
        filename: fileName
      });
    } catch (error) {
      models.push({
        name: modelName,
        url: modelInfo.url,
        local: false,
        size: 0,
        expectedSize: modelInfo.size,
        filename: fileName
      });
    }
  }
  
  return models;
});

function downloadWithRedirect(url, dest, maxRedirects = 5, progressCb) {
  return new Promise((resolve, reject) => {
    const doRequest = (url, redirectsLeft) => {
      const parsedUrl = urlModule.parse(url);
      const getModule = parsedUrl.protocol === 'https:' ? https : http;
      const req = getModule.get(url, (res) => {
        // Redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft === 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          doRequest(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        const totalSize = parseInt(res.headers['content-length'], 10);
        let downloadedSize = 0;
        res.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (progressCb && totalSize) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            progressCb(progress);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(dest);
        });
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      });
      req.on('error', reject);
    };
    doRequest(url, maxRedirects);
  });
}

// Download model
ipcMain.handle('download-model', async (event, modelName) => {
  if (!whisperModels[modelName]) {
    throw new Error('Unknown model');
  }
  
  const modelInfo = whisperModels[modelName];
  const modelsDir = getModelsDir();
  const fileName = path.basename(modelInfo.url);
  const localPath = path.join(modelsDir, fileName);
  
  // Check if already downloaded
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  
  return await downloadWithRedirect(modelInfo.url, localPath, 5, (progress) => {
    mainWindow.webContents.send('download-progress', { modelName, progress });
  });
});

// Delete model
ipcMain.handle('delete-model', async (event, modelName) => {
  if (!whisperModels[modelName]) {
    throw new Error('Unknown model');
  }
  
  const modelInfo = whisperModels[modelName];
  const modelsDir = getModelsDir();
  const fileName = path.basename(modelInfo.url);
  const localPath = path.join(modelsDir, fileName);
  
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
  }
  
  return true;
});

// Generate subtitles
ipcMain.handle('generate-subtitles', async (event, { filePath, modelName }) => {
  if (!whisperModels[modelName]) {
    throw new Error('Unknown model');
  }
  const modelInfo = whisperModels[modelName];
  const modelsDir = getModelsDir();
  const fileName = path.basename(modelInfo.url);
  const modelPath = path.join(modelsDir, fileName);
  if (!fs.existsSync(modelPath)) {
    throw new Error('Model not found. Please download it first.');
  }
  const whisperPath = path.join(__dirname, 'whisper-cli');
  const outputPath = filePath + '.srt';
  return new Promise((resolve, reject) => {
    // Always use Russian language
    const cmd = `"${whisperPath}" -m "${modelPath}" -f "${filePath}" -otxt -osrt -l ru`;
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Whisper error: ${error.message}`));
        return;
      }
      try {
        const srtContent = fs.readFileSync(outputPath, 'utf8');
        resolve({ srt: srtContent });
      } catch (readError) {
        reject(new Error(`Failed to read SRT file: ${readError.message}`));
      }
    });
  });
});

// Generate subtitles chunk
ipcMain.handle('generate-subtitles-chunk', async (event, { filePath, modelName, startSec, endSec }) => {
  if (!whisperModels[modelName]) {
    throw new Error('Unknown model');
  }
  const modelInfo = whisperModels[modelName];
  const modelsDir = getModelsDir();
  const fileName = path.basename(modelInfo.url);
  const modelPath = path.join(modelsDir, fileName);
  if (!fs.existsSync(modelPath)) {
    throw new Error('Model not found. Please download it first.');
  }
  const whisperPath = path.join(__dirname, 'whisper-cli');
  const chunkPath = `${filePath}_chunk_${startSec}_${endSec}.wav`;
  const outputPath = chunkPath + '.srt';
  return new Promise((resolve, reject) => {
    // First, extract audio chunk using ffmpeg
    const ffmpegCmd = `ffmpeg -i "${filePath}" -ss ${startSec} -to ${endSec} -vn -acodec pcm_s16le -ar 16000 -ac 1 "${chunkPath}" -y`;
    exec(ffmpegCmd, (ffmpegError, ffmpegStdout, ffmpegStderr) => {
      if (ffmpegError) {
        reject(new Error(`FFmpeg error: ${ffmpegError.message}`));
        return;
      }
      // Always use Russian language
      const whisperCmd = `"${whisperPath}" -m "${modelPath}" -f "${chunkPath}" -otxt -osrt -l ru`;
      exec(whisperCmd, (whisperError, whisperStdout, whisperStderr) => {
        try { fs.unlinkSync(chunkPath); } catch (e) {}
        if (whisperError) {
          reject(new Error(`Whisper error: ${whisperError.message}`));
          return;
        }
        try {
          const srtContent = fs.readFileSync(outputPath, 'utf8');
          try { fs.unlinkSync(outputPath); } catch (e) {}
          resolve(srtContent);
        } catch (readError) {
          reject(new Error(`Failed to read SRT file: ${readError.message}`));
        }
      });
    });
  });
});

// Save SRT file
ipcMain.handle('save-srt', async (event, { content, defaultPath }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'subtitles.srt',
    filters: [
      { name: 'SRT Files', extensions: ['srt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return result.filePath;
  }
  
  return null;
});

// Open external link
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
}); 