import os
import io
import json
import base64
import random
import string
import socket
import psutil
import qrcode
from typing import List, Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Form, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware


PORT = 3000
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shared_files")
TOKEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".viku_token")

# Load or generate access token to persist across server restarts
def load_or_create_token():
    if os.path.exists(TOKEN_FILE):
        try:
            with open(TOKEN_FILE, "r") as f:
                token = f.read().strip().upper()
                if len(token) >= 3:
                    return token
        except Exception as e:
            print(f"Error reading persisted token: {e}")
    
    # Generate a fresh random 6-character access token for new server creations
    new_token = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    try:
        with open(TOKEN_FILE, "w") as f:
            f.write(new_token)
    except Exception as e:
        print(f"Error saving generated token: {e}")
    return new_token

def save_token(token_str: str):
    try:
        with open(TOKEN_FILE, "w") as f:
            f.write(token_str.strip().upper())
    except Exception as e:
        print(f"Error saving token: {e}")

ACCESS_TOKEN = load_or_create_token()

# Store clipboard content in-memory
clipboard_text = ""

# Ensure shared directory exists
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

# Helper to scan network interfaces and list local IPs
def get_local_ips():
    ips = []
    # Add local mDNS hostname first for easiest cross-device connection
    try:
        hostname = socket.gethostname().lower()
        ips.append({
            "interface": "Hostname",
            "address": f"{hostname}.local"
        })
    except Exception:
        pass

    try:
        for interface_name, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                    ips.append({
                        "interface": interface_name,
                        "address": addr.address
                    })
                elif addr.family == socket.AF_INET6:
                    # Ignore loopback, link-local (fe80::), and multicast/special addresses
                    ip_str = addr.address.split('%')[0]  # Strip zone index if present
                    if not ip_str.startswith("::1") and not ip_str.lower().startswith("fe80"):
                        ips.append({
                            "interface": interface_name,
                            "address": f"[{ip_str}]"
                        })
    except Exception as e:
        print(f"Error reading network interfaces: {e}")
    return ips

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app_instance: FastAPI):
    print(f"\n======================================================")
    print(f"🚀 vikuAir Local Share Server (Python) running on port {PORT}")
    print(f"🔒 ACCESS PIN: {ACCESS_TOKEN}")
    print(f"------------------------------------------------------")
    print(f"Local Access (No PIN required):")
    print(f"  🔗 http://localhost:{PORT}")
    
    ips = get_local_ips()
    if ips:
        print(f"\nNetwork Access (Scan QR or type in mobile browser):")
        for ip in ips:
            print(f"  🔗 http://{ip['address']}:{PORT}/?token={ACCESS_TOKEN}  ({ip['interface']})")
    else:
        print(f"\n⚠️ No active local network connection detected.")
    print(f"======================================================\n")
    yield

app = FastAPI(lifespan=lifespan)

# Allow CORS for network clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Determine if the client requesting is the host PC itself (loopback or self-IP)
def is_server_self(remote_ip: str) -> bool:
    if remote_ip in ["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]:
        return True
    
    local_ips = [ip["address"].strip("[]") for ip in get_local_ips()]
    clean_ip = remote_ip
    if remote_ip.startswith("::ffff:"):
        clean_ip = remote_ip[7:]
    
    return clean_ip in local_ips

# Security helper to authenticate API requests
async def authenticate(request: Request):
    client_ip = request.client.host
    if is_server_self(client_ip):
        return

    token = request.headers.get("x-access-token") or request.query_params.get("token")
    if token == ACCESS_TOKEN:
        return

    raise HTTPException(status_code=401, detail="Unauthorized. Invalid or missing access token.")

# Helper to resolve filename collisions
def get_unique_filename(dir_path: str, filename: str) -> str:
    base, ext = os.path.splitext(filename)
    candidate = filename
    counter = 1
    while os.path.exists(os.path.join(dir_path, candidate)):
        candidate = f"{base} ({counter}){ext}"
        counter += 1
    return candidate

# WebSocket client registry
connected_devices = {}  # WebSocket -> metadata dict

# Broadcast message to all active WebSocket clients
async def broadcast(message: dict, exclude_ws: WebSocket = None):
    payload = json.dumps(message)
    disconnected = []
    for ws in list(connected_devices.keys()):
        if ws != exclude_ws:
            try:
                await ws.send_text(payload)
            except Exception:
                disconnected.append(ws)
                
    for ws in disconnected:
        if ws in connected_devices:
            del connected_devices[ws]

async def send_device_list():
    devices = list(connected_devices.values())
    await broadcast({"type": "devices_updated", "devices": devices})

# WebSocket handler at /ws path
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global clipboard_text
    token = websocket.query_params.get("token")
    await websocket.accept()
    
    remote_address = websocket.client.host
    is_self = is_server_self(remote_address)

    # Verify connection token if not local host
    if not is_self and token != ACCESS_TOKEN:
        try:
            await websocket.send_text(json.dumps({"type": "auth_failed", "error": "Invalid security token"}))
            await websocket.close()
        except Exception:
            pass
        return

    client_id = f"device_{random.randint(100000, 999999)}"
    connected_devices[websocket] = {
        "id": client_id,
        "name": "Unknown Device",
        "type": "other",
        "connectedAt": "",
        "isSelf": is_self
    }

    # Send initial clipboard state
    await websocket.send_text(json.dumps({"type": "clipboard_update", "text": clipboard_text}))

    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            client_meta = connected_devices[websocket]
            msg_type = data.get("type")

            if msg_type == "register":
                client_meta["name"] = data.get("name", "Anonymous Client")
                client_meta["type"] = data.get("deviceType", "other")
                await send_device_list()

            elif msg_type == "clipboard_update":
                clipboard_text = data.get("text", "")
                await broadcast({
                    "type": "clipboard_update",
                    "text": clipboard_text,
                    "senderId": client_meta["id"]
                }, exclude_ws=websocket)

            elif msg_type == "upload_start":
                await broadcast({
                    "type": "upload_start",
                    "deviceId": client_meta["id"],
                    "deviceName": client_meta["name"],
                    "filename": data.get("filename"),
                    "size": data.get("size")
                }, exclude_ws=websocket)

            elif msg_type == "upload_progress":
                await broadcast({
                    "type": "upload_progress",
                    "deviceId": client_meta["id"],
                    "filename": data.get("filename"),
                    "progress": data.get("progress")
                }, exclude_ws=websocket)

            elif msg_type == "upload_end":
                await broadcast({
                    "type": "upload_end",
                    "deviceId": client_meta["id"],
                    "filename": data.get("filename")
                }, exclude_ws=websocket)

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS error: {e}")
    finally:
        if websocket in connected_devices:
            del connected_devices[websocket]
        await send_device_list()

# API Endpoints

# Get local IPs
@app.get("/api/ips")
async def get_ips(request: Request):
    await authenticate(request)
    client_ip = request.client.host
    return {
        "ips": get_local_ips(),
        "token": ACCESS_TOKEN if is_server_self(client_ip) else None
    }

# Update Access PIN (Restricted strictly to the host PC)
@app.post("/api/token/update")
async def update_token(request: Request):
    client_ip = request.client.host
    if not is_server_self(client_ip):
        raise HTTPException(status_code=403, detail="Forbidden. Only the host PC can change the access PIN.")

    data = await request.json()
    new_token = data.get("token", "").strip().upper()
    if not new_token or len(new_token) < 3:
        raise HTTPException(status_code=400, detail="PIN must be at least 3 characters long.")

    global ACCESS_TOKEN
    ACCESS_TOKEN = new_token
    save_token(ACCESS_TOKEN)
    print(f"\n🔒 ACCESS PIN updated to: {ACCESS_TOKEN}\n")

    # Disconnect and revoke access for all network clients
    evict_ws = []
    for ws, meta in connected_devices.items():
        if not meta["isSelf"]:
            evict_ws.append(ws)

    for ws in evict_ws:
        if ws.client_state.value == 1: # check if open
            try:
                await ws.send_text(json.dumps({"type": "auth_revoked"}))
                await ws.close()
            except Exception:
                pass
        if ws in connected_devices:
            del connected_devices[ws]

    return {"message": "Access PIN updated successfully", "token": ACCESS_TOKEN}

# Generate QR Code data URL
@app.get("/api/qr")
async def get_qr(url: str, request: Request):
    await authenticate(request)
    try:
        qr = qrcode.QRCode(box_size=10, border=4)
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        qr_data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        return {"qr": qr_data_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate QR Code: {e}")

# Get shared files list
@app.get("/api/files")
async def get_files(request: Request):
    await authenticate(request)
    file_list = []
    for filename in os.listdir(UPLOAD_DIR):
        file_path = os.path.join(UPLOAD_DIR, filename)
        if os.path.isfile(file_path):
            try:
                stats = os.stat(file_path)
                file_list.append({
                    "name": filename,
                    "size": stats.st_size,
                    "mtime": int(stats.st_mtime * 1000),
                    "ext": os.path.splitext(filename)[1].lower()
                })
            except Exception:
                pass
    file_list.sort(key=lambda x: x["mtime"], reverse=True)
    return file_list

# Upload files
@app.post("/api/files/upload")
async def upload_files(request: Request, files: List[UploadFile] = File(...)):
    await authenticate(request)
    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="No files uploaded")

    uploaded_names = []
    for file in files:
        # Prevent traversal attacks by isolating the basename
        safe_name = os.path.basename(file.filename)
        unique_name = get_unique_filename(UPLOAD_DIR, safe_name)
        file_path = os.path.join(UPLOAD_DIR, unique_name)
        
        with open(file_path, "wb") as f:
            f.write(await file.read())
            
        uploaded_names.append(unique_name)

    await broadcast({"type": "file_list_updated"})
    return {
        "message": f"{len(files)} file(s) uploaded successfully",
        "files": uploaded_names
    }

# Download file
@app.get("/api/files/download/{filename}")
async def download_file(filename: str, request: Request):
    await authenticate(request)
    safe_name = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        file_path,
        media_type="application/octet-stream",
        filename=safe_name
    )

# Delete file
@app.delete("/api/files/{filename}")
async def delete_file(filename: str, request: Request):
    await authenticate(request)
    safe_name = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        os.remove(file_path)
        await broadcast({"type": "file_list_updated"})
        return {"message": "File deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")

# Clipboard endpoints
@app.get("/api/clipboard")
async def get_clipboard(request: Request):
    await authenticate(request)
    return {"text": clipboard_text}

@app.post("/api/clipboard")
async def post_clipboard(request: Request):
    await authenticate(request)
    data = await request.json()
    global clipboard_text
    clipboard_text = data.get("text", "")
    await broadcast({"type": "clipboard_update", "text": clipboard_text})
    return {"message": "Clipboard updated successfully"}

# Serve frontend React SPA routing fallback
dist_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

@app.exception_handler(404)
async def not_found_handler(request: Request, exc: Exception):
    index_path = os.path.join(dist_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse(content="vikuAir static bundle not found. Run 'npm run build' first.", status_code=404)

if os.path.exists(dist_dir):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="dist")



if __name__ == "__main__":
    import uvicorn
    import socket
    import asyncio
    
    try:
        # Create a dual-stack socket manually (accepts both IPv4 and IPv6 on port PORT)
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        sock.bind(("::", PORT))
        sock.listen()
        
        config = uvicorn.Config(app, host="::", port=PORT, log_level="warning")
        server = uvicorn.Server(config)
        asyncio.run(server.serve(sockets=[sock]))
    except Exception as e:
        print(f"⚠️ Dual-stack socket failed: {e}. Falling back to standard IPv4 bind.")
        uvicorn.run("server:app", host="0.0.0.0", port=PORT, log_level="warning")
