#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper only runs on macOS." >&2
  exit 1
fi

if [[ -z "${SSH_USER_PWD:-}" ]]; then
  echo "SSH_USER_PWD is required to unlock the login keychain." >&2
  exit 1
fi

security unlock-keychain -p "$SSH_USER_PWD" "$HOME/Library/Keychains/login.keychain-db"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$SSH_USER_PWD" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning
