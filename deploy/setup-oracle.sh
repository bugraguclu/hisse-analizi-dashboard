#!/usr/bin/env bash
# One-shot production setup for a fresh Ubuntu 22.04/24.04 VM (Oracle Cloud
# Always Free Ampere A1 tested; any Ubuntu host with public 80/443 works).
#
#   curl -fsSL https://raw.githubusercontent.com/bugraguclu/hisse-analizi-dashboard/master/deploy/setup-oracle.sh -o setup.sh
#   bash setup.sh <domain> [duckdns-token]
#
# e.g. bash setup.sh hisse.duckdns.org 1234abcd-...
#
# Safe to re-run: installs Docker if missing, opens 80/443 in the host
# firewall, clones or updates the repo, creates .env once (random DB password
# and ADMIN_API_KEY; existing values are kept), then builds, starts and seeds
# the production stack (docker-compose.yml + docker-compose.prod.yml) and
# installs a nightly database backup cron job.
# With a DuckDNS token the domain is pointed at this VM's public IP and kept
# there by a 5-minute cron job.
set -euo pipefail

DOMAIN="${1:?usage: setup-oracle.sh <domain> [duckdns-token]}"
DUCKDNS_TOKEN="${2:-}"
REPO_URL="https://github.com/bugraguclu/hisse-analizi-dashboard.git"
APP_DIR="$HOME/hisse-analizi-dashboard"
COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml)

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

log "System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl openssl ca-certificates cron >/dev/null
sudo timedatectl set-timezone Europe/Istanbul

# Oracle's Ubuntu images ship an iptables INPUT chain that rejects everything
# but SSH, loaded at boot from /etc/iptables/rules.v4; the VCN security list
# must allow 80/443 as well (done in the console). The rules go into that file
# directly: `netfilter-persistent save` would also persist Docker's own chains.
log "Opening ports 80/443 in the host firewall"
rules=/etc/iptables/rules.v4
if [ -f "$rules" ] && ! sudo grep -q -- '--dport 443 -j ACCEPT' "$rules"; then
  sudo sed -i '/^-A INPUT -j REJECT/i -A INPUT -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT\n-A INPUT -p tcp -m state --state NEW -m tcp --dport 443 -j ACCEPT\n-A INPUT -p udp -m udp --dport 443 -j ACCEPT' "$rules"
fi
for rule in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
  # shellcheck disable=SC2086
  sudo iptables -C INPUT $rule -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 $rule -j ACCEPT
done

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker >/dev/null

# Small shapes (e.g. the 1 GB AMD micro) cannot build the images without swap.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 4000000 ] && ! swapon --show | grep -q .; then
  log "Adding 4 GB swap"
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if [ -n "$DUCKDNS_TOKEN" ]; then
  log "Pointing $DOMAIN at this VM (DuckDNS)"
  subdomain="${DOMAIN%%.duckdns.org}"
  update_url="https://www.duckdns.org/update?domains=${subdomain}&token=${DUCKDNS_TOKEN}&ip="
  result="$(curl -fsS "$update_url")"
  [ "$result" = "OK" ] || { echo "DuckDNS update failed: $result" >&2; exit 1; }
  cron_line="*/5 * * * * curl -fsS '${update_url}' >/dev/null 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'duckdns.org/update' || true; echo "$cron_line" ) | crontab -
fi

log "Fetching the code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# set_env KEY VALUE — replace an existing (or commented-out) KEY= line, else append.
set_env() {
  if grep -qE "^#? *$1=" .env; then
    sed -i -E "s|^#? *$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}
env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }

if [ ! -f .env ]; then
  log "Creating .env"
  cp .env.example .env
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env ADMIN_API_KEY "$(openssl rand -hex 32)"
fi
db_password="$(env_value POSTGRES_PASSWORD)"
set_env APP_ENV production
set_env DATABASE_URL "postgresql+asyncpg://hisse:${db_password}@db:5432/hisse_analizi"
set_env DATABASE_URL_SYNC "postgresql://hisse:${db_password}@db:5432/hisse_analizi"
set_env CORS_ORIGINS "https://${DOMAIN}"
set_env DOMAIN "$DOMAIN"
chmod 600 .env

log "Building and starting the stack (first build takes a few minutes)"
"${COMPOSE[@]}" up -d --build

log "Waiting for the API"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T app python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)" </dev/null 2>/dev/null; then
    break
  fi
  sleep 5
done

log "Seeding companies and sources"
"${COMPOSE[@]}" exec -T app python scripts/seed.py </dev/null

log "Daily database backup (04:30, kept 14 days in ~/backups)"
mkdir -p "$HOME/backups"
backup_line="30 4 * * * cd ${APP_DIR} && scripts/backup.sh \$HOME/backups 14 >> \$HOME/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'scripts/backup.sh' || true; echo "$backup_line" ) | crontab -

log "Done"
"${COMPOSE[@]}" ps
cat <<EOF

  Site:          https://${DOMAIN}   (certificate is issued on the first request; give it a minute)
  Admin API key: grep ADMIN_API_KEY ${APP_DIR}/.env
  Backups:       ls ~/backups   (restore: scripts/restore.sh)
  Logs:          cd ${APP_DIR} && sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f worker
  Update:        bash setup.sh ${DOMAIN}${DUCKDNS_TOKEN:+ <token>}
EOF
