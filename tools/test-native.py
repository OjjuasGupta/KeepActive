#!/usr/bin/env python3
"""Protocol regression test for the KeepActive native helper.

Run from the repository root:
    py -3 tools/test-native.py

The test never sends TRIGGER, so it does not move the mouse.
"""

import json
import os
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.path.join(ROOT, "native", "host.py")


def send(process, payload):
    data = json.dumps(payload).encode("utf-8")
    process.stdin.write(struct.pack("=I", len(data)) + data)
    process.stdin.flush()


def receive(process):
    header = process.stdout.read(4)
    if len(header) != 4:
        raise RuntimeError("native host closed stdout")
    length = struct.unpack("=I", header)[0]
    payload = process.stdout.read(length)
    if len(payload) != length:
        raise RuntimeError("native host sent a truncated message")
    return json.loads(payload.decode("utf-8"))


def main():
    process = subprocess.Popen(
        [sys.executable, HOST],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    failures = []

    def check(name, condition, detail=""):
        if condition:
            print(f"PASS  {name}")
        else:
            failures.append(name)
            print(f"FAIL  {name} {detail}")

    try:
        ready = receive(process)
        check("READY on startup", ready.get("type") == "READY", str(ready))
        check("READY reports version", ready.get("version") == "1.1.0", str(ready))

        send(process, {"type": "PING"})
        pong = receive(process)
        check("PING returns PONG", pong.get("type") == "PONG", str(pong))

        send(process, {
            "type": "CONFIG",
            "minSec": 45,
            "maxSec": 120,
            "pressShift": True,
            "minIdleSec": 15,
        })
        config = receive(process)
        check("CONFIG returns CONFIG_OK", config.get("type") == "CONFIG_OK", str(config))
        check("CONFIG keeps max above min", config.get("config", {}).get("maxSec", 0) > config.get("config", {}).get("minSec", 0))

        send(process, {"type": "UNKNOWN"})
        unknown = receive(process)
        check("unknown command returns ERROR", unknown.get("type") == "ERROR", str(unknown))

        send(process, {"type": "STOP"})
        stopped = receive(process)
        check("STOP returns STOPPED", stopped.get("type") == "STOPPED", str(stopped))

        process.wait(timeout=5)
        check("host exits cleanly", process.returncode == 0, str(process.returncode))
    finally:
        if process.poll() is None:
            process.kill()

    stderr = process.stderr.read().decode("utf-8", errors="replace").strip()
    if stderr:
        print("host stderr:", stderr[:600])

    if failures:
        print(f"{len(failures)} native protocol test(s) failed.")
        return 1
    print("All native protocol tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
