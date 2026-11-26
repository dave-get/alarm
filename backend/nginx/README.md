# Nginx HTTPS/WSS proxy

Nginx expects `certs/fullchain.pem` and `certs/privkey.pem`.

**Production (Let's Encrypt):** point your domain at the server, then:

```bash
mkdir -p nginx/acme nginx/certs
docker run --rm -v "$PWD/nginx/acme:/var/www/acme" -v "$PWD/nginx/letsencrypt:/etc/letsencrypt" \
  certbot/certbot certonly --webroot -w /var/www/acme -d api.example.com --agree-tos -m you@example.com
cp nginx/letsencrypt/live/api.example.com/fullchain.pem nginx/letsencrypt/live/api.example.com/privkey.pem nginx/certs/
docker compose --profile https up -d
```

For the first certificate, Nginx must already answer on port 80. Either start with a self-signed
pair (below), or run certbot in `--standalone` mode before Nginx starts. Renew with a cron job
(`certbot renew`, then `docker compose exec nginx nginx -s reload`).

**Local testing (self-signed):**

```bash
mkdir -p nginx/certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 -subj "/CN=localhost" \
  -keyout nginx/certs/privkey.pem -out nginx/certs/fullchain.pem
```

Mobile devices reject self-signed certificates; use a real domain for device testing.
