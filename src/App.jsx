import React, { useState, useEffect, useRef } from 'react';
import {
  Wifi,
  Share2,
  Clipboard,
  FileText,
  HardDrive,
  Smartphone,
  Laptop,
  Tablet,
  RefreshCw,
  UploadCloud,
  Download,
  Trash2,
  Copy,
  Check,
  FileImage,
  FileVideo,
  FileArchive,
  Search,
  Tv,
  HelpCircle,
  Clock,
  Lock,
  LogOut
} from 'lucide-react';

// Determine device name & type using UserAgent
function getDeviceMetadata() {
  const ua = navigator.userAgent;
  let name = 'Web Client';
  let deviceType = 'other';

  if (/iPad|Macintosh/i.test(ua) && 'ontouchend' in document) {
    name = 'iPad';
    deviceType = 'tablet';
  } else if (/iPhone/i.test(ua)) {
    name = 'iPhone';
    deviceType = 'mobile';
  } else if (/Windows/i.test(ua)) {
    name = 'Windows PC';
    deviceType = 'desktop';
  } else if (/Mac/i.test(ua)) {
    name = 'Mac';
    deviceType = 'desktop';
  } else if (/Android/i.test(ua)) {
    name = 'Android Device';
    deviceType = 'mobile';
  } else if (/Linux/i.test(ua)) {
    name = 'Linux PC';
    deviceType = 'desktop';
  }
  
  return { name, deviceType };
}

// Utility to format bytes into readable sizes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Utility to format dates
function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + date.toLocaleDateString();
}

// Get file category based on extension
function getFileCategory(ext) {
  const extension = ext.toLowerCase();
  const categories = {
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp'],
    video: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'],
    doc: ['.pdf', '.txt', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.md'],
    archive: ['.zip', '.rar', '.7z', '.tar', '.gz']
  };

  for (const [key, list] of Object.entries(categories)) {
    if (list.includes(extension)) return key;
  }
  return 'other';
}

export default function App() {
  // Navigation tabs for mobile screen sizing
  const [activeTab, setActiveTab] = useState('files'); // 'files', 'clipboard', 'devices'
  
  // Security state
  const [token, setToken] = useState(() => localStorage.getItem('airflow_token') || '');
  const [isAuthorized, setIsAuthorized] = useState(() => {
    const savedToken = localStorage.getItem('airflow_token');
    if (savedToken) return true;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  });
  const [pinInput, setPinInput] = useState('');
  const [canManageToken, setCanManageToken] = useState(false);
  const [isEditingToken, setIsEditingToken] = useState(false);
  const [newTokenInput, setNewTokenInput] = useState('');

  // App states
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [serverIps, setServerIps] = useState([]);
  const [selectedIp, setSelectedIp] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [files, setFiles] = useState([]);
  const [fileFilter, setFileFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [clipboard, setClipboard] = useState('');
  const [devices, setDevices] = useState([]);
  const [toastList, setToastList] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  
  // Track active transfers
  const [activeTransfers, setActiveTransfers] = useState({});

  const wsRef = useRef(null);
  const fileInputRef = useRef(null);
  const isSelfClipboardUpdate = useRef(false);
  const isAuthorizedRef = useRef(isAuthorized);
  isAuthorizedRef.current = isAuthorized;

  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;

  // Show visual alerts
  const showToast = (message, type = 'info') => {
    const id = Date.now();
    setToastList((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToastList((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Secure Fetch API wrapper
  const apiFetch = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'X-Access-Token': token
    };
    
    try {
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        setIsAuthorized(false);
        localStorage.removeItem('airflow_token');
        throw new Error('Unauthorized');
      }
      return res;
    } catch (err) {
      if (err.message === 'Unauthorized') throw err;
      throw new Error('Network error');
    }
  };

  // Fetch local IPs from Express backend
  const fetchIps = async () => {
    try {
      const res = await apiFetch('/api/ips');
      const data = await res.json();
      setServerIps(data.ips);
      
      // If we are loopback authorized, the server exposes the security token
      if (data.token) {
        localStorage.setItem('airflow_token', data.token);
        setToken(data.token);
        setCanManageToken(true);
      }

      if (data.ips.length > 0) {
        const wifiIp = data.ips.find(ip => ip.interface.toLowerCase().includes('wi-fi') || ip.interface.toLowerCase().includes('wireless'));
        setSelectedIp(wifiIp ? wifiIp.address : data.ips[0].address);
      } else {
        setSelectedIp(window.location.hostname);
      }
    } catch (err) {
      console.error('Failed to fetch server IPs:', err);
    }
  };

  // Fetch file list
  const fetchFiles = async () => {
    try {
      const res = await apiFetch('/api/files');
      const data = await res.json();
      setFiles(data);
    } catch (err) {
      console.error('Failed to fetch files:', err);
    }
  };

  // Generate dynamic QR Code URL
  useEffect(() => {
    if (!selectedIp || !isAuthorized) return;
    const port = window.location.port || '3000';
    // Append token to connection URL for zero-friction scan-to-unlock
    const connectionUrl = `http://${selectedIp}:${port}/?token=${encodeURIComponent(token)}`;
    
    const fetchQr = async () => {
      try {
        const res = await apiFetch(`/api/qr?url=${encodeURIComponent(connectionUrl)}`);
        const data = await res.json();
        setQrCodeUrl(data.qr);
      } catch (err) {
        console.error('Failed to fetch QR code:', err);
      }
    };
    fetchQr();
  }, [selectedIp, token, isAuthorized]);

  // Handle URL token detection on startup
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
      localStorage.setItem('airflow_token', urlToken.toUpperCase());
      setToken(urlToken.toUpperCase());
      setIsAuthorized(true);
      // Clean query parameters from URL bar
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Handle Initial Load and WebSockets Connection
  useEffect(() => {
    if (!isAuthorized) return;

    fetchIps();
    fetchFiles();

    // Setup WebSockets (include token in connection URL)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsWsConnected(true);
      const meta = getDeviceMetadata();
      ws.send(JSON.stringify({
        type: 'register',
        name: meta.name,
        deviceType: meta.deviceType
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'auth_failed':
            setIsAuthorized(false);
            localStorage.removeItem('airflow_token');
            showToast('Authentication failed. PIN required.', 'danger');
            ws.onclose = null;
            ws.close();
            break;

          case 'auth_revoked':
            setIsAuthorized(false);
            localStorage.removeItem('airflow_token');
            showToast('Host updated the Access PIN. Please re-authenticate.', 'warning');
            ws.onclose = null;
            ws.close();
            break;

          case 'pong':
            break;
            
          case 'clipboard_update':
            if (data.text !== clipboardRef.current) {
              isSelfClipboardUpdate.current = true;
              setClipboard(data.text);
              showToast('Clipboard updated from another device', 'info');
            }
            break;

          case 'devices_updated':
            setDevices(data.devices);
            break;

          case 'file_list_updated':
            fetchFiles();
            break;

          case 'upload_start':
            setActiveTransfers(prev => ({
              ...prev,
              [data.filename]: {
                progress: 0,
                sender: data.deviceName,
                type: 'incoming'
              }
            }));
            break;

          case 'upload_progress':
            setActiveTransfers(prev => {
              if (!prev[data.filename]) return prev;
              return {
                ...prev,
                [data.filename]: {
                  ...prev[data.filename],
                  progress: data.progress
                }
              };
            });
            break;

          case 'upload_end':
            setActiveTransfers(prev => {
              const updated = { ...prev };
              delete updated[data.filename];
              return updated;
            });
            fetchFiles();
            break;
        }
      } catch (err) {
        console.error('Error processing socket message:', err);
      }
    };

    ws.onclose = async (event) => {
      setIsWsConnected(false);
      if (!isAuthorizedRef.current) return;

      // Perform a health check to differentiate network drops from server shutdown
      try {
        const res = await fetch('/api/ips', {
          headers: { 'X-Access-Token': token }
        });
        
        if (res.status === 401) {
          // Token is invalid/passcode was changed -> Force logout
          localStorage.removeItem('airflow_token');
          setToken('');
          setIsAuthorized(false);
          showToast('Passcode changed. Logged out.', 'warning');
        } else {
          // Server is still alive -> Transient network drop, try to reconnect
          showToast('Connection lost. Reconnecting...', 'warning');
          setTimeout(() => {
            if (isAuthorizedRef.current) {
              window.location.reload();
            }
          }, 3000);
        }
      } catch (err) {
        // Fetch failed -> Server is offline/closed -> Force logout
        localStorage.removeItem('airflow_token');
        setToken('');
        setIsAuthorized(false);
        showToast('Server closed. Logged out.', 'error');
      }
    };

    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [token, isAuthorized]);

  // Sync clipboard state with server
  const lastSyncText = useRef('');
  useEffect(() => {
    if (!isAuthorized) return;
    
    if (isSelfClipboardUpdate.current) {
      isSelfClipboardUpdate.current = false;
      lastSyncText.current = clipboard;
      return;
    }

    if (clipboard === lastSyncText.current) return;

    const timeout = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'clipboard_update',
          text: clipboard
        }));
        lastSyncText.current = clipboard;
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [clipboard, isAuthorized]);

  // Upload file handler
  const handleUpload = (filesList) => {
    if (!filesList || filesList.length === 0 || !isAuthorized) return;

    const formData = new FormData();
    const filesArray = Array.from(filesList);
    
    filesArray.forEach((file) => {
      formData.append('files', file);
    });

    filesArray.forEach((file) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'upload_start',
          filename: file.name,
          size: file.size
        }));
      }
      
      setActiveTransfers(prev => ({
        ...prev,
        [file.name]: {
          progress: 0,
          sender: 'You',
          type: 'outgoing'
        }
      }));
    });

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload', true);
    xhr.setRequestHeader('X-Access-Token', token);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        
        filesArray.forEach((file) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'upload_progress',
              filename: file.name,
              progress: percent
            }));
          }

          setActiveTransfers(prev => {
            if (!prev[file.name]) return prev;
            return {
              ...prev,
              [file.name]: {
                ...prev[file.name],
                progress: percent
              }
            };
          });
        });
      }
    };

    xhr.onload = () => {
      filesArray.forEach((file) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'upload_end',
            filename: file.name
          }));
        }

        setActiveTransfers(prev => {
          const updated = { ...prev };
          delete updated[file.name];
          return updated;
        });
      });

      if (xhr.status === 200) {
        showToast('Uploaded successfully!', 'success');
        fetchFiles();
      } else if (xhr.status === 401) {
        setIsAuthorized(false);
        localStorage.removeItem('airflow_token');
        showToast('Session expired. PIN required.', 'danger');
      } else {
        showToast('Upload failed', 'danger');
      }
    };

    xhr.onerror = () => {
      filesArray.forEach((file) => {
        setActiveTransfers(prev => {
          const updated = { ...prev };
          delete updated[file.name];
          return updated;
        });
      });
      showToast('Network upload error', 'danger');
    };

    xhr.send(formData);
  };

  // Delete file
  const handleDelete = async (filename) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    try {
      const res = await apiFetch(`/api/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast('File deleted', 'success');
        fetchFiles();
      } else {
        showToast('Failed to delete file', 'danger');
      }
    } catch (err) {
      showToast('Delete error', 'danger');
    }
  };

  // Drag-and-drop actions
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files);
    }
  };

  // Helper to copy text in both secure (HTTPS/localhost) and unsecure (HTTP local IP) contexts
  const copyTextToClipboard = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('Modern copy failed, trying fallback...', err);
      }
    }

    // Fallback: Create temporary textarea
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.width = "2em";
    textArea.style.height = "2em";
    textArea.style.padding = "0";
    textArea.style.border = "none";
    textArea.style.outline = "none";
    textArea.style.boxShadow = "none";
    textArea.style.background = "transparent";
    
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    // For iOS device selection compatibility
    if (navigator.userAgent.match(/ipad|iphone/i)) {
      const range = document.createRange();
      range.selectNodeContents(textArea);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      textArea.setSelectionRange(0, 999999);
    }

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      document.body.removeChild(textArea);
      return false;
    }
  };

  // Clipboard copies
  const copyToSystemClipboard = async () => {
    const success = await copyTextToClipboard(clipboard);
    if (success) {
      showToast('Copied to system clipboard!', 'success');
    } else {
      showToast('Could not access clipboard', 'warning');
    }
  };

  const copyUrlToClipboard = async () => {
    const port = window.location.port || '3000';
    const connectionUrl = `http://${selectedIp}:${port}/?token=${encodeURIComponent(token)}`;
    const success = await copyTextToClipboard(connectionUrl);
    if (success) {
      showToast('Portal link copied!', 'success');
    } else {
      showToast('Link copying failed', 'warning');
    }
  };

  const handleUpdateToken = async () => {
    const trimmed = newTokenInput.trim().toUpperCase();
    if (trimmed.length < 3) {
      showToast('PIN must be at least 3 characters', 'warning');
      return;
    }
    try {
      const res = await apiFetch('/api/token/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('airflow_token', data.token);
        setToken(data.token);
        setIsEditingToken(false);
        showToast('Access PIN updated successfully!', 'success');
      } else {
        showToast('Failed to update PIN', 'danger');
      }
    } catch (err) {
      showToast('PIN update error', 'danger');
    }
  };

  // File rendering icon selector
  const renderFileIcon = (ext) => {
    const category = getFileCategory(ext);
    switch (category) {
      case 'image':
        return <div className="file-icon-box image"><FileImage size={20} /></div>;
      case 'video':
        return <div className="file-icon-box video"><FileVideo size={20} /></div>;
      case 'doc':
        return <div className="file-icon-box doc"><FileText size={20} /></div>;
      case 'archive':
        return <div className="file-icon-box archive"><FileArchive size={20} /></div>;
      default:
        return <div className="file-icon-box other"><HardDrive size={20} /></div>;
    }
  };

  // Filtering files
  const filteredFiles = files.filter(file => {
    const matchesSearch = file.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (fileFilter === 'all') return matchesSearch;
    return getFileCategory(file.ext) === fileFilter && matchesSearch;
  });

  // RENDER SECURITY LOCK SCREEN IF NOT AUTHORIZED
  if (!isAuthorized) {
    return (
      <div className="lockscreen-container">
        <div className="glass-panel lockscreen-card">
          <div className="lock-icon-box">
            <Lock size={28} />
          </div>
          <h2 className="lockscreen-title" style={{ fontFamily: 'var(--font-header)', fontWeight: 800, fontSize: '1.6rem', background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            vikuAir Secure Access
          </h2>
          <p className="lockscreen-desc" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            This local network sharing portal is secure. Please enter the Access PIN displayed on the host PC console window.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pinInput.trim()) {
                localStorage.setItem('airflow_token', pinInput.trim().toUpperCase());
                setToken(pinInput.trim().toUpperCase());
                setIsAuthorized(true);
                window.location.reload();
              }
            }}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <input
              type="text"
              placeholder="ENTER ACCESS PIN"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              className="lockscreen-input"
              maxLength={10}
              autoFocus
              id="lockscreen-pin-input"
            />
            <button type="submit" className="pill-btn" style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }} id="lockscreen-submit-btn">
              Unlock Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Header Bar */}
      <header className="app-header">
        <div className="brand-wrapper">
          <span className="brand-logo">📡</span>
          <div className="brand-title-group">
            <h1>vikuAir</h1>
            <div className="brand-subtitle">Local Network Sharing</div>
          </div>
        </div>
        <div className="header-status" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="connection-badge">
            <span className={`status-dot ${isWsConnected ? 'connected' : ''}`}></span>
            {isWsConnected ? 'Sync Active' : 'Disconnected'}
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('airflow_token');
              setToken('');
              setIsAuthorized(false);
              if (wsRef.current) {
                wsRef.current.close();
              }
            }}
            className="logout-btn-header"
            title="Log Out"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'hsla(350, 60%, 45%, 0.15)',
              border: '1px solid hsla(350, 60%, 45%, 0.3)',
              color: '#f87171',
              padding: '0.4rem 0.75rem',
              borderRadius: '50px',
              fontSize: '0.75rem',
              fontWeight: 600,
              gap: '0.35rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap'
            }}
            id="logout-btn"
          >
            <LogOut size={12} /> Log Out
          </button>
        </div>
      </header>

      {/* Tabs on Mobile */}
      <div className="tab-navigation-container mobile-only">
        <div className="tab-navigation">
          <button
            onClick={() => setActiveTab('files')}
            className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
            id="tab-btn-files"
          >
            <HardDrive size={16} /> Files
          </button>
          <button
            onClick={() => setActiveTab('clipboard')}
            className={`tab-btn ${activeTab === 'clipboard' ? 'active' : ''}`}
            id="tab-btn-clipboard"
          >
            <Clipboard size={16} /> Clipboard
          </button>
          <button
            onClick={() => setActiveTab('devices')}
            className={`tab-btn ${activeTab === 'devices' ? 'active' : ''}`}
            id="tab-btn-devices"
          >
            <Laptop size={16} /> Hub ({devices.length})
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* Left/Main Column - Files Upload & Explorer */}
        <section className={`main-column ${activeTab !== 'files' ? 'desktop-only' : ''}`}>
          
          {/* Drag & Drop File Zone */}
          <div
            className={`glass-panel dropzone ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current.click()}
            id="upload-dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="dropzone-input"
              onChange={(e) => handleUpload(e.target.files)}
              id="file-input-element"
            />
            <div className="dropzone-icon-wrapper">
              <UploadCloud size={30} />
            </div>
            <h2 className="dropzone-title">Share Files Instantly</h2>
            <p className="dropzone-desc">Drag & drop files here, or tap to browse folders / camera rolls</p>
          </div>

          {/* Active Transfers list */}
          {Object.keys(activeTransfers).length > 0 && (
            <div className="glass-panel">
              <h3 className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontFamily: 'var(--font-header)', fontWeight: 600 }}>
                <RefreshCw className="animate-spin" size={18} /> Active Transfers
              </h3>
              <div className="transfer-list">
                {Object.entries(activeTransfers).map(([filename, transfer]) => (
                  <div key={filename} className="transfer-item">
                    <div className="transfer-info">
                      <span className="transfer-name" title={filename}>{filename}</span>
                      <span className="transfer-percentage">
                        {transfer.type === 'incoming' ? `📥 [From ${transfer.sender}]` : '📤'} {transfer.progress}%
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-bar"
                        style={{ width: `${transfer.progress}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files Explorer Hub */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h2 style={{ fontFamily: 'var(--font-header)', fontWeight: 700, fontSize: '1.15rem' }}>Shared Files</h2>
              
              {/* Search Bar */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-dim)' }} />
                <input
                  type="text"
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    backgroundColor: 'hsla(220, 10%, 8%, 0.6)',
                    border: '1px solid var(--panel-border)',
                    borderRadius: '50px',
                    padding: '0.45rem 1rem 0.45rem 2.25rem',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    outline: 'none',
                    width: '180px'
                  }}
                  id="search-input-element"
                />
              </div>
            </div>

            {/* Filters Row */}
            <div className="file-filters">
              {['all', 'image', 'video', 'doc', 'archive', 'other'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFileFilter(cat)}
                  className={`filter-btn ${fileFilter === cat ? 'active' : ''}`}
                  id={`filter-btn-${cat}`}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>

            {/* File List Grid */}
            <div className="files-explorer">
              {filteredFiles.length === 0 ? (
                <div className="no-files-card">
                  <div className="no-files-icon">📦</div>
                  <div style={{ fontWeight: 600 }}>No shared files found</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    {searchQuery ? 'Try matching keywords' : 'Drag or select files above to populate the network hub'}
                  </div>
                </div>
              ) : (
                filteredFiles.map((file) => (
                  <div key={file.name} className="file-row-card">
                    <div className="file-meta-side">
                      {renderFileIcon(file.ext)}
                      <div className="file-details">
                        <span className="file-name-label" title={file.name}>{file.name}</span>
                        <div className="file-size-time" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>{formatBytes(file.size)}</span>
                          <span style={{ color: 'var(--text-dim)' }}>•</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}><Clock size={11} /> {formatTime(file.mtime)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="file-actions-side">
                      {/* Secure download by appending token to download URL */}
                      <a
                        href={`/api/files/download/${encodeURIComponent(file.name)}?token=${encodeURIComponent(token)}`}
                        download
                        className="action-btn download-btn"
                        title="Download file"
                        id={`download-btn-${file.name.replace(/\s+/g, '-')}`}
                      >
                        <Download size={16} />
                      </a>
                      <button
                        onClick={() => handleDelete(file.name)}
                        className="action-btn delete-btn"
                        title="Delete file"
                        id={`delete-btn-${file.name.replace(/\s+/g, '-')}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right/Sidebar Column - Connection, Clipboard & Active Hub */}
        <section className="sidebar-column">
          
          {/* Quick Connect Helper - ONLY shown on host server */}
          {canManageToken && (
            <div className={`glass-panel ${activeTab !== 'devices' ? 'desktop-only' : ''}`}>
              <h2 style={{ fontFamily: 'var(--font-header)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Wifi size={18} style={{ color: 'var(--secondary)' }} /> Connect Devices
              </h2>
              <div className="qr-container">
                {qrCodeUrl ? (
                  <div className="qr-box-wrapper">
                    <img src={qrCodeUrl} alt="Network Scan QR Link" className="qr-image" />
                  </div>
                ) : (
                  <div style={{ width: '180px', height: '180px', background: 'hsla(220, 10%, 15%, 0.4)', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RefreshCw className="animate-spin" size={24} />
                  </div>
                )}
                
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Scan QR with iPhone/iPad camera or enter local address in mobile browser:
                </p>

                {/* IP Addresses Dropdown & Copy Box */}
                <div className="ip-list">
                  {serverIps.length > 1 ? (
                    <select
                      value={selectedIp}
                      onChange={(e) => setSelectedIp(e.target.value)}
                      style={{
                        backgroundColor: 'hsla(220, 10%, 8%, 0.8)',
                        border: '1px solid var(--panel-border)',
                        borderRadius: '8px',
                        padding: '0.5rem',
                        color: 'var(--text-main)',
                        fontSize: '0.85rem',
                        outline: 'none',
                        width: '100%',
                        cursor: 'pointer'
                      }}
                      id="ip-selection-dropdown"
                    >
                      {serverIps.map((ip) => (
                        <option key={ip.address} value={ip.address}>
                          {ip.address} ({ip.interface})
                        </option>
                      ))}
                    </select>
                  ) : null}

                  <div className="ip-card">
                    <span className="ip-address">
                      http://{selectedIp}:{window.location.port || '3000'}
                    </span>
                    <button onClick={copyUrlToClipboard} className="copy-btn" title="Copy Address Link" id="copy-address-btn">
                      <Copy size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '0.5rem', width: '100%' }}>
                    {isEditingToken ? (
                      <div style={{ display: 'flex', gap: '0.4rem', width: '100%', marginTop: '0.25rem' }}>
                        <input
                          type="text"
                          value={newTokenInput}
                          onChange={(e) => setNewTokenInput(e.target.value.toUpperCase())}
                          style={{
                            backgroundColor: 'hsla(220, 10%, 8%, 0.8)',
                            border: '1px solid var(--panel-border)',
                            borderRadius: '6px',
                            padding: '0.3rem 0.5rem',
                            color: 'var(--text-main)',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            fontWeight: 'bold',
                            outline: 'none',
                            flexGrow: 1,
                            textAlign: 'center'
                          }}
                          maxLength={15}
                          placeholder="NEW PIN"
                          id="new-pin-input-field"
                        />
                        <button
                          onClick={handleUpdateToken}
                          className="pill-btn"
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', boxShadow: 'none' }}
                          id="save-new-pin-btn"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setIsEditingToken(false)}
                          className="pill-btn secondary-pill"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          id="cancel-new-pin-btn"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <span>Access PIN: <strong style={{ color: 'var(--danger)', fontFamily: 'monospace' }}>{token}</strong></span>
                        <button
                          onClick={() => { setNewTokenInput(token); setIsEditingToken(true); }}
                          className="pill-btn secondary-pill"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', borderRadius: '6px' }}
                          id="change-pin-toggle-btn"
                        >
                          Change PIN
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Real-time Shared Clipboard */}
          <div className={`glass-panel ${activeTab !== 'clipboard' ? 'desktop-only' : ''}`}>
            <h2 style={{ fontFamily: 'var(--font-header)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clipboard size={18} style={{ color: 'var(--primary)' }} /> Live Clipboard
            </h2>
            <div className="clipboard-hub">
              <textarea
                value={clipboard}
                onChange={(e) => setClipboard(e.target.value)}
                placeholder="Type or paste text, links, or notes to sync instantly across all devices..."
                className="clipboard-textarea"
                id="clipboard-sync-textarea"
              />
              <div className="clipboard-actions">
                <span className="clipboard-status">Auto-syncing...</span>
                <div className="clipboard-btns">
                  <button onClick={copyToSystemClipboard} className="pill-btn" id="copy-clipboard-btn">
                    <Copy size={13} /> Copy All
                  </button>
                  <button onClick={() => setClipboard('')} className="pill-btn secondary-pill" id="clear-clipboard-btn">
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Connected Network Devices */}
          <div className={`glass-panel ${activeTab !== 'devices' ? 'desktop-only' : ''}`}>
            <h2 style={{ fontFamily: 'var(--font-header)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Laptop size={18} style={{ color: 'var(--success)' }} /> Connected Devices
            </h2>
            <div className="devices-list">
              {devices.length === 0 ? (
                <div className="online-indicator">
                  <div className="pulse-dot"></div> Looking for devices...
                </div>
              ) : (
                devices.map((dev) => {
                  const isCurrentDevice = dev.name === getDeviceMetadata().name;
                  const renderDeviceIcon = (type) => {
                    switch (type) {
                      case 'desktop': return <Laptop size={16} />;
                      case 'mobile': return <Smartphone size={16} />;
                      case 'tablet': return <Tablet size={16} />;
                      default: return <Tv size={16} />;
                    }
                  };
                  return (
                    <div key={dev.id} className="device-card">
                      <div className="device-info">
                        <div className="device-icon-box">
                          {renderDeviceIcon(dev.type)}
                        </div>
                        <div>
                          <span className="device-name">
                            {dev.name}
                            {isCurrentDevice && <span className="device-self-badge">you</span>}
                          </span>
                        </div>
                      </div>
                      <div className="online-indicator">
                        <div className="pulse-dot"></div> Online
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </section>

      </div>

      {/* Floating Toast Notification Containers */}
      <div className="toast-container">
        {toastList.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' && <Check size={16} style={{ color: 'var(--success)' }} />}
            {t.type === 'warning' && <HelpCircle size={16} style={{ color: 'var(--warning)' }} />}
            {t.type === 'danger' && <Trash2 size={16} style={{ color: 'var(--danger)' }} />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
