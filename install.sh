#!/bin/bash
set -e

APP_NAME="Bluebird Writer"
APP_ID="com.bluebird.writer"
ICON="128x128.png"

BIN_DIR="$HOME/.local/bin"
ICON_DIR="$HOME/.local/share/icons/hicolor/128x128/apps"
DESKTOP_DIR="$HOME/.local/share/applications"
INSTALL_PATH="$BIN_DIR/bluebird-writer"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Any version of the AppImage shipped alongside this script.
APPIMAGE="$(cd "$SCRIPT_DIR" && ls bluebird-writer_*_amd64.AppImage 2>/dev/null | head -1)"
if [ -z "$APPIMAGE" ]; then
    echo "Error: no bluebird-writer AppImage found in the same directory as this script."
    exit 1
fi

if [ -f "$INSTALL_PATH" ]; then
    ACTION="Updating"
else
    ACTION="Installing"
fi
echo "$ACTION $APP_NAME..."

# Create directories
mkdir -p "$BIN_DIR" "$ICON_DIR" "$DESKTOP_DIR"

# Copy and make executable
cp "$SCRIPT_DIR/$APPIMAGE" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"

# Install icon
if [ -f "$SCRIPT_DIR/$ICON" ]; then
    cp "$SCRIPT_DIR/$ICON" "$ICON_DIR/$APP_ID.png"
fi

# Create desktop entry
cat > "$DESKTOP_DIR/$APP_ID.desktop" << EOF
[Desktop Entry]
Name=$APP_NAME
Comment=Minimal offline markdown editor for the Bluebird Suite
Exec=$INSTALL_PATH
Icon=$APP_ID
Type=Application
Categories=Office;TextEditor;
MimeType=text/markdown;
StartupNotify=true
EOF

# Refresh app launcher
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database "$DESKTOP_DIR"
fi
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
fi

echo ""
echo "$APP_NAME ${ACTION,,} successfully."
echo "You can launch it from your application menu or by running: bluebird-writer"
