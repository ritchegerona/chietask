import http.server, socketserver, os, webbrowser, threading, json

PORT = 8765
DIR = os.path.dirname(os.path.abspath(__file__))
STORAGE_DIR = os.path.join(DIR, "storage")
TASKS_FILE = os.path.join(STORAGE_DIR, "tasks.json")
os.chdir(DIR)
os.makedirs(STORAGE_DIR, exist_ok=True)

def load_tasks():
    try:
        with open(TASKS_FILE, "r") as f: return json.load(f)
    except: return []

def save_tasks(data):
    with open(TASKS_FILE, "w") as f: json.dump(data, f, indent=2, ensure_ascii=False)

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/tasks":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.end_headers()
            self.wfile.write(json.dumps(load_tasks()).encode())
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/tasks":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                save_tasks(data)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
            return
        self.send_response(404)
        self.end_headers()

    # CRITICAL: Disable browser caching for HTML/CSS/JS
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args): pass

if not os.path.exists(TASKS_FILE): save_tasks([])

with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    url = f"http://localhost:{PORT}/task_tracker.html"
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    print(f"✓ Server running at {url}")
    print(f"💾 Storage: {TASKS_FILE}")
    httpd.serve_forever()
