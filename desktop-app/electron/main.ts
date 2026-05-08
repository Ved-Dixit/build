import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// (node-llama-cpp dynamically imported)

// IPC Logic for Models
const modelsDir = path.join(app.getPath('userData'), 'models');
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

// Hugging Face Hub Integration

// Hugging Face Hub Integration

ipcMain.handle('search-hf-models', async (event, query: string) => {
  console.log('Searching HF models for:', query);
  try {
    const { listModels } = await (eval('import("@huggingface/hub")') as Promise<any>);
    // Add "gguf" to query to help the search engine find GGUF specialized repos
    const searchQuery = query.toLowerCase().includes('gguf') ? query : `${query} GGUF`;
    
    const searchIterator = listModels({
      search: { query: searchQuery },
      sort: 'downloads',
      direction: -1
    } as any);
    
    const results = [];
    for await (const model of searchIterator) {
      // Check if it has a GGUF tag or GGUF in the name
      const hasGgufTag = (model as any).tags?.includes('gguf');
      const hasGgufInName = model.name.toLowerCase().includes('gguf');
      
      if (hasGgufTag || hasGgufInName) {
        results.push({ name: model.name, id: model.name, tags: (model as any).tags || [] });
      }
      if (results.length >= 20) break;
    }
    console.log(`Found ${results.length} models with GGUF keyword/tag`);
    return { success: true, models: results };
  } catch (error: any) {
    console.error('Error searching models:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('generate', async (event, prompt: string) => {
  if (!currentSession) return { success: false, error: 'No model loaded' };
  try {
    const response = await currentSession.prompt(prompt);
    return { success: true, text: response };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// ... (other handlers)

ipcMain.handle('get-models', async () => {
  try {
    const files = fs.readdirSync(modelsDir);
    console.log('Local models found:', files);
    return files.filter(f => f.endsWith('.gguf'));
  } catch (e) {
    console.error('Error listing models:', e);
    return [];
  }
});

let currentSession: any = null;
let currentModel: any = null;
let currentContext: any = null;

ipcMain.handle('load-model', async (event, modelName: string) => {
  console.log('Loading model:', modelName);
  const modelPath = path.join(modelsDir, modelName);
  if (!fs.existsSync(modelPath)) {
    console.error('Model path does not exist:', modelPath);
    return { success: false, error: 'Model not found' };
  }
  
  try {
    const { getLlama, LlamaChatSession } = await (eval('import("node-llama-cpp")') as Promise<any>);
    const llama = await getLlama();
    currentModel = await llama.loadModel({ modelPath });
    currentContext = await currentModel.createContext();
    currentSession = new LlamaChatSession({ contextSequence: currentContext.getSequence() });
    console.log('Model loaded successfully');
    return { success: true };
  } catch (e: any) {
    console.error('Error loading model:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-hf-model-files', async (event, repoId: string) => {
  console.log('Fetching files for repo:', repoId);
  try {
    const { listFiles } = await (eval('import("@huggingface/hub")') as Promise<any>);
    const fileIterator = listFiles({ repo: repoId });
    const ggufFiles = [];
    for await (const file of fileIterator) {
      const isGguf = file.path.toLowerCase().endsWith('.gguf');
      if (isGguf && file.type === 'file') {
        ggufFiles.push({ path: file.path, size: file.size });
      }
    }
    console.log(`Found ${ggufFiles.length} GGUF files`);
    return { success: true, files: ggufFiles };
  } catch (error: any) {
    console.error('Error fetching files:', error);
    return { success: false, error: error.message };
  }
});

const downloadFile = (url: string, filename: string, event: any, resolve: any, reject: any) => {
  const filePath = path.join(modelsDir, filename);
  
  https.get(url, (response) => {
    // Handle Redirects
    if (response.statusCode === 301 || response.statusCode === 302) {
      const redirectUrl = response.headers.location;
      if (redirectUrl) {
        console.log('Following redirect to:', redirectUrl);
        downloadFile(redirectUrl, filename, event, resolve, reject);
        return;
      }
    }

    if (response.statusCode !== 200) {
      reject(new Error(`Failed to download: ${response.statusCode}`));
      return;
    }
    
    const file = fs.createWriteStream(filePath);
    const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
    let downloadedBytes = 0;
    let lastTime = Date.now();
    let lastBytes = 0;
    
    response.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const now = Date.now();
      const timeDiff = now - lastTime;
      
      if (timeDiff >= 1000) {
        const bytesSinceLast = downloadedBytes - lastBytes;
        const speedBps = bytesSinceLast / (timeDiff / 1000); 
        const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
        
        const remainingBytes = totalBytes - downloadedBytes;
        const etaSeconds = speedBps > 0 ? Math.round(remainingBytes / speedBps) : 0;
        
        const progress = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
        event.sender.send('download-progress', { filename, progress, speed: speedMBps, eta: etaSeconds });
        
        lastTime = now;
        lastBytes = downloadedBytes;
      }
    });
    
    response.pipe(file);
    
    file.on('finish', () => {
      file.close();
      event.sender.send('download-progress', { filename, progress: 100, speed: 0, eta: 0 });
      resolve({ success: true, filePath });
    });

    file.on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  }).on('error', (err) => {
    fs.unlink(filePath, () => {});
    reject(err);
  });
};

ipcMain.handle('download-model', async (event, url: string, filename: string) => {
  console.log('Downloading model from:', url);
  return new Promise((resolve, reject) => {
    downloadFile(url, filename, event, resolve, reject);
  });
});

import { dialog } from 'electron';

ipcMain.handle('export-code', async (event, code: string) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Project Directory',
    properties: ['openDirectory', 'createDirectory']
  });
  
  if (canceled || filePaths.length === 0) return { success: false };
  
  const targetDir = filePaths[0];
  try {
    fs.writeFileSync(path.join(targetDir, 'generated_code.txt'), code, 'utf-8');
    return { success: true, path: targetDir };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

const historyFile = path.join(app.getPath('userData'), 'history.json');
ipcMain.handle('get-history', async () => {
  try {
    if (!fs.existsSync(historyFile)) return { success: true, history: [] };
    const data = fs.readFileSync(historyFile, 'utf-8');
    return { success: true, history: JSON.parse(data) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-history', async (event, history: any) => {
  try {
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});
