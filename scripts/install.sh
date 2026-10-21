#!/bin/sh
# Install SourceSink for the current user on Linux: no root, no FUSE, no build.
#
#   curl -fsSL https://raw.githubusercontent.com/anonymousacademe/sourcesink/main/scripts/install.sh | sh
#
# Downloads the latest release's x64 .tar.gz from GitHub, unpacks it under
# ~/.local/share/sourcesink, and adds a launcher entry, an icon and the
# .xmile/.stm file associations.
#
#   sh install.sh --from DIR     install an unpacked build (e.g. release/linux-unpacked)
#   sh install.sh --uninstall    remove everything this script installed
set -eu

repo=anonymousacademe/sourcesink
data=${XDG_DATA_HOME:-$HOME/.local/share}
app_dir=$data/sourcesink
desktop_file=$data/applications/sourcesink.desktop
icon=$data/icons/hicolor/512x512/apps/sourcesink.png
mime_file=$data/mime/packages/sourcesink.xml

refresh() {
  update-mime-database "$data/mime" 2>/dev/null || true
  update-desktop-database "$data/applications" 2>/dev/null || true
}

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$app_dir" "$desktop_file" "$icon" "$mime_file"
  refresh
  echo "SourceSink removed."
  exit 0
fi

tmp=
cleanup() { if [ -n "$tmp" ]; then rm -rf "$tmp"; fi; }
trap cleanup EXIT

if [ "${1:-}" = "--from" ]; then
  src=${2:?usage: install.sh --from DIR}
else
  case "$(uname -m)" in
    x86_64 | amd64) ;;
    *) echo "Only x86_64 builds are published so far; build from source instead." >&2; exit 1 ;;
  esac
  command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
  echo "Finding the latest SourceSink release..."
  url=$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" |
    grep -o '"browser_download_url": *"[^"]*-x64\.tar\.gz"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')
  [ -n "$url" ] || { echo "No Linux release found at https://github.com/$repo/releases" >&2; exit 1; }
  tmp=$(mktemp -d)
  echo "Downloading $url"
  curl -fL --progress-bar "$url" -o "$tmp/sourcesink.tar.gz"
  mkdir "$tmp/app"
  tar -xzf "$tmp/sourcesink.tar.gz" -C "$tmp/app"
  # The archive holds one top-level directory.
  src=$(find "$tmp/app" -mindepth 1 -maxdepth 1 -type d | head -n 1)
fi

[ -x "$src/sourcesink" ] || { echo "No SourceSink build in $src" >&2; exit 1; }

rm -rf "$app_dir"
mkdir -p "$app_dir" "$(dirname "$desktop_file")" "$(dirname "$icon")" "$(dirname "$mime_file")"
cp -a "$src/." "$app_dir/"
[ -f "$app_dir/resources/icon.png" ] && cp "$app_dir/resources/icon.png" "$icon"

cat > "$mime_file" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-xmile">
    <comment>System dynamics model (XMILE)</comment>
    <glob pattern="*.xmile"/>
  </mime-type>
  <mime-type type="application/x-sd-legacy-model">
    <comment>Legacy system dynamics model</comment>
    <glob pattern="*.stm" case-sensitive="false"/>
    <glob pattern="*.itm" case-sensitive="false"/>
  </mime-type>
</mime-info>
XML

cat > "$desktop_file" <<DESKTOP
[Desktop Entry]
Type=Application
Name=SourceSink
GenericName=System Dynamics Modeler
Comment=Build and simulate stock-and-flow models
Exec="$app_dir/sourcesink" %f
Icon=sourcesink
Terminal=false
Categories=Education;Science;
MimeType=application/x-xmile;application/x-sd-legacy-model;
StartupWMClass=sourcesink
DESKTOP

refresh
xdg-mime default sourcesink.desktop application/x-xmile 2>/dev/null || true
xdg-mime default sourcesink.desktop application/x-sd-legacy-model 2>/dev/null || true
echo "SourceSink installed. Launch it from your app launcher, or run: $app_dir/sourcesink"
