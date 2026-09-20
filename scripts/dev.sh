#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${FOLIO_PASSWORD:?Export a local password of at least 12 characters}"
export FOLIO_DATA="${FOLIO_DATA:-$PWD/data}"
export FOLIO_WEB="$PWD/frontend/dist"
cargo build --manifest-path backend/Cargo.toml
"${CARGO_TARGET_DIR:-$PWD/backend/target}/debug/folio-kb" &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
npm --prefix frontend run dev
