# 📡 vikuAir — High-Speed Local File Sharing

**vikuAir** is a premium, web-based local file-sharing portal designed for instant offline transfers between a Windows PC, iPhone, and iPad. It runs completely offline over local IP routing, making it perfect for sharing files of any format or size when connected to an iOS Personal Hotspot.

The project features a high-performance **Python FastAPI & WebSockets** backend and a modern, responsive, glassmorphic **React** frontend.

---

## 🚀 Key Features

*   **⚡ Unlimited Speed & Size:** Share raw videos, photos, and archives instantly. There are no size limits, internet dependencies, or cellular data consumption.
*   **🔒 Secure Access PIN:** Automatically generates a random 6-character Access PIN on startup. You can also customize the PIN dynamically from the host dashboard.
*   **💻 Host Loopback Auto-Auth:** Automatically bypasses security locks for requests originating from the host PC (loopback or self-IP adapters), keeping the host experience friction-free.
*   **📱 Zero-Friction Scan to Login:** Generates a dynamic QR code on the host dashboard. Scanning it with an iPhone/iPad camera automatically logs you in without typing.
*   **🔄 Live Shared Clipboard:** Paste texts, links, or notes in the text hub, and they will immediately mirror onto all connected screens.
*   **⚡ Real-Time Transfer Status:** Shows active uploads and download events across all devices in real-time.
*   **📦 Zero-Configuration Launcher (`start.bat`):** Just copy the folder and double-click `start.bat`. It checks if Python is installed, auto-initializes the virtual environment, installs the required packages, and boots the portal.

---

## 🛠️ Tech Stack

*   **Backend:** Python 3.8+, FastAPI, Uvicorn, WebSockets, Multer-equivalent file streaming (`python-multipart`), `psutil` (network discovery), and `qrcode`.
*   **Frontend:** React (Vite-powered), HTML5, Vanilla CSS3 (Harmony HSL layout), Lucide Icons, and Canvas-confetti.
*   **Startup Script:** Windows Batch Scripting (`.bat`).

---

## 📐 Architecture & Security

```mermaid
graph TD
    subgraph WindowsPC ["Windows PC Server & Client"]
        S["FastAPI Python Server"]
        WSS["WebSocket Server"]
        DB["shared_files/ directory"]
        WebWin["Windows Chrome/Edge UI"]
    end

    subgraph iOS ["iPhone / iPad Client"]
        WebiOS["iOS Safari UI"]
    end

    WebWin <-->|"HTTP API / WebSockets"| S
    WebiOS <-->|"HTTP API (Token Header) / WebSockets (Query Token)"| S
    S <--> DB
    S <--> WSS
```

### Security Measures:
1.  **Strict Token Verification:** All incoming requests (upload, download, websocket upgrade) are validated against the active token. Unauthorized clients on the network are blocked.
2.  **Path Traversal Prevention:** Files are resolved on the Windows filesystem using `os.path.basename(filename)`. This strips directory manipulation symbols (e.g. `../../`), locking files strictly inside `shared_files/`.
3.  **Conflict Prevention:** If a duplicate file is uploaded (e.g. `image.png`), the backend increments the name (e.g. `image (1).png`) to prevent data overrides.
4.  **Token Eviction:** Changing the PIN on the host PC broadcasts an `auth_revoked` payload and immediately closes all network client WebSocket connections, kicking them back to the lock screen.

---

## 🏁 How to Run

### Step 1: Network Setup
1.  Turn on **Personal Hotspot** on your iPhone or iPad.
2.  Connect your Windows PC and your iPad to the iPhone Hotspot Wi-Fi network.

### Step 2: Boot the Server
1.  Double-click **`start.bat`**.
2.  The script will verify your Python environment, create a virtual environment (`.venv`) if it doesn't exist, and install packages.
3.  It will display the **ACCESS PIN** in the console and automatically open your default browser to `http://localhost:3000`.

### Step 3: Link Your Devices
*   **Camera Scan (Recommended):** Scan the QR code displayed on your Windows PC screen with your iPhone/iPad camera and tap the link to log in instantly.
*   **Manual Entry:** Enter the IP address shown in your PC console (e.g., `http://172.20.10.7:3000`) into your iPad's Safari browser. When prompted, enter the **Access PIN** printed on the PC dashboard or console.

---

## 📶 Troubleshooting Hotspot Connection Issues

On some cellular carriers (especially on 5G networks), iOS shares the hotspot over an **IPv6-only / NAT64** translation layer. In this mode, the iPad/iPhone is assigned a translated internal IPv4 address like **`192.0.0.2`**, while the laptop is assigned a standard local address like **`172.20.10.7`**. This IP mismatch prevents local IPv4 routing, making standard IP URLs inaccessible.

If you encounter this, connect using one of the options below:

### Option A: Use the Local Hostname Link (Easiest)
vikuAir supports dual-stack IPv4/IPv6 and local **mDNS (Bonjour)** hostnames. You don't need IP addresses at all:
1. When you run `start.bat`, look at the console log output for the **Local Hostname Link**:
   `http://<your-computer-name>.local:3000/?token=XXXXXX`
2. Open this `.local` link directly in Safari on your iPad/iPhone (or scan the QR Code). iOS will resolve the laptop name natively over local IPv6 routing.

### Option B: Use the Direct IPv6 Address URL
If you prefer to connect using the raw IPv6 address of your laptop instead of the `.local` name:
1. Note the IPv6 addresses shown in the PC console when the server launches.
2. In your iPad/iPhone browser, you **must wrap the IPv6 address in square brackets `[...]`** so the browser can differentiate the IPv6 colons from the port colon:
   `http://[YOUR_IPV6_ADDRESS]:3000/?token=XXXXXX`
   *(Example: `http://[2409:40e3:48:b6f2:453f:dcd:8238:c856]:3000/?token=CDFM1C`)*

### Option C: Use Windows Mobile Hotspot
If the iPhone Hotspot routing remains isolated or fails, you can share the connection in reverse:
1. On your **Windows PC**, open settings and turn on **Mobile Hotspot**.
2. Connect your iPad/iPhone to the **Windows PC's Wi-Fi Hotspot network**.
3. Launch `start.bat`. Under network access options, look for the link labeled with **`Local Area Connection`** or **`192.168.137.x`** (typically `http://192.168.137.1:3000/?token=XXXXXX`).
4. Open that URL on your iPad. Because Windows controls the local DHCP and routing directly, this local connection bypasses all cellular carrier translations and is guaranteed to connect.

---

## 📂 Project Structure

```text
apple_win_wifi/
├── .venv/                 # Local Python virtual environment
├── dist/                  # Compiled React production bundle
├── shared_files/          # Directory where shared files are stored
├── src/                   # React frontend source files
│   ├── App.jsx            # Main dashboard component
│   └── App.css            # Custom CSS styles
├── server.py              # FastAPI Python Web Server
├── requirements.txt       # Python dependencies list
├── start.bat              # Auto-setup and server execution script
├── index.html             # HTML entry point template
├── vite.config.js         # Build system configuration
└── README.md              # Project documentation
```
