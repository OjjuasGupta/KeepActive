#!/usr/bin/env python3
"""
KeepActive native messaging host (optional full build).

The extension owns scheduling. This process only executes one small,
user-safe action per TRIGGER message and answers on stdin/stdout using the
Chrome native messaging framing (4-byte little-endian length + UTF-8 JSON).

Supported backends
  Windows : ctypes / Win32 (no third-party packages)
  macOS   : ApplicationServices CoreGraphics (Accessibility permission needed)
  Linux   : xdotool / X11 (Wayland support depends on the compositor)

The helper never clicks, never types text, and refuses to act while the user
is actively providing input (where the OS exposes an idle timer).
"""

import json
import os
import platform
import random
import shutil
import struct
import subprocess
import sys
import time

MAX_MESSAGE_BYTES = 1024 * 1024
VERSION = "1.1.0"
SYSTEM = platform.system()

DEFAULT_CONFIG = {
    "minSec": 45,
    "maxSec": 120,
    "pressShift": True,
    "minIdleSec": 15,
}


# ---------------------------------------------------------------------------
# Native messaging framing
# ---------------------------------------------------------------------------

def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) == 0:
        return None
    if len(header) != 4:
        raise ValueError("truncated native message header")
    length = struct.unpack("=I", header)[0]
    if length <= 0 or length > MAX_MESSAGE_BYTES:
        raise ValueError("invalid native message length")
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        return None
    return json.loads(payload.decode("utf-8"))


def send_message(message):
    payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


# ---------------------------------------------------------------------------
# Windows backend (ctypes, no pip dependencies)
# ---------------------------------------------------------------------------

class WindowsInput:
    name = "windows"

    def __init__(self):
        import ctypes
        from ctypes import wintypes

        self.ctypes = ctypes
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

        class POINT(ctypes.Structure):
            _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]

        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

        self.POINT = POINT
        self.LASTINPUTINFO = LASTINPUTINFO

        self.user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
        self.user32.GetCursorPos.restype = wintypes.BOOL
        self.user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
        self.user32.SetCursorPos.restype = wintypes.BOOL
        self.user32.GetLastInputInfo.argtypes = [ctypes.POINTER(LASTINPUTINFO)]
        self.user32.GetLastInputInfo.restype = wintypes.BOOL
        self.user32.keybd_event.argtypes = [
            wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, ctypes.c_size_t
        ]
        self.kernel32.GetTickCount64.argtypes = []
        self.kernel32.GetTickCount64.restype = ctypes.c_ulonglong

    def available(self):
        return True

    def cursor(self):
        point = self.POINT()
        if not self.user32.GetCursorPos(self.ctypes.byref(point)):
            raise OSError("GetCursorPos failed")
        return int(point.x), int(point.y)

    def move(self, x, y):
        if not self.user32.SetCursorPos(int(x), int(y)):
            raise OSError("SetCursorPos failed")

    def idle_seconds(self):
        info = self.LASTINPUTINFO()
        info.cbSize = self.ctypes.sizeof(self.LASTINPUTINFO)
        if not self.user32.GetLastInputInfo(self.ctypes.byref(info)):
            return None
        tick = int(self.kernel32.GetTickCount64())
        elapsed = tick - int(info.dwTime)
        if elapsed < 0:
            elapsed += 2 ** 32
        return elapsed / 1000.0

    def shift_pulse(self):
        vk_shift = 0x10
        keyeventf_keyup = 0x0002
        self.user32.keybd_event(vk_shift, 0, 0, 0)
        time.sleep(0.03)
        self.user32.keybd_event(vk_shift, 0, keyeventf_keyup, 0)


# ---------------------------------------------------------------------------
# macOS backend (CoreGraphics, Accessibility permission needed)
# ---------------------------------------------------------------------------

class MacInput:
    name = "macos"

    def __init__(self):
        import ctypes

        self.ctypes = ctypes

        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        self.CGPoint = CGPoint
        self.cg = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
        )
        self.cf = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )

        self.cg.CGEventCreate.restype = ctypes.c_void_p
        self.cg.CGEventCreate.argtypes = [ctypes.c_void_p]
        self.cg.CGEventGetLocation.restype = CGPoint
        self.cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
        self.cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
        self.cg.CGEventCreateMouseEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32
        ]
        self.cg.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        self.cg.CGEventCreateKeyboardEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint16, ctypes.c_bool
        ]
        self.cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        self.cg.CGEventSourceSecondsSinceLastEventType.restype = ctypes.c_double
        self.cg.CGEventSourceSecondsSinceLastEventType.argtypes = [
            ctypes.c_uint32, ctypes.c_uint32
        ]
        self.cf.CFRelease.argtypes = [ctypes.c_void_p]

    def available(self):
        return True

    def cursor(self):
        event = self.cg.CGEventCreate(None)
        if not event:
            raise OSError("CGEventCreate failed")
        try:
            point = self.cg.CGEventGetLocation(event)
            return int(point.x), int(point.y)
        finally:
            self.cf.CFRelease(event)

    def move(self, x, y):
        event = self.cg.CGEventCreateMouseEvent(
            None, 5, self.CGPoint(float(x), float(y)), 0  # kCGEventMouseMoved
        )
        if not event:
            raise OSError("CGEventCreateMouseEvent failed")
        try:
            self.cg.CGEventPost(0, event)  # kCGHIDEventTap
        finally:
            self.cf.CFRelease(event)

    def idle_seconds(self):
        return float(self.cg.CGEventSourceSecondsSinceLastEventType(0, 0xFFFFFFFF))

    def shift_pulse(self):
        for down in (True, False):
            event = self.cg.CGEventCreateKeyboardEvent(None, 56, down)  # left Shift
            if not event:
                raise OSError("CGEventCreateKeyboardEvent failed")
            try:
                self.cg.CGEventPost(0, event)
            finally:
                self.cf.CFRelease(event)
            time.sleep(0.03)


# ---------------------------------------------------------------------------
# Linux backend (xdotool / X11)
# ---------------------------------------------------------------------------

class LinuxInput:
    name = "linux"

    def __init__(self):
        self.xdotool = shutil.which("xdotool")
        self.xprintidle = shutil.which("xprintidle")

    def available(self):
        return bool(self.xdotool and os.environ.get("DISPLAY"))

    def cursor(self):
        if not self.available():
            raise OSError("xdotool or DISPLAY is unavailable")
        output = subprocess.check_output(
            [self.xdotool, "getmouselocation", "--shell"],
            stderr=subprocess.DEVNULL,
            text=True
        )
        values = {}
        for line in output.splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
        return int(values["X"]), int(values["Y"])

    def move(self, x, y):
        if not self.available():
            raise OSError("xdotool or DISPLAY is unavailable")
        subprocess.check_call(
            [self.xdotool, "mousemove", "--sync", str(int(x)), str(int(y))],
            stderr=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL
        )

    def idle_seconds(self):
        if not self.xprintidle:
            return None
        try:
            return int(subprocess.check_output([self.xprintidle], text=True).strip()) / 1000.0
        except Exception:
            return None

    def shift_pulse(self):
        subprocess.check_call(
            [self.xdotool, "key", "--clearmodifiers", "shift"],
            stderr=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL
        )


class UnsupportedInput:
    name = SYSTEM.lower() or "unsupported"

    def __init__(self, reason):
        self.reason = reason

    def available(self):
        return False

    def cursor(self):
        raise OSError(self.reason)

    def move(self, _x, _y):
        raise OSError(self.reason)

    def idle_seconds(self):
        return None

    def shift_pulse(self):
        raise OSError(self.reason)


def create_backend():
    try:
        if SYSTEM == "Windows":
            return WindowsInput()
        if SYSTEM == "Darwin":
            return MacInput()
        if SYSTEM == "Linux":
            return LinuxInput()
    except Exception as error:
        return UnsupportedInput(f"input backend failed: {error}")
    return UnsupportedInput(f"unsupported platform: {SYSTEM}")


# ---------------------------------------------------------------------------
# Action execution
# ---------------------------------------------------------------------------

class Host:
    def __init__(self):
        self.backend = create_backend()
        self.config = dict(DEFAULT_CONFIG)
        self.last_trigger = 0.0
        self.cooldown_sec = 10.0

    def status(self):
        return {
            "type": "READY",
            "version": VERSION,
            "platform": self.backend.name,
            "available": bool(self.backend.available()),
        }

    def configure(self, message):
        for key in ("minSec", "maxSec", "pressShift", "minIdleSec"):
            if key in message:
                self.config[key] = message[key]
        try:
            self.config["minSec"] = max(5, int(self.config["minSec"]))
            self.config["maxSec"] = max(self.config["minSec"] + 1, int(self.config["maxSec"]))
            self.config["minIdleSec"] = max(5, int(self.config["minIdleSec"]))
            self.config["pressShift"] = bool(self.config["pressShift"])
        except Exception:
            self.config = dict(DEFAULT_CONFIG)
        return {"type": "CONFIG_OK", "config": self.config}

    def trigger(self):
        now = time.monotonic()
        if now - self.last_trigger < self.cooldown_sec:
            return {"type": "RESULT", "ok": False, "reason": "helper cooldown active"}

        if not self.backend.available():
            return {
                "type": "RESULT",
                "ok": False,
                "reason": f"input backend unavailable on {SYSTEM}"
            }

        idle = None
        try:
            idle = self.backend.idle_seconds()
        except Exception:
            idle = None

        min_idle = max(5, int(self.config.get("minIdleSec", 15)))
        if idle is not None and idle < min_idle:
            return {
                "type": "RESULT",
                "ok": False,
                "reason": f"user is active ({idle:.1f}s idle)"
            }

        try:
            before_x, before_y = self.backend.cursor()
        except Exception as error:
            return {"type": "RESULT", "ok": False, "reason": f"cursor read failed: {error}"}

        choices = [(2, 1), (-2, -1), (2, -1), (-2, 1), (3, 0), (0, 2), (-1, 2)]
        dx, dy = random.choice(choices)
        target_x, target_y = before_x + dx, before_y + dy
        moved = False
        restored = False

        try:
            self.backend.move(target_x, target_y)
            moved = True
            time.sleep(random.uniform(0.03, 0.07))

            current_x, current_y = self.backend.cursor()
            if abs(current_x - target_x) <= 2 and abs(current_y - target_y) <= 2:
                self.backend.move(before_x, before_y)
                restored = True
            # If the pointer is no longer at the nudged position, the user
            # moved it themselves. Never fight the user by restoring.

            if self.config.get("pressShift", True) and random.random() < 0.30:
                self.backend.shift_pulse()
        except Exception as error:
            return {"type": "RESULT", "ok": False, "reason": f"input action failed: {error}"}
        finally:
            self.last_trigger = now

        return {
            "type": "RESULT",
            "ok": moved,
            "restored": restored,
            "idleSec": round(idle, 1) if idle is not None else None,
        }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def selftest():
    backend = create_backend()
    available = False
    cursor = None
    try:
        available = bool(backend.available())
        if available:
            cursor = backend.cursor()
    except Exception as error:
        print(f"[selftest] backend={backend.name} available={available} error={error}", file=sys.stderr)
        return 1
    print(
        f"[selftest] backend={backend.name} available={available} cursor={cursor}",
        file=sys.stderr
    )
    return 0 if available else 1


def main():
    if "--selftest" in sys.argv:
        return selftest()

    host = Host()
    send_message(host.status())

    try:
        while True:
            message = read_message()
            if message is None:
                break

            if not isinstance(message, dict):
                send_message({"type": "ERROR", "message": "message must be an object"})
                continue

            message_type = message.get("type")

            if message_type == "PING":
                send_message({
                    "type": "PONG",
                    "version": VERSION,
                    "platform": host.backend.name,
                    "available": bool(host.backend.available()),
                })
            elif message_type == "CONFIG":
                send_message(host.configure(message))
            elif message_type == "TRIGGER":
                send_message(host.trigger())
            elif message_type in ("STOP", "SHUTDOWN"):
                send_message({"type": "STOPPED"})
                break
            else:
                send_message({"type": "ERROR", "message": f"unknown message type: {message_type}"})
    except (BrokenPipeError, EOFError):
        pass
    except ValueError as error:
        try:
            send_message({"type": "ERROR", "message": str(error)})
        except Exception:
            pass
    except Exception as error:
        try:
            send_message({"type": "ERROR", "message": f"fatal host error: {error}"})
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
