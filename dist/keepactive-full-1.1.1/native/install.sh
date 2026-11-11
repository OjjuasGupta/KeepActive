#!/usr/bin/env bash
#
# KeepActive native messaging helper installer for macOS and Linux.
#
# Usage:
#   ./install.sh --chrome --extension-id <32-char-id>
#   ./install.sh --both --extension-id <id>
#   ./install.sh --uninstall
#
# The full build declares the nativeMessaging permission. The Chrome Web Store
# build does not include this helper.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_PATH="$SCRIPT_DIR"
BROWSERS=("chrome")
EXTENSION_ID=""
INSTALL_DIR=""
DRY_RUN=0
UNINSTALL=0

print_usage() {
    cat <<'EOF'
Usage: ./install.sh [OPTIONS]

Options:
  --chrome                 Register for Google Chrome (default)
  --edge                   Register for Microsoft Edge
  --both                   Register for both Chrome and Edge
  --extension-id ID        Extension ID (32 lowercase letters a-p)
  --source-path PATH       Folder containing host.py (default: script folder)
  --install-dir PATH       Stable helper install folder
  --dry-run                Print actions without changing files
  --uninstall              Remove manifests and the helper install folder
  --help                   Show this help

Examples:
  ./install.sh --extension-id abcdefghijklmnopabcdefghijklmn
  ./install.sh --both --extension-id abcdefghijklmnopabcdefghijklmn --dry-run
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --chrome) BROWSERS=("chrome"); shift ;;
        --edge) BROWSERS=("edge"); shift ;;
        --both) BROWSERS=("chrome" "edge"); shift ;;
        --extension-id) EXTENSION_ID="${2:-}"; shift 2 ;;
        --source-path) SOURCE_PATH="${2:-}"; shift 2 ;;
        --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        --help|-h) print_usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; print_usage; exit 1 ;;
    esac
done

log() {
    local level="$1"; shift
    local color=""
    case "$level" in
        INFO) color="\033[36m" ;;
        SUCCESS) color="\033[32m" ;;
        WARN) color="\033[33m" ;;
        ERROR) color="\033[31m" ;;
    esac
    echo -e "${color}[$level]\033[0m $*"
}

OS_NAME="$(uname -s)"
case "$OS_NAME" in
    Darwin)
        DEFAULT_INSTALL_DIR="$HOME/Library/Application Support/KeepActive/native"
        ;;
    Linux)
        DEFAULT_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/keepactive/native"
        ;;
    *)
        echo "Unsupported operating system: $OS_NAME" >&2
        exit 1
        ;;
esac

if [[ -z "$INSTALL_DIR" ]]; then
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
fi

find_python() {
    local candidate
    for candidate in python3 python; do
        if command -v "$candidate" >/dev/null 2>&1; then
            if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
                command -v "$candidate"
                return 0
            fi
        fi
    done
    return 1
}

get_extension_id() {
    local provided="$1"
    if [[ -n "$provided" ]]; then
        if [[ "$provided" =~ ^[a-p]{32}$ ]]; then
            echo "$provided"
            return 0
        fi
        log ERROR "Extension ID '$provided' is invalid (32 characters, a-p)."
        exit 1
    fi

    local id_file
    id_file="$(dirname "$SOURCE_PATH")/tools/extension-id.txt"
    if [[ -f "$id_file" ]]; then
        local found
        found="$(grep -Eo '[a-p]{32}' "$id_file" | head -1 || true)"
        if [[ -n "$found" ]]; then
            log INFO "Using extension ID from $id_file"
            echo "$found"
            return 0
        fi
    fi

    if [[ -t 0 ]]; then
        log WARN "Find the ID at chrome://extensions (Developer mode)."
        read -rp "Extension ID (32 lowercase letters a-p): " provided
        if [[ "$provided" =~ ^[a-p]{32}$ ]]; then
            echo "$provided"
            return 0
        fi
    fi
    log ERROR "No valid extension ID supplied. Use --extension-id."
    exit 1
}

manifest_dir_for() {
    local browser="$1"
    if [[ "$OS_NAME" == "Darwin" ]]; then
        case "$browser" in
            chrome) echo "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
            edge)   echo "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" ;;
        esac
    else
        case "$browser" in
            chrome) echo "$HOME/.config/google-chrome/NativeMessagingHosts" ;;
            edge)   echo "$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
        esac
    fi
}

manifest_paths=()
for browser in "${BROWSERS[@]}"; do
    manifest_paths+=("$(manifest_dir_for "$browser")/keepactive_helper.json")
done

if [[ "$UNINSTALL" -eq 1 ]]; then
    log INFO "=== KeepActive Native Helper Uninstall ($OS_NAME) ==="
    for manifest_path in "${manifest_paths[@]}"; do
        if [[ -f "$manifest_path" ]]; then
            if [[ "$DRY_RUN" -eq 1 ]]; then
                log INFO "Would remove: $manifest_path"
            else
                rm -f "$manifest_path"
                log SUCCESS "Removed: $manifest_path"
            fi
        fi
    done
    if [[ -d "$INSTALL_DIR" ]]; then
        if [[ "$DRY_RUN" -eq 1 ]]; then
            log INFO "Would remove directory: $INSTALL_DIR"
        else
            rm -rf "$INSTALL_DIR"
            log SUCCESS "Removed directory: $INSTALL_DIR"
        fi
    fi
    log SUCCESS "Uninstall complete."
    exit 0
fi

log INFO "=== KeepActive Native Helper Installer ($OS_NAME) ==="

if [[ ! -f "$SOURCE_PATH/host.py" ]]; then
    log ERROR "host.py not found in $SOURCE_PATH"
    exit 1
fi

PYTHON="$(find_python || true)"
if [[ -z "$PYTHON" ]]; then
    log ERROR "Python 3.8+ was not found. Install Python and try again."
    exit 1
fi
log INFO "Python: $PYTHON"

EXTENSION_ID="$(get_extension_id "$EXTENSION_ID")"
log INFO "Extension ID: $EXTENSION_ID"

HOST_TARGET="$INSTALL_DIR/host.py"
LAUNCHER_TARGET="$INSTALL_DIR/keepactive_helper.sh"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log INFO "Would copy $SOURCE_PATH/host.py -> $HOST_TARGET"
    log INFO "Would create launcher: $LAUNCHER_TARGET"
    for manifest_path in "${manifest_paths[@]}"; do
        log INFO "Would write manifest: $manifest_path"
    done
    log SUCCESS "Dry run complete. No changes made."
    exit 0
fi

mkdir -p "$INSTALL_DIR"
cp "$SOURCE_PATH/host.py" "$HOST_TARGET"
chmod 755 "$HOST_TARGET"

cat > "$LAUNCHER_TARGET" <<EOF
#!/bin/sh
exec "$PYTHON" "$HOST_TARGET" "\$@"
EOF
chmod 755 "$LAUNCHER_TARGET"

log INFO "Running helper self-test..."
set +e
SELFTEST_OUTPUT="$("$PYTHON" "$HOST_TARGET" --selftest 2>&1)"
SELFTEST_STATUS=$?
set -e
printf '%s\n' "$SELFTEST_OUTPUT" | while IFS= read -r line; do
    [[ -n "$line" ]] && log INFO "$line"
done
if [[ "$SELFTEST_STATUS" -ne 0 ]]; then
    log WARN "Self-test failed. The helper is installed but may need display/accessibility permissions."
fi

for manifest_path in "${manifest_paths[@]}"; do
    mkdir -p "$(dirname "$manifest_path")"
    "$PYTHON" - "$manifest_path" "$LAUNCHER_TARGET" "$EXTENSION_ID" <<'PY'
import json
import sys

manifest_path, launcher, extension_id = sys.argv[1:4]
manifest = {
    "name": "keepactive_helper",
    "description": "KeepActive native helper (optional local OS input for the full build)",
    "path": launcher,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{extension_id}/"],
}
with open(manifest_path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY
    log SUCCESS "Manifest written: $manifest_path"
done

log ''
log SUCCESS "=== Installation Complete ==="
log INFO "Next steps:"
log INFO "  1. Reload KeepActive in the browser (full build only)."
log INFO "  2. Enable Native Desktop Helper in the popup or Control Deck."
log INFO "  3. Keep the extension ID stable: $EXTENSION_ID"
log ''
log INFO "Uninstall with: $0 --uninstall"
