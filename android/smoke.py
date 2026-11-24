"""Exercise provider setup and an Amharic chat response on an Android emulator."""
import json
import subprocess
import time
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import xml.etree.ElementTree as ET

def adb(*args):
    return subprocess.check_output(["adb", *args], text=True).strip()

class Model(BaseHTTPRequestHandler):
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.path == "/v1/chat/completions"
        assert payload["model"] == "fixture"
        assert payload["messages"][-1]["content"] == "Hello"
        body = json.dumps({"choices":[{"message":{"content":"ሰላም ከአቢሲኒያ"}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.end_headers()
        self.wfile.write(body)

def visible(label):
    for _ in range(10):
        adb("shell","uiautomator","dump","/sdcard/abyssinia-ui.xml")
        xml = adb("shell","cat","/sdcard/abyssinia-ui.xml")
        for node in ET.fromstring(xml).iter("node"):
            if label == node.get("content-desc") or label.lower() in node.get("text","").lower():
                return node
        time.sleep(1)
    print([(n.get("text"),n.get("content-desc")) for n in ET.fromstring(xml).iter("node")],flush=True)
    raise RuntimeError("Could not find " + label)

def tap(label):
    left,top,right,bottom = map(int,re.findall(r"\d+",visible(label).get("bounds")))
    adb("shell","input","tap",str((left+right)//2),str((top+bottom)//2))

server = ThreadingHTTPServer(("127.0.0.1",0), Model)
Thread(target=server.serve_forever,daemon=True).start()
adb("reverse","tcp:18789","tcp:"+str(server.server_port))
adb("shell","am","start","-n","ai.abyssinia.mobile/.AssistantActivity")
tap("Settings")
assert visible("Google Gemini") is not None
tap("Google Gemini")
tap("Custom")
tap("HTTPS API base URL")
adb("shell","input","keyevent","123",*(["67"]*64))
adb("shell","input","text","http://127.0.0.1:18789/v1")
actual=visible("HTTPS API base URL").get("text")
assert actual=="http://127.0.0.1:18789/v1",repr(actual)
tap("Model ID")
adb("shell","input","text","fixture")
adb("shell","input","keyevent","4")
assert visible("Model ID").get("text") == "fixture"
tap("Save")
tap("መልዕክት ይጻፉ")
adb("shell","input","text","Hello")
adb("shell","input","keyevent","4")
assert visible("መልዕክት ይጻፉ").get("text") == "Hello"
tap("Send")
visible("ሰላም ከአቢሲኒያ")
print("Installed APK completed a provider round trip with an Amharic reply.")
server.shutdown()
