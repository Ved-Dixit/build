import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Download, Terminal, Settings, MessageSquare, Play, Box, Search, X, FolderOutput, History, Trash2 } from 'lucide-react';
import { Editor } from '@monaco-editor/react';

export default function App() {
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [repoFiles, setRepoFiles] = useState<any[]>([]);
  const [isFetchingFiles, setIsFetchingFiles] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ [key: string]: number }>({});
  const [downloadStats, setDownloadStats] = useState<{ [key: string]: { speed: string, eta: number } }>({});
  
  // History State
  const [showHistory, setShowHistory] = useState(false);
  const [savedHistories, setSavedHistories] = useState<any[]>([]);

  // Editor State
  const [activeCode, setActiveCode] = useState('');
  const [activeLanguage, setActiveLanguage] = useState('javascript');
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('code');

  useEffect(() => {
    // If contextIsolation is false, we can use window.require
    console.log('Initializing App component');
    try {
      const { ipcRenderer } = (window as any).require('electron');
      console.log('ipcRenderer found, fetching models...');
      ipcRenderer.invoke('get-models').then((res: any) => {
        console.log('Models received:', res);
        setModels(res);
      });
      ipcRenderer.invoke('get-history').then((res: any) => {
        if (res.success) {
          console.log('History received:', res.history.length);
          setSavedHistories(res.history);
          
          // Auto-load latest code if exists
          if (res.history.length > 0) {
            const lastSession = res.history[0];
            const codeMsg = [...lastSession.messages].reverse().find(m => m.content.includes('```'));
            if (codeMsg) {
              const match = codeMsg.content.match(/```(\w+)?\n([\s\S]*?)```/);
              if (match) {
                setActiveLanguage(match[1] || 'javascript');
                setActiveCode(match[2]);
              }
            }
          }
        }
      });
      
      ipcRenderer.on('download-progress', (event: any, { filename, progress, speed, eta }: any) => {
        console.log(`Download progress for ${filename}: ${progress}%`);
        setDownloadProgress(prev => ({ ...prev, [filename]: progress }));
        if (speed !== undefined) {
          setDownloadStats(prev => ({ ...prev, [filename]: { speed, eta } }));
        }
        if (progress === 100) {
          ipcRenderer.invoke('get-models').then(setModels);
        }
      });
    } catch (e) {
      console.warn('Electron IPC not available, using mock data:', e);
      setModels(['CodeLlama-7B-GGUF', 'DeepSeek-Coder-1.3B-GGUF']);
      setSelectedModel('CodeLlama-7B-GGUF');
    }
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    setIsSearching(true);
    setSelectedRepo(null);
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const res = await ipcRenderer.invoke('search-hf-models', searchQuery);
      if (res.success) setSearchResults(res.models);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectRepo = async (repoId: string) => {
    console.log('Frontend: Selecting repo:', repoId);
    setSelectedRepo(repoId);
    setIsFetchingFiles(true);
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const res = await ipcRenderer.invoke('get-hf-model-files', repoId);
      console.log('Frontend: Received files:', res);
      if (res.success) {
        setRepoFiles(res.files);
      } else {
        console.error('Frontend: Error fetching files:', res.error);
      }
    } catch (e) {
      console.error('Frontend: Exception in handleSelectRepo:', e);
    } finally {
      setIsFetchingFiles(false);
    }
  };

  const handleDownload = async (repoId: string, filePath: string) => {
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const url = `https://huggingface.co/${repoId}/resolve/main/${filePath}`;
      const filename = filePath.split('/').pop() || 'model.gguf';
      setDownloadProgress(prev => ({ ...prev, [filename]: 0 }));
      await ipcRenderer.invoke('download-model', url, filename);
    } catch (e) {
      console.error(e);
    }
  };

  const handleGenerate = async () => {
    if (!prompt || !selectedModel) return;
    const newMessages = [...messages, { role: 'user', content: prompt }];
    setMessages(newMessages);
    setPrompt('');
    setIsGenerating(true);
    
    try {
      const { ipcRenderer } = (window as any).require('electron');
      // Ensure model is loaded first
      await ipcRenderer.invoke('load-model', selectedModel);
      
      const result = await ipcRenderer.invoke('generate', prompt);
      if (result.success) {
        const finalMessages = [...newMessages, { role: 'assistant', content: result.text }];
        setMessages(finalMessages);
        saveHistory(finalMessages);

        // Extract code for side panel
        const match = result.text.match(/```(\w+)?\n([\s\S]*?)```/);
        if (match) {
          setActiveLanguage(match[1] || 'javascript');
          setActiveCode(match[2]);
        }
      } else {
        const finalMessages = [...newMessages, { role: 'assistant', content: `Error: ${result.error}` }];
        setMessages(finalMessages);
        saveHistory(finalMessages);
      }
    } catch (e: any) {
      // Mock generation fallback
      setTimeout(() => {
        const fakeMessages = [...newMessages, { role: 'assistant', content: '```javascript\n// Generated Code (Mock)\nconsole.log("Hello from Buildio!");\n```' }];
        setMessages(fakeMessages);
        saveHistory(fakeMessages);
      }, 1500);
    } finally {
      setIsGenerating(false);
    }
  };

  const saveHistory = async (msgs: any[]) => {
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const newHistory = { id: Date.now(), title: msgs[0]?.content.substring(0, 30) + '...', messages: msgs };
      const updated = [newHistory, ...savedHistories];
      setSavedHistories(updated);
      await ipcRenderer.invoke('save-history', updated);
    } catch (e) {
      console.log('Mock save history');
    }
  };

  const loadHistory = (historyObj: any) => {
    setMessages(historyObj.messages);
    setShowHistory(false);
  };

  const handleExportCode = async (code: string) => {
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const res = await ipcRenderer.invoke('export-code', code);
      if (res.success) {
        alert(`Code exported successfully to:\n${res.path}`);
      }
    } catch (e) {
      console.log('Mock export');
    }
  };

  return (
    <>
    <div className="flex h-screen w-screen bg-[#09090b] text-gray-100 font-sans">
      {/* Sidebar */}
      <div className="w-64 border-r border-[#27272a] bg-[#0c0c0f] flex flex-col pt-8 pb-4">
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-[0_0_15px_rgba(79,70,229,0.5)]">
            <Box size={18} className="text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight">Buildio</span>
        </div>

        <div className="px-4 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Local Models</div>
        <div className="flex-1 px-3 overflow-y-auto no-drag space-y-1">
          {models.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-500 italic text-center bg-gray-900/20 rounded-xl border border-dashed border-gray-800">
              No models found.<br/>Click below to download.
            </div>
          ) : (
            models.map(model => (
              <button
                key={model}
                onClick={() => setSelectedModel(model)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${selectedModel === model ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-gray-400 hover:bg-[#18181b] hover:text-gray-200 border border-transparent'}`}
              >
                <span className="truncate">{model}</span>
                {selectedModel === model && <div className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" />}
              </button>
            ))
          )}
          
          <button onClick={() => setIsSearchOpen(true)} className="w-full mt-4 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm border border-dashed border-indigo-500/50 text-indigo-400 hover:border-indigo-400 hover:text-indigo-300 transition-all bg-indigo-500/5 hover:bg-indigo-500/10">
            <Search size={14} />
            Search Hugging Face
          </button>
        </div>

        <div className="px-4 mt-auto space-y-1 no-drag">
          <button onClick={() => setShowHistory(true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-[#18181b] hover:text-gray-200 transition-all">
            <History size={16} />
            History
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-[#18181b] hover:text-gray-200 transition-all">
            <Settings size={16} />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-row relative overflow-hidden">
        {/* Topbar drag region for Mac window controls */}
        <div className="h-8 w-full absolute top-0 left-0 z-20" style={{ WebkitAppRegion: 'drag' } as any}></div>
        
        {/* Chat Panel */}
        <div className={`flex flex-col border-r border-[#27272a] transition-all duration-300 ${activeCode ? 'w-[400px]' : 'w-full max-w-4xl mx-auto'}`}>
          <div className="flex-1 overflow-y-auto space-y-6 p-6 pt-12 no-drag">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                <Terminal size={48} className="mb-4 text-gray-600" />
                <h2 className="text-xl font-medium mb-2">Buildio Local AI</h2>
                <p className="text-sm max-w-sm mb-6">
                  Buildio runs powerful open-source models completely on your device.
                </p>
                {models.length === 0 ? (
                  <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-6 max-w-xs">
                    <Download size={24} className="mx-auto mb-3 text-indigo-400" />
                    <p className="text-xs text-indigo-300 mb-4">You haven't downloaded any models yet.</p>
                    <button 
                      onClick={() => setIsSearchOpen(true)}
                      className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-500 transition-colors"
                    >
                      Search Hugging Face
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    Select a model from the sidebar to start generating code.
                  </p>
                )}
              </div>
            ) : (
              messages.map((msg, idx) => {
                const textContent = msg.content.includes('```') ? msg.content.split('```')[0] : msg.content;
                const hasCode = msg.content.includes('```');
                
                return (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={idx} 
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[90%] rounded-2xl p-4 flex flex-col gap-2 ${msg.role === 'user' ? 'bg-[#18181b] border border-[#27272a]' : 'bg-transparent border border-[#27272a]'}`}>
                      {textContent && <div className="text-sm text-gray-300 leading-relaxed">{textContent}</div>}
                      {hasCode && (
                        <button 
                          onClick={() => {
                            const match = msg.content.match(/```(\w+)?\n([\s\S]*?)```/);
                            if (match) {
                              setActiveLanguage(match[1] || 'javascript');
                              setActiveCode(match[2]);
                            }
                          }}
                          className="text-[10px] uppercase font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-3 py-1.5 rounded-lg inline-flex items-center gap-2 self-start hover:bg-indigo-500/20 transition-all cursor-pointer"
                        >
                          <Terminal size={12} />
                          View Code in Editor
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
            {isGenerating && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="bg-transparent border border-[#27272a] rounded-2xl p-4 flex items-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </motion.div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-[#27272a]">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
              <div className="relative bg-[#0c0c0f] border border-[#27272a] rounded-2xl flex items-end p-2 focus-within:border-indigo-500/50 transition-colors">
                <textarea 
                  className="flex-1 bg-transparent border-none outline-none resize-none p-3 text-sm max-h-32 min-h-[44px]"
                  placeholder="Ask me to write some code..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                  rows={1}
                />
                <button 
                  onClick={handleGenerate}
                  disabled={!prompt || isGenerating}
                  className="p-3 mb-1 mr-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-500 text-white transition-colors"
                >
                  <Play size={16} className="ml-0.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Editor/Preview Panel */}
        {activeCode && (
          <div className="flex-1 flex flex-col bg-[#09090b] no-drag">
            <div className="h-14 border-b border-[#27272a] flex items-center justify-between px-6 bg-[#0c0c0f]">
              <div className="flex gap-4">
                <button 
                  onClick={() => setActiveTab('code')}
                  className={`text-sm font-medium transition-colors ${activeTab === 'code' ? 'text-indigo-400 border-b-2 border-indigo-500 pb-4 mt-4' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Code
                </button>
                <button 
                  onClick={() => setActiveTab('preview')}
                  className={`text-sm font-medium transition-colors ${activeTab === 'preview' ? 'text-indigo-400 border-b-2 border-indigo-500 pb-4 mt-4' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Preview
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] uppercase font-bold text-gray-500 border border-[#27272a] px-2 py-1 rounded">
                  {activeLanguage}
                </span>
                <button 
                  onClick={() => handleExportCode(activeCode)}
                  className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-all"
                  title="Export to Project"
                >
                  <FolderOutput size={18} />
                </button>
              </div>
            </div>
            
            <div className="flex-1 relative">
              {activeTab === 'code' ? (
                <Editor
                  height="100%"
                  language={activeLanguage}
                  theme="vs-dark"
                  value={activeCode}
                  onChange={(val) => setActiveCode(val || '')}
                  options={{ 
                    minimap: { enabled: false }, 
                    fontSize: 14, 
                    padding: { top: 20 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              ) : (
                <div className="w-full h-full bg-white overflow-hidden">
                  <iframe 
                    title="Preview"
                    className="w-full h-full border-none"
                    srcDoc={`
                      <html>
                        <head>
                          <style>body { font-family: sans-serif; }</style>
                        </head>
                        <body>
                          ${activeLanguage === 'html' ? activeCode : `<pre>${activeCode}</pre>`}
                          ${activeLanguage === 'javascript' ? `<script>${activeCode}</script>` : ''}
                        </body>
                      </html>
                    `}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Search Modal */}
    {isSearchOpen && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-3xl bg-[#0c0c0f] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[80vh]"
        >
          <div className="p-4 border-b border-[#27272a] flex justify-between items-center bg-[#18181b]">
            <h2 className="text-lg font-bold flex items-center gap-2"><Search size={18} className="text-indigo-400"/> Search Hugging Face</h2>
            <button onClick={() => setIsSearchOpen(false)} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          
          <div className="flex-1 overflow-hidden flex flex-col">
            <form onSubmit={handleSearch} className="p-4 border-b border-[#27272a]">
              <div className="relative">
                <input 
                  type="text" 
                  autoFocus
                  placeholder="e.g. DeepSeek Coder, Llama 3..."
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500/50"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button type="submit" disabled={isSearching} className="absolute right-2 top-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg">
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
            </form>

            <div className="flex-1 flex overflow-hidden">
              {/* Models List */}
              <div className="w-1/2 border-r border-[#27272a] overflow-y-auto p-4 space-y-2">
                {searchResults.map(model => (
                  <button 
                    key={model.id}
                    onClick={() => handleSelectRepo(model.id)}
                    className={`w-full text-left p-3 rounded-xl border ${selectedRepo === model.id ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-[#27272a] bg-[#18181b] hover:border-gray-600'} transition-all`}
                  >
                    <div className="font-semibold text-sm truncate">{model.name}</div>
                    <div className="text-xs text-gray-500 mt-1 truncate">{model.tags?.filter((t:string)=>t!=='gguf').slice(0,3).join(', ')}</div>
                  </button>
                ))}
                {searchResults.length === 0 && !isSearching && searchQuery && (
                  <div className="text-center text-gray-500 mt-10">No GGUF models found.</div>
                )}
              </div>

              {/* Files List */}
              <div className="w-1/2 overflow-y-auto p-4 bg-[#09090b]">
                {selectedRepo ? (
                  <>
                    <h3 className="text-sm font-semibold text-gray-400 mb-4 truncate">{selectedRepo}</h3>
                    {isFetchingFiles ? (
                      <div className="text-sm text-indigo-400 animate-pulse">Loading quantizations...</div>
                    ) : (
                      <div className="space-y-2">
                        {repoFiles.map(file => {
                          const filename = file.path.split('/').pop();
                          const progress = downloadProgress[filename] || 0;
                          const stats = downloadStats[filename];
                          const isDownloading = progress > 0 && progress < 100;
                          const isDownloaded = progress === 100 || models.includes(filename);
                          
                          return (
                            <div key={file.path} className="p-3 bg-[#18181b] rounded-xl border border-[#27272a] flex flex-col gap-2">
                              <div className="flex justify-between items-start">
                                <span className="text-sm font-medium break-all">{filename}</span>
                                <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
                                  {(file.size / 1024 / 1024 / 1024).toFixed(2)} GB
                                </span>
                              </div>
                              
                              <div className="flex items-center gap-2 mt-1">
                                {isDownloading ? (
                                  <div className="flex-1 flex flex-col gap-1">
                                    <div className="bg-[#09090b] rounded-full h-2 overflow-hidden w-full">
                                      <div className="bg-indigo-500 h-full transition-all" style={{ width: `${progress}%` }}></div>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-gray-500">
                                      <span>{stats ? `${stats.speed} MB/s` : 'Starting...'}</span>
                                      <span>{stats && stats.eta > 0 ? `${Math.floor(stats.eta / 60)}m ${stats.eta % 60}s left` : ''}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <button 
                                    onClick={() => handleDownload(selectedRepo, file.path)}
                                    disabled={isDownloaded}
                                    className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 ${isDownloaded ? 'bg-green-500/20 text-green-400' : 'bg-indigo-600 hover:bg-indigo-500 text-white'}`}
                                  >
                                    <Download size={12} />
                                    {isDownloaded ? 'Downloaded' : 'Download'}
                                  </button>
                                )}
                                {isDownloading && <span className="text-xs text-indigo-400 min-w-[32px] text-right">{progress}%</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600 text-sm">
                    Select a model to view files
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    )}

    {/* History Modal */}
    {showHistory && (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#0c0c0f] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        >
          <div className="p-4 border-b border-[#27272a] flex justify-between items-center bg-[#18181b]">
            <h2 className="text-lg font-bold flex items-center gap-2"><History size={18} className="text-indigo-400"/> Chat History</h2>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {savedHistories.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">No saved sessions found.</div>
            ) : (
              savedHistories.map((h, i) => (
                <button
                  key={i}
                  onClick={() => loadHistory(h)}
                  className="w-full text-left p-3 rounded-xl border border-[#27272a] bg-[#18181b] hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all flex justify-between items-center"
                >
                  <div>
                    <div className="font-medium text-sm text-gray-200">{h.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{new Date(h.id).toLocaleString()}</div>
                  </div>
                  <MessageSquare size={16} className="text-gray-600" />
                </button>
              ))
            )}
          </div>
        </motion.div>
      </div>
    )}
    </>
  );
}
