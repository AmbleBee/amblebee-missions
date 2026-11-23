"""Serve the built site the way GitHub Pages does, including its 404.html for any address that isn't a file
(that's how a Field notes post like /fieldnotes/our-gear/ opens).

    python3 tools/serve.py [port] [folder]      # defaults: 8811 and _site
"""
import functools
import http.server
import sys
from pathlib import Path


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        page = Path(self.directory) / "404.html"
        if code != 404 or not page.exists():
            return super().send_error(code, message, explain)
        body = page.read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


def handler(folder):
    return functools.partial(PagesHandler, directory=str(folder))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8811
    folder = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "_site")
    print(f"Open http://localhost:{port}  (Ctrl+C to stop)")
    http.server.ThreadingHTTPServer(("", port), handler(folder)).serve_forever()
