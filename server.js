import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import cors from 'cors';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const uploadDir = path.join(__dirname, 'shared_files');

// Mutable session token
let ACCESS_TOKEN = Math.random().toString(36).substring(2, 8).toUpperCase();

// Ensure shared directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// Helper to resolve filename collisions
function getUniqueFilename(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let counter = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${counter})${ext}`;
    counter++;
  }
  return candidate;
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueName = getUniqueFilename(uploadDir, originalName);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Store clipboard content in-memory
let clipboardText = '';

// Helper to scan network interfaces and list local IPs
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const interfaceName of Object.keys(interfaces)) {
    for (const net of interfaces[interfaceName]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({
          interface: interfaceName,
          address: net.address
        });
      }
    }
  }
  return ips;
}

// Determine if the client requesting is the host PC itself (loopback or self-IP)
function isServerSelf(remoteIp) {
  if (remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1') {
    return true;
  }
  const localIps = getLocalIPs().map(ip => ip.address);
  const cleanRemoteIp = remoteIp.startsWith('::ffff:') ? remoteIp.substring(7) : remoteIp;
  return localIps.includes(cleanRemoteIp);
}

// Security Middleware to authenticate API requests
const authenticate = (req, res, next) => {
  if (isServerSelf(req.ip)) {
    return next();
  }

  const token = req.headers['x-access-token'] || req.query.token;
  if (token === ACCESS_TOKEN) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized. Invalid or missing access token.' });
};

// Broadcast to all WebSocket clients
function broadcast(message, excludeWs = null) {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client !== excludeWs) {
      client.send(payload);
    }
  });
}

// WebSocket client registry
const connectedDevices = new Map();

wss.on('connection', (ws, req) => {
  const remoteAddress = req.socket.remoteAddress;
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const token = parsedUrl.searchParams.get('token');
  const isSelf = isServerSelf(remoteAddress);

  // Verify connection token if not local host
  if (!isSelf && token !== ACCESS_TOKEN) {
    ws.send(JSON.stringify({ type: 'auth_failed', error: 'Invalid security token' }));
    ws.close();
    return;
  }

  const clientId = `device_${Math.random().toString(36).substring(2, 9)}`;
  
  connectedDevices.set(ws, {
    id: clientId,
    name: 'Unknown Device',
    type: 'other',
    connectedAt: new Date(),
    isSelf: isSelf
  });

  // Send initial clipboard state
  ws.send(JSON.stringify({ type: 'clipboard_update', text: clipboardText }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const clientMeta = connectedDevices.get(ws);

      switch (data.type) {
        case 'register':
          clientMeta.name = data.name || 'Anonymous Client';
          clientMeta.type = data.deviceType || 'other';
          connectedDevices.set(ws, clientMeta);
          sendDeviceList();
          break;

        case 'clipboard_update':
          clipboardText = data.text;
          broadcast({ type: 'clipboard_update', text: clipboardText, senderId: clientMeta.id }, ws);
          break;

        case 'upload_start':
          broadcast({
            type: 'upload_start',
            deviceId: clientMeta.id,
            deviceName: clientMeta.name,
            filename: data.filename,
            size: data.size
          }, ws);
          break;

        case 'upload_progress':
          broadcast({
            type: 'upload_progress',
            deviceId: clientMeta.id,
            filename: data.filename,
            progress: data.progress
          }, ws);
          break;

        case 'upload_end':
          broadcast({
            type: 'upload_end',
            deviceId: clientMeta.id,
            filename: data.filename
          }, ws);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          console.warn('Unknown WebSocket message type:', data.type);
      }
    } catch (err) {
      console.error('Error parsing WS message:', err);
    }
  });

  ws.on('close', () => {
    connectedDevices.delete(ws);
    sendDeviceList();
  });
});

function sendDeviceList() {
  const devices = Array.from(connectedDevices.values());
  broadcast({ type: 'devices_updated', devices });
}

// Keep-alive connection check (heartbeat)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === 3) return ws.terminate();
    ws.send(JSON.stringify({ type: 'ping' }));
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// API Routes

// Get local IPs (authorized only, returns token for local setup)
app.get('/api/ips', authenticate, (req, res) => {
  res.json({
    ips: getLocalIPs(),
    token: isServerSelf(req.ip) ? ACCESS_TOKEN : null // Only expose raw token to local host
  });
});

// Update Access PIN (Restricted strictly to the host PC)
app.post('/api/token/update', (req, res) => {
  if (!isServerSelf(req.ip)) {
    return res.status(403).json({ error: 'Forbidden. Only the host PC can change the access PIN.' });
  }

  const newToken = req.body.token ? req.body.token.trim().toUpperCase() : '';
  if (!newToken || newToken.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 characters long.' });
  }

  ACCESS_TOKEN = newToken;
  console.log(`\n🔒 ACCESS PIN updated to: ${ACCESS_TOKEN}\n`);

  // Disconnect and revoke access for all network clients
  for (const [ws, meta] of connectedDevices.entries()) {
    if (!meta.isSelf) {
      ws.send(JSON.stringify({ type: 'auth_revoked' }));
      ws.close();
    }
  }

  res.json({ message: 'Access PIN updated successfully', token: ACCESS_TOKEN });
});

// Generate QR Code data URL (requires authorization if from network)
app.get('/api/qr', authenticate, async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }
  try {
    const qrDataUrl = await QRCode.toDataURL(url);
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR Code' });
  }
});

// Get shared files list
app.get('/api/files', authenticate, (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to list files' });
    }

    const fileList = files.map((file) => {
      const filePath = path.join(uploadDir, file);
      try {
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          mtime: stats.mtime,
          ext: path.extname(file).toLowerCase()
        };
      } catch (statErr) {
        return null;
      }
    }).filter(Boolean);

    fileList.sort((a, b) => b.mtime - a.mtime);
    res.json(fileList);
  });
});

// Upload files
app.post('/api/files/upload', authenticate, upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  broadcast({ type: 'file_list_updated' });
  res.json({
    message: `${req.files.length} file(s) uploaded successfully`,
    files: req.files.map(f => f.filename)
  });
});

// Download file
app.get('/api/files/download/:filename', authenticate, (req, res) => {
  const filename = req.params.filename;
  const safeFilename = path.basename(filename);
  const filePath = path.join(uploadDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, safeFilename, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  });
});

// Delete file
app.delete('/api/files/:filename', authenticate, (req, res) => {
  const filename = req.params.filename;
  const safeFilename = path.basename(filename);
  const filePath = path.join(uploadDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  fs.unlink(filePath, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete file' });
    }
    broadcast({ type: 'file_list_updated' });
    res.json({ message: 'File deleted successfully' });
  });
});

// Clipboard endpoints
app.get('/api/clipboard', authenticate, (req, res) => {
  res.json({ text: clipboardText });
});

app.post('/api/clipboard', authenticate, (req, res) => {
  clipboardText = req.body.text || '';
  broadcast({ type: 'clipboard_update', text: clipboardText });
  res.json({ message: 'Clipboard updated successfully' });
});

// Serve frontend SPA routing fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Listen on all network interfaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 vikuAir Local Share Server running on port ${PORT}`);
  console.log(`🔒 ACCESS PIN: ${ACCESS_TOKEN}`);
  console.log(`------------------------------------------------------`);
  console.log(`Local Access (No PIN required):`);
  console.log(`  🔗 http://localhost:${PORT}`);
  
  const ips = getLocalIPs();
  if (ips.length > 0) {
    console.log(`Network Access (Scan QR or type in mobile browser):`);
    ips.forEach((ip) => {
      console.log(`  🔗 http://${ip.address}:${PORT}/?token=${ACCESS_TOKEN}  (${ip.interface})`);
    });
  } else {
    console.log(`⚠️ No active local network connection detected.`);
  }
  console.log(`======================================================\n`);
});
