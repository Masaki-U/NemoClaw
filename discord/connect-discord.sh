#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.local}"
SANDBOX_NAME="${1:-my-assistant}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  echo "Create it from discord/env.example first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -z "${DISCORD_BOT_TOKEN:-}" ]; then
  echo "DISCORD_BOT_TOKEN is required in $ENV_FILE"
  exit 1
fi

cd "$REPO_DIR"

echo "[discord] Applying Discord network policy preset to $SANDBOX_NAME..."
node -e "require('./bin/lib/policies').applyPreset(process.argv[1], 'discord')" "$SANDBOX_NAME"

echo "[discord] Configuring Discord channel inside sandbox $SANDBOX_NAME..."
CFG_FILE="$(mktemp)"
trap 'rm -f "$CFG_FILE"' EXIT
openshell sandbox ssh-config "$SANDBOX_NAME" > "$CFG_FILE"

REMOTE_TOKEN="$(printf "%q" "$DISCORD_BOT_TOKEN")"
ssh -F "$CFG_FILE" -o StrictHostKeyChecking=no "openshell-$SANDBOX_NAME" \
  "DISCORD_BOT_TOKEN=$REMOTE_TOKEN nemoclaw-start openclaw channels add --channel discord --use-env"

echo "[discord] Reloading runtime..."
ssh -F "$CFG_FILE" -o StrictHostKeyChecking=no "openshell-$SANDBOX_NAME" \
  "nemoclaw-start openclaw secrets reload"

echo "[discord] Channel status:"
ssh -F "$CFG_FILE" -o StrictHostKeyChecking=no "openshell-$SANDBOX_NAME" \
  "nemoclaw-start openclaw channels status --deep"
