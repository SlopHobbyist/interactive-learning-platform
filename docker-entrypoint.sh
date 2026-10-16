#!/bin/sh
# Runs as root only long enough to make the data directory writable, then drops to the app user.
# ./data is a bind mount; on a Linux host it keeps whatever owner it had (often root, from older
# runs of this image). On Windows/macOS the chown is a no-op or refused, and writes work anyway.
set -e

if [ "$(id -u)" = "0" ]; then
    chown -R app:app "${ILP_DATA_DIR:-/app/data}" 2>/dev/null || true
    exec setpriv --reuid=app --regid=app --init-groups -- "$@"
fi

exec "$@"
