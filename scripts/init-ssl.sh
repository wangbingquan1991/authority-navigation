#!/usr/bin/env bash
set -e

DOMAIN="${DOMAIN:-nav.example.com}"
EMAIL="${EMAIL:-admin@example.com}"

echo "==> Initializing SSL for domain: $DOMAIN"

mkdir -p certbot/www certbot/conf

# Substitute domain into nginx config
sed "s/\${DOMAIN}/$DOMAIN/g" nginx/authority-navigation.conf.template > nginx/authority-navigation.conf

# Start nginx without SSL first for ACME challenge
docker-compose -f docker-compose.nginx.yml up -d nginx

# Obtain certificate
docker run -it --rm \
  -v "$(pwd)/certbot/www:/var/www/certbot" \
  -v "$(pwd)/certbot/conf:/etc/letsencrypt" \
  certbot/certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --agree-tos \
  --no-eff-email \
  -m "$EMAIL"

# Restart nginx with SSL config
docker-compose -f docker-compose.nginx.yml restart nginx

echo "==> SSL initialized successfully for $DOMAIN"
