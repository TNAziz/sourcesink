#!/bin/sh
# Install the locally built, unpacked SourceSink for the current user (same
# result as the release installer in scripts/install.sh, which this calls).
# Run `sh install-local.sh --uninstall` to remove.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
if [ "${1:-}" = "--uninstall" ]; then exec sh "$here/../../scripts/install.sh" --uninstall; fi
exec sh "$here/../../scripts/install.sh" --from "$here/release/linux-unpacked"
