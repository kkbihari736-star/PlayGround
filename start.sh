#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"
export PROJECT_DIR
PORT="${PORT:-3000}"
export PORT

WEB_DIR="${OPENCODE_WEB_DIR:-$PROJECT_DIR/.runtime}"
/usr/bin/time -p mkdir -p "$WEB_DIR" "$PROJECT_DIR/dist"
export WEB_DIR

echo "[start] building static output"
/usr/bin/time -p node build.mjs

echo "[start] writing deployment metadata"
/usr/bin/time -p node -e '
const fs = require("node:fs");
const path = require("node:path");
const project = process.env.PROJECT_DIR || process.cwd();
const directory = path.join(project, "dist");
const out = process.env.WEB_DIR || path.join(project, ".runtime");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "deployment-output.json"), JSON.stringify({ project, directory }));
'

echo "[start] serving on port $PORT"
/usr/bin/time -p node server.mjs
