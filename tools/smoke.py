#!/usr/bin/env python3
"""Headless-Chrome smoke test for the OS3 Concierge PWA.

Loads a URL in headless Chrome, waits for the SPA to render, then asserts the
rendered DOM contains expected markers. Also writes a screenshot. Exits non-zero
on failure so it can gate a deploy.

Usage: python3 tools/smoke.py <url> [--shot path.png]
"""
import subprocess
import sys
import tempfile
import os

CHROME = next((path for path in (
    os.environ.get("CHROME_PATH"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/snap/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
) if path and os.path.exists(path)), None)
MARKERS = ["OS3 Concierge", "List", "Map", "Plan"]  # chrome, tabs
# One of these proves main.js booted + rendered a view:
BOOT_MARKERS = ["No places yet", "wishlist", "Search places", "js-booted", "class=\"card\""]


def run_chrome(url, extra):
    profile = tempfile.mkdtemp(prefix="os3-concierge-chrome-")
    cmd = [
        CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
        "--no-first-run", "--hide-scrollbars",
        f"--user-data-dir={profile}",
        "--virtual-time-budget=6000",  # let async boot + fetch settle
        "--window-size=430,900",
    ] + extra + [url]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=90)


def main():
    if not CHROME:
        print("Chrome/Chromium not found; set CHROME_PATH")
        sys.exit(2)
    if len(sys.argv) < 2:
        print("usage: smoke.py <url> [--shot path]")
        sys.exit(2)
    url = sys.argv[1]
    shot = None
    if "--shot" in sys.argv:
        shot = sys.argv[sys.argv.index("--shot") + 1]

    # 1) DOM after JS runs
    dom = run_chrome(url, ["--dump-dom"]).stdout
    missing = [m for m in MARKERS if m not in dom]
    booted = any(b in dom for b in BOOT_MARKERS)

    ok = not missing and booted
    print(f"URL: {url}")
    print(f"DOM bytes: {len(dom)}")
    print(f"chrome markers present: {not missing} (missing={missing})")
    print(f"app booted (rendered a view): {booted}")

    # 2) screenshot (best effort)
    if shot:
        os.makedirs(os.path.dirname(os.path.abspath(shot)), exist_ok=True)
        run_chrome(url, ["--screenshot=" + os.path.abspath(shot)])
        exists = os.path.exists(shot) and os.path.getsize(shot) > 1000
        print(f"screenshot: {shot} ({'ok' if exists else 'missing'})")

    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
