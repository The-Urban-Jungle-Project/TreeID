# Runs the site in headless Chromium against a fake backend.
# Usage: python3 tests/pages.test.py site tests/shots
import json, base64, time, sys, os, threading, http.server, functools
from playwright.sync_api import sync_playwright

ROOT = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith('/tree/'):
            path = '/tree.html'
        return super().translate_path(path)
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

API = 'https://api.example/exec'
schema = [
    {"key": "tree_id", "header": "tree_id", "type": "text", "options": None, "locked": True},
    {"key": "tag_label", "header": "tag_label", "type": "text", "options": None, "locked": True},
    {"key": "status", "header": "status", "type": "list", "options": ["Unassigned", "Active", "Dead", "Replaced"], "locked": False},
    {"key": "project", "header": "project", "type": "list", "options": ["NOS"], "locked": False},
    {"key": "latitude", "header": "latitude", "type": "number", "options": None, "locked": False},
    {"key": "longitude", "header": "longitude", "type": "number", "options": None, "locked": False},
    {"key": "species", "header": "species", "type": "text", "options": None, "locked": False},
    {"key": "install_date", "header": "install date", "type": "date", "options": None, "locked": False},
    {"key": "notes", "header": "notes", "type": "textarea", "options": None, "locked": False},
]
db = {"registered": False, "tree": {"tree_id": "00018", "tag_label": "0001-8", "status": "Unassigned", "project": "", "latitude": "", "longitude": "", "species": "", "install_date": "", "notes": ""}, "visits": []}
calls = []

def handle(route):
    req = json.loads(route.request.post_data)
    calls.append(req)
    staff = bool(req.get("token"))
    a = req["action"]
    if a == "get":
        if staff:
            body = {"ok": True, "staff": True, "user": "ferdinand@theurbanjungleproject.com", "id": "00018", "label": "0001-8",
                    "registered": db["registered"], "tree": db["tree"], "schema": schema, "visits": db["visits"]}
        else:
            pub = {k: db["tree"][k] for k in ("tag_label", "species", "project", "install_date") if db["registered"] and db["tree"][k]}
            body = {"ok": True, "staff": False, "id": "00018", "label": "0001-8", "registered": db["registered"], "tree": pub}
    elif a == "whoami":
        body = {"ok": True, "staff": staff, "user": "ferdinand@theurbanjungleproject.com" if staff else None}
    elif a == "claim":
        body = {"ok": True, "id": "00034", "label": "0003-4"} if staff else {"ok": False, "error": "not_signed_in"}
    elif a == "register":
        db["registered"] = True; db["tree"].update(req["fields"]); db["tree"]["status"] = "Active"; body = {"ok": True}
    elif a == "visit":
        db["visits"].insert(0, {"visited_at": "2026-11-04 10:15", "visited_by": "ferdinand@theurbanjungleproject.com", "notes": req["notes"],
                                "photos": [{"shot": s, "name": s, "thumb": "/tree-assets/tujp-logo.svg", "url": "#"} for s in req["photos"]]})
        body = {"ok": True}
    elif a == "report":
        body = {"ok": True}
    else:
        body = {"ok": False, "error": "unknown"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

def jwt(exp):
    p = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return "h." + p + ".s"

png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
results = []
def ok(name, cond):
    results.append(cond); print(("PASS " if cond else "FAIL ") + name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, geolocation={"latitude": 52.37, "longitude": 4.89}, permissions=["geolocation"])
    ctx.add_init_script(f"window.TREE_CONFIG = {{API_URL: '{API}', CLIENT_ID: 'x.apps.googleusercontent.com'}};")
    ctx.route(API, handle)
    ctx.route("https://accounts.google.com/**", lambda r: r.abort())
    ctx.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    pg.goto("http://127.0.0.1:8765/tree/00019"); pg.wait_for_timeout(300)
    ok("invalid id message", "valid tree ID" in pg.inner_text("#app"))

    pg.goto("http://127.0.0.1:8765/tree/00018"); pg.wait_for_selector("text=Not linked yet")
    ok("public unassigned", True)
    pg.screenshot(path=f"{OUT}/1_public_unassigned.png", full_page=True)

    pg.evaluate(f"sessionStorage.setItem('tujp_token', '{jwt(int(time.time()) + 3600)}')")
    pg.reload(); pg.wait_for_selector("text=Register this tree")
    ok("staff sees register form", True)
    ok("register form hides locked + status", pg.query_selector("[name=tree_id]") is None and pg.query_selector("[name=status]") is None)
    pg.click("#gpsBtn"); pg.wait_for_function("document.getElementById('f_latitude').value !== ''")
    ok("use my location fills lat", pg.input_value("#f_latitude") == "52.370000")
    pg.select_option("#f_project", "NOS"); pg.fill("#f_species", "Acer campestre"); pg.fill("#f_install_date", "2026-11-02")
    pg.screenshot(path=f"{OUT}/2_staff_register.png", full_page=True)
    pg.click("#register button[type=submit]"); pg.wait_for_selector("text=Tree registered"); pg.wait_for_selector("#visitBtn")
    reg = [c for c in calls if c["action"] == "register"][-1]
    ok("register payload", reg["fields"]["species"] == "Acer campestre" and reg["fields"]["install_date"] == "2026-11-02" and reg["token"])

    for s in ("close", "medium", "wide"):
        pg.set_input_files(f"#p_{s}", files=[{"name": f"{s}.png", "mimeType": "image/png", "buffer": png}])
    pg.fill("#v_notes", "First visit")
    pg.click("#visitBtn"); pg.wait_for_selector("text=Visit saved"); pg.wait_for_selector("text=Recent visits")
    vis = [c for c in calls if c["action"] == "visit"][-1]
    ok("visit payload has 3 jpeg photos + gps", sorted(vis["photos"].keys()) == ["close", "medium", "wide"] and base64.b64decode(vis["photos"]["close"])[:2] == b"\xff\xd8" and vis["gps"].startswith("52.37"))
    ok("visit listed", "First visit" in pg.inner_text("#app"))
    pg.screenshot(path=f"{OUT}/3_staff_registered.png", full_page=True)

    pg.click("#editBtn"); pg.wait_for_selector("#edit")
    ok("edit form shows status select", pg.query_selector("#f_status") is not None and pg.input_value("#f_species") == "Acer campestre")
    pg.click("#cancelEdit")

    pg.evaluate("sessionStorage.removeItem('tujp_token')"); pg.reload(); pg.wait_for_selector("text=Something wrong")
    ok("public registered shows public fields only", "Acer campestre" in pg.inner_text("#app") and "52.37" not in pg.inner_text("#app"))
    pg.screenshot(path=f"{OUT}/4_public_registered.png", full_page=True)
    pg.fill("#r_msg", "A branch is broken"); pg.click("text=Send report"); pg.wait_for_selector("text=Thank you")
    rep = [c for c in calls if c["action"] == "report"][-1]
    ok("report payload", rep["message"] == "A branch is broken" and rep["website"] == "" and "token" in rep)
    # Home page, staff, iPhone-like browser (no Web NFC): copy-link flow
    pg.evaluate(f"sessionStorage.setItem('tujp_token', '{jwt(int(time.time()) + 3600)}')")
    pg.goto("http://127.0.0.1:8765/"); pg.wait_for_selector("#claimBtn")
    pg.click("#claimBtn"); pg.wait_for_selector("text=Reserved for you")
    ok("iPhone flow shows link + NFC Tools steps", "https://trees.theurbanjungleproject.com/tree/00034" in pg.inner_text("#app") and pg.query_selector("#copyBtn") is not None and pg.query_selector("#writeBtn") is None)
    pg.screenshot(path=f"{OUT}/5_program_iphone.png", full_page=True)
    pg.fill("#openId", "0001-9"); pg.click("#openForm button"); pg.wait_for_selector("text=not a valid tree ID")
    ok("open by ID rejects bad check digit", True)
    pg.evaluate("sessionStorage.removeItem('tujp_token')"); pg.goto("http://127.0.0.1:8765/"); pg.wait_for_selector("text=About TUJP")
    ok("public home", pg.query_selector("#claimBtn") is None)
    ok("no page errors", not errors)
    if errors: print(errors)

    # Android-like browser with a fake Web NFC tag
    ctx2 = b.new_context(viewport={"width": 390, "height": 844})
    ctx2.add_init_script(f"window.TREE_CONFIG = {{API_URL: '{API}', CLIENT_ID: 'x.apps.googleusercontent.com'}};")
    ctx2.add_init_script("""
      window.__tag = { url: null, locked: false };
      window.NDEFReader = class {
        async scan() { setTimeout(() => this.onreadingerror && this.onreadingerror({}), 50); }
        async write(m) { window.__tag.url = m.records[0].data; }
        async makeReadOnly() { window.__tag.locked = true; }
      };""")
    ctx2.route(API, handle)
    ctx2.route("https://accounts.google.com/**", lambda r: r.abort())
    ctx2.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    pg2 = ctx2.new_page()
    pg2.goto("http://127.0.0.1:8765/")
    pg2.evaluate(f"sessionStorage.setItem('tujp_token', '{jwt(int(time.time()) + 3600)}')")
    pg2.reload(); pg2.wait_for_selector("#claimBtn"); pg2.click("#claimBtn"); pg2.wait_for_selector("#writeBtn")
    pg2.click("#writeBtn"); pg2.wait_for_selector("text=Tag written. Tap it")
    tag = pg2.evaluate("window.__tag")
    ok("Android flow writes link, not locked by default", tag["url"] == "https://trees.theurbanjungleproject.com/tree/00034" and not tag["locked"])
    pg2.screenshot(path=f"{OUT}/6_program_android.png", full_page=True)
    if errors: print(errors)
    b.close()
srv.shutdown()
print("ALL PASSED" if all(results) else "SOME FAILED")
