#!/bin/sh
# Build the SourceSink user manual (sourcesink-manual.pdf) from LaTeX.
# Uses Tectonic if installed (it fetches the packages it needs), otherwise
# latexmk with XeLaTeX from a TeX Live installation.
set -eu
cd "$(dirname "$0")"
if command -v tectonic >/dev/null 2>&1; then
  tectonic -X compile sourcesink-manual.tex
elif command -v latexmk >/dev/null 2>&1; then
  latexmk -xelatex -interaction=nonstopmode sourcesink-manual.tex
  latexmk -c sourcesink-manual.tex
else
  echo "Install Tectonic (https://tectonic-typesetting.github.io) or TeX Live with latexmk." >&2
  exit 1
fi
echo "Wrote $(pwd)/sourcesink-manual.pdf"
