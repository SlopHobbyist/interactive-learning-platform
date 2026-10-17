# HTTPS

HTTPS is **off by default**: `docker compose up` serves plain HTTP on port 8000, which is right
for localhost. Turn it on before anyone else can reach the app. Three setups are covered: direct
(your own certificate), behind Cloudflare in **Full (strict)** mode, and behind a reverse proxy
you already run (Traefik, Caddy, nginx) that ends TLS for you.

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

## Behind a reverse proxy

If a reverse proxy on the same host already holds ports 80 and 443 and gets the certificates
(Traefik, Caddy, nginx…), let it end TLS and leave `ILP_TLS` empty. The app then speaks plain
HTTP to the proxy only.

1. In `.env`:

   ```sh
   ILP_PUBLIC_URL=https://learn.example.com
   ILP_SECURE_COOKIES=true
   # Whose X-Forwarded-Proto / X-Forwarded-For to believe. The proxy reaches the app over a
   # Docker network, from an address that can change; "*" is safe once the app has no host
   # port (step 2), because then only containers on its networks can reach it.
   ILP_FORWARDED_ALLOW_IPS=*
   ```

   `ILP_FORWARDED_ALLOW_IPS` (uvicorn's `FORWARDED_ALLOW_IPS`) makes the app see the visitor's
   `https`, which it passes on to Kratos. Without it the app believes only `127.0.0.1`.

2. Attach the app to the proxy in a `docker-compose.override.yaml` next to
   `docker-compose.yaml`. It is gitignored, and `docker compose` reads it on its own. For
   Traefik with a Docker provider and an external network called `frontend`:

   ```yaml
   services:
     app:
       ports: !reset []        # reachable only through the proxy
       networks: [default, frontend]
       labels:
         - traefik.enable=true
         - traefik.docker.network=frontend
         - traefik.http.routers.ilp.rule=Host(`learn.example.com`)
         - traefik.http.routers.ilp.entrypoints=websecure
         - traefik.http.routers.ilp.tls.certresolver=<your resolver>
         - traefik.http.services.ilp.loadbalancer.server.port=8000
   networks:
     frontend:
       external: true
   ```

   Keep `default` in the list: Kratos reaches the app as `app` over it.
   `traefik.docker.network` tells Traefik which of the two networks to use. Other proxies
   forward to `http://app:8000` the same way. Proxies that set `X-Forwarded-Proto` (all three
   do) need nothing else.

3. `docker compose up -d --build`.

If the proxy sits behind Cloudflare, use Full (strict) as above: the proxy's certificate is the
one Cloudflare checks.

## Other certificates

Let's Encrypt works the same way: copy (or bind-mount) its `fullchain.pem` and `privkey.pem` into
`certs/` and restart the app after each renewal. Resolve symlinks when copying
(`cp -L`); the container can't follow links that point outside the mount.
