#!/usr/bin/env bash
# MarketDesk setup script for Oracle Cloud Free Tier (Ubuntu 22.04, Ampere A1 ARM)
# Run as: bash setup.sh
set -euo pipefail

echo "==> Updating system packages"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Installing build tools (required by better-sqlite3 native build on ARM)"
sudo apt-get install -y build-essential python3 git curl nginx

echo "==> Installing Node.js 20.x"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing PM2 globally"
sudo npm install -g pm2

echo "==> Installing project dependencies"
cd "$(dirname "$0")"
npm install

mkdir -p logs

echo "==> Configuring Nginx reverse proxy"
sudo cp nginx.conf /etc/nginx/sites-available/marketdesk.conf
sudo ln -sf /etc/nginx/sites-available/marketdesk.conf /etc/nginx/sites-enabled/marketdesk.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "==> Opening firewall ports (80/443) via ufw, if active"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 'Nginx Full' || true
fi

echo "==> NOTE: Oracle Cloud also requires opening ports 80/443 in the VCN Security List"
echo "    (Networking > Virtual Cloud Networks > your VCN > Security Lists > Add Ingress Rule)"

echo "==> Starting MarketDesk with PM2"
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | sudo bash || true

echo "==> Done. MarketDesk is running on port 8080, proxied via Nginx on port 80."
echo "    Edit nginx.conf's server_name and rerun 'sudo certbot --nginx -d yourdomain.com' for HTTPS."
