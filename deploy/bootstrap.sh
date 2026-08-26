#!/usr/bin/env bash
#
# Provision a fresh Ubuntu 24.04 EC2 instance to run this stack.
# Idempotent: safe to re-run.
#
#   curl -fsSL <raw-url>/deploy/bootstrap.sh | sudo bash
# or
#   sudo ./deploy/bootstrap.sh
#
set -euo pipefail

SWAP_SIZE="${SWAP_SIZE:-2G}"
TARGET_USER="${SUDO_USER:-ubuntu}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
	echo "Run with sudo." >&2
	exit 1
fi

# ---------------------------------------------------------------------------
# Swap. A t3.small has 2 GB of RAM. n8n plus Postgres fits, but with little
# headroom, and the failure mode without swap is the OOM killer taking out
# Postgres mid-execution rather than anything graceful.
# ---------------------------------------------------------------------------
log "Swap"
if [[ ! -f /swapfile ]]; then
	fallocate -l "$SWAP_SIZE" /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	echo "created ${SWAP_SIZE} swapfile"
else
	echo "swapfile already present"
fi
# Prefer RAM, but use swap before killing processes.
sysctl -qw vm.swappiness=10
grep -q '^vm.swappiness' /etc/sysctl.d/99-n8n.conf 2>/dev/null || echo 'vm.swappiness=10' >/etc/sysctl.d/99-n8n.conf

# ---------------------------------------------------------------------------
# Base packages
# ---------------------------------------------------------------------------
log "Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw unattended-upgrades

# ---------------------------------------------------------------------------
# Docker, from Docker's own repository rather than the distro's older build
# ---------------------------------------------------------------------------
log "Docker"
if ! command -v docker >/dev/null 2>&1; then
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
		>/etc/apt/sources.list.d/docker.list
	apt-get update -qq
	apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
	echo "docker already installed: $(docker --version)"
fi
systemctl enable --now docker
id -nG "$TARGET_USER" | grep -qw docker || usermod -aG docker "$TARGET_USER"

# Cap container log growth so a chatty workflow cannot fill a 30 GB disk.
if [[ ! -f /etc/docker/daemon.json ]]; then
	mkdir -p /etc/docker
	cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
	systemctl restart docker
fi

# ---------------------------------------------------------------------------
# Firewall. The EC2 security group is the primary control; this is the second
# layer, for the case where the group is later widened by accident.
# SSH is allowed before enabling, so this cannot lock the session out.
# ---------------------------------------------------------------------------
log "Firewall"
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw allow 443/udp  >/dev/null
ufw --force enable >/dev/null
ufw status numbered

# ---------------------------------------------------------------------------
# Unattended security updates
# ---------------------------------------------------------------------------
log "Unattended upgrades"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

log "Done"
cat <<EOF

Next, as ${TARGET_USER} (log out and back in first so the docker group applies):

  git clone <repo-url> ~/n8n-radware-agentic-lab
  cd ~/n8n-radware-agentic-lab
  cp deploy/.env.example deploy/.env
  \$EDITOR deploy/.env          # domain, encryption key, postgres password, owner hash
  cd deploy && docker compose up -d --build

Confirm the DNS A record for your domain points at this instance's Elastic IP
before starting: Caddy requests a certificate on first boot, and repeated
failures against a hostname that does not resolve will hit Let's Encrypt rate
limits.
EOF
