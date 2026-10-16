# HTTPS

HTTPS is **off by default**: `docker compose up` serves plain HTTP on port 8000, which is right
for localhost. Turn it on before anyone else can reach the app. Two setups are covered: direct
(your own certificate) and behind Cloudflare in **Full (strict)** mode.

## Keys never go in git

Certificates and private keys live in `./certs/`, which is mounted read-only into the app
container at `/certs`. Everything in it except `.gitkeep` is gitignored, as are `*.pem`, `*.key`,
`*.crt`, `*.cer`, `*.csr`, `*.p12`, `*.pfx` and `*.jks` anywhere in the tree
(`server/tests/test_secrets_ignored.py` checks this). The Docker build context is an allowlist
that leaves `certs/` out, so the key is never baked into an image either.

If a private key ever does get committed or pushed, rewriting history is not enough: revoke the
certificate (Cloudflare dashboard, or your CA) and issue a new one.

## Turn it on (Docker)

1. Put the certificate chain in `certs/fullchain.pem` and the private key in `certs/privkey.pem`
   (other names: `ILP_TLS_CERT`, `ILP_TLS_KEY`; another directory: `ILP_CERTS_HOST_DIR`).
2. In `.env`:

   ```sh
   ILP_TLS=true
   ILP_HOST_PORT=443
   ILP_PUBLIC_URL=https://learn.example.com
   ```

3. `docker compose up -d --build`.

`ILP_TLS=true` makes the container serve HTTPS on its port, and the Kratos session cookies
become `Secure` (override with `ILP_SECURE_COOKIES`). The startup stops with a message if a file
is missing or `ILP_TLS` is anything but `true` or empty. The container copies the key into its
own filesystem for the unprivileged app user, so the key's file permissions on the host don't
matter, and the copy is never written back. Certificates are read at startup:
`docker compose restart app` after renewing.

Without Docker, uvicorn does it itself:

```sh
uv run uvicorn server.app.main:app --port 443 \
  --ssl-certfile certs/fullchain.pem --ssl-keyfile certs/privkey.pem
```

## Behind Cloudflare, Full (strict)

Full (strict) encrypts both legs and makes Cloudflare check the origin's certificate. The
certificate doesn't have to come from a public CA; Cloudflare's free **Origin CA** works and
lasts up to 15 years.

1. Cloudflare dashboard, your domain, **SSL/TLS, Origin Server, Create Certificate**. Keep the
   defaults (or ECDSA), list the hostname (`learn.example.com`), create.
2. Save the **Origin Certificate** as `certs/fullchain.pem` and the **Private Key** as
   `certs/privkey.pem`. Cloudflare shows the key once; it can't be shown again.
3. Set `.env` as above. Cloudflare connects to your server on the port the visitor used, so
   `ILP_HOST_PORT=443` (or keep another port and add an Origin Rule that rewrites the destination
   port).
4. **SSL/TLS, Overview**: set the mode to **Full (strict)**. The DNS record for the hostname must
   be proxied (orange cloud).
5. Optional: **Edge Certificates, Always Use HTTPS**, and HSTS once you are sure everything works.

Notes:

- An Origin CA certificate is trusted by Cloudflare only. Browsers going to the server's IP
  directly get a certificate warning; that is expected, and it keeps casual direct hits out.
  Allowing port 443 only from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) in the
  host firewall closes that door completely.
- Because TLS ends at the app, the app sees the real scheme (`https`) and Kratos gets the right
  `X-Forwarded-Proto`. It sees Cloudflare's IP rather than the visitor's; nothing uses the client
  address today.
- **Flexible** mode sends Cloudflare-to-server traffic in clear text. It is not recommended. If
  you must, leave `ILP_TLS` empty and set `ILP_SECURE_COOKIES=true` so cookies are still marked
  secure.
- Cloudflare Turnstile on sign-up and sign-in is separate; see Accounts in `ARCHITECTURE.md`.

## Other certificates

Let's Encrypt works the same way: copy (or bind-mount) its `fullchain.pem` and `privkey.pem` into
`certs/` and restart the app after each renewal. Resolve symlinks when copying
(`cp -L`); the container can't follow links that point outside the mount.
