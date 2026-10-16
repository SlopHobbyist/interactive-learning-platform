#!/bin/sh
# Runs as root only long enough to make the data directory writable (and, with ILP_TLS=true, to
# stage the TLS key), then drops to the app user.
# ./data is a bind mount; on a Linux host it keeps whatever owner it had (often root, from older
# runs of this image). On Windows/macOS the chown is a no-op or refused, and writes work anyway.
set -e

# HTTPS is off unless ILP_TLS=true. uvicorn reads UVICORN_SSL_* itself, so all that is needed
# here is to find the files, fail early with a readable message, and hand them over.
case "${ILP_TLS:-}" in
    "" | false) ;;
    true)
        certs="${ILP_CERTS_DIR:-/certs}"
        cert="$certs/${ILP_TLS_CERT:-fullchain.pem}"
        key="$certs/${ILP_TLS_KEY:-privkey.pem}"
        for f in "$cert" "$key"; do
            if [ ! -s "$f" ]; then
                echo "ILP_TLS=true, but $f is missing or empty. See docs/HTTPS.md." >&2
                exit 1
            fi
        done
        if [ "$(id -u)" = "0" ]; then
            # Copy into the container's own filesystem, owned by the app user, so the key's
            # permissions on the host (often 600 for someone else) never matter. It is never
            # written back to the host.
            mkdir -p /run/ilp-tls
            install -m 600 -o app -g app "$cert" /run/ilp-tls/cert.pem
            install -m 600 -o app -g app "$key" /run/ilp-tls/key.pem
            cert=/run/ilp-tls/cert.pem
            key=/run/ilp-tls/key.pem
        fi
        export UVICORN_SSL_CERTFILE="$cert" UVICORN_SSL_KEYFILE="$key"
        ;;
    *)
        echo "ILP_TLS must be 'true' or empty (it is '$ILP_TLS')." >&2
        exit 1
        ;;
esac

if [ "$(id -u)" = "0" ]; then
    chown -R app:app "${ILP_DATA_DIR:-/app/data}" 2>/dev/null || true
    exec setpriv --reuid=app --regid=app --init-groups -- "$@"
fi

exec "$@"
