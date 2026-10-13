#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

rm -rf dist
mkdir -p dist
cp src/index.html src/styles.css src/app.js src/favicon.svg dist/

api_base_url=${API_BASE_URL:-http://localhost:8000}
escaped_url=$(printf '%s' "$api_base_url" | sed 's/[\\&"]/\\&/g')
printf 'window.APP_CONFIG = { API_BASE_URL: "%s" };\n' "$escaped_url" > dist/config.js
