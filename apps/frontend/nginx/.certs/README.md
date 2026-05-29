# Localhost dev TLS

`Dockerfile.nginx` generates a fresh self-signed cert at image-build
time using `localhost.conf` (this directory). No cert material is
ever committed — `.key` / `.crt` / `.pem` are gitignored at the repo
root.

If you need the cert files on disk for non-Docker dev (e.g. running
nginx directly on your host), regenerate them locally:

```bash
cd apps/frontend/nginx/.certs/
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout localhost.key -out localhost.crt -batch -config localhost.conf
```

The resulting files stay on your machine — never `git add` them.
