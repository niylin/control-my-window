#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/metadata.json" | head -n 1)"

if [[ -z "$UUID" ]]; then
    echo "Unable to read extension UUID from metadata.json" >&2
    exit 1
fi

INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

command -v glib-compile-schemas >/dev/null 2>&1 || {
    echo "Missing dependency: glib-compile-schemas" >&2
    exit 1
}

mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/schemas"

install -m 0644 "$ROOT_DIR/metadata.json" "$INSTALL_DIR/metadata.json"
install -m 0644 "$ROOT_DIR/extension.js" "$INSTALL_DIR/extension.js"
install -m 0644 "$ROOT_DIR/prefs.js" "$INSTALL_DIR/prefs.js"

mkdir -p "$INSTALL_DIR/schemas"
install -m 0644 "$ROOT_DIR/schemas/org.gnome.shell.extensions.control-my-window.gschema.xml" "$INSTALL_DIR/schemas/"
glib-compile-schemas "$INSTALL_DIR/schemas"

echo "Installed $UUID to:"
echo "  $INSTALL_DIR"

if command -v gnome-extensions >/dev/null 2>&1; then
    if gnome-extensions info "$UUID" >/dev/null 2>&1; then
        gnome-extensions enable "$UUID" || true
        echo "Enabled extension: $UUID"
    else
        echo "Restart GNOME Shell or log out and back in, then enable it with:"
        echo "  gnome-extensions enable $UUID"
    fi
else
    echo "gnome-extensions command not found. Enable the extension from Extensions app after restarting GNOME Shell."
fi
