#!/usr/bin/env bash
#
# Read-only inspection of a machine before installing the Syndix cycle.
#
# This script writes nothing, installs nothing, and starts nothing. Run it on a
# server that already has other services on it and read the output before
# deciding whether to continue.
#
#   bash scripts/preflight.sh
#
# It answers three questions: is there a Node here new enough to run the cycle,
# would installing collide with anything already present, and what should the
# systemd unit actually say on this machine.

set -uo pipefail

PASS=0
WARN=0
FAIL=0

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; PASS=$((PASS+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head_ "Node"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  bad "node is not on PATH. The cycle needs Node 20+."
  bad "Install it WITHOUT touching a version another service depends on -"
  bad "see the isolation note in docs/VPS.md."
else
  NODE_VER="$($NODE_BIN --version)"
  NODE_MAJOR="$(printf '%s' "$NODE_VER" | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "$NODE_BIN is $NODE_VER"
  else
    bad "$NODE_BIN is $NODE_VER - the cycle needs 20+ for --env-file"
    warn "Do NOT upgrade in place if another service pins this version."
  fi

  # systemd starts units with a minimal PATH. A node under a version manager
  # will not be found, and the unit fails with status=203/EXEC.
  case "$NODE_BIN" in
    /usr/bin/node|/usr/local/bin/node)
      ok "node is in a path systemd can see by default" ;;
    *)
      warn "node lives at $NODE_BIN, which systemd will NOT find by default."
      warn "Edit ExecStart in deploy/syndix-cycle.service to use this path." ;;
  esac
fi

head_ "Would the install collide with anything?"

if id syndix >/dev/null 2>&1; then
  warn "A user named 'syndix' already exists - useradd will fail."
  warn "Either reuse it or pick another name in the unit file."
else
  ok "No existing 'syndix' user"
fi

if [ -e /opt/syndix ]; then
  warn "/opt/syndix already exists and would be reused, not overwritten."
else
  ok "/opt/syndix is free"
fi

for unit in syndix-cycle.service syndix-cycle.timer; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${unit}"; then
    warn "$unit is already installed - copying over it replaces the old one."
  else
    ok "$unit is not installed"
  fi
done

# The cycle listens on nothing, so it cannot take a port from another service.
ok "The cycle binds no ports (it makes outbound calls only)"

head_ "Resources"

if command -v free >/dev/null 2>&1; then
  AVAIL_MB="$(free -m | awk '/^Mem:/ {print $7}')"
  if [ -n "${AVAIL_MB:-}" ] && [ "$AVAIL_MB" -lt 400 ]; then
    warn "Only ${AVAIL_MB}MB RAM available. The unit caps itself at 1G, but a"
    warn "tight box may still feel a short spike four times a day."
  else
    ok "${AVAIL_MB:-?}MB RAM available (the cycle is capped at 1G)"
  fi
fi

DISK_AVAIL="$(df -Pm /opt 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "${DISK_AVAIL:-}" ] && [ "$DISK_AVAIL" -lt 800 ]; then
  warn "${DISK_AVAIL}MB free on /opt. node_modules for this repo is ~500MB."
else
  ok "${DISK_AVAIL:-?}MB free on /opt (node_modules needs ~500MB)"
fi

head_ "Reachability"

for host in sepolia-rpc-flashblocks.giwa.io api.openai.com api.pinata.cloud; do
  if curl -sS -o /dev/null -m 12 "https://$host" 2>/dev/null; then
    ok "https://$host reachable"
  else
    warn "https://$host did not answer - the cycle needs it"
  fi
done

head_ "Secrets"

if [ -f .env.local ]; then
  PERMS="$(stat -c '%a' .env.local 2>/dev/null || stat -f '%A' .env.local 2>/dev/null)"
  [ "$PERMS" = "600" ] && ok ".env.local is $PERMS" || warn ".env.local is $PERMS, should be 600"

  # The owner key must never reach this machine - that is the entire point of
  # the guard contract.
  if grep -qE '^PRIVATE_KEY=.' .env.local 2>/dev/null; then
    bad "PRIVATE_KEY (the treasury owner) is in .env.local."
    bad "It must NOT be on this server. Remove it - the cycle needs only"
    bad "PUBLISHER_PRIVATE_KEY, which cannot withdraw or change caps."
  else
    ok "No treasury owner key present"
  fi

  for key in PUBLISHER_PRIVATE_KEY NEXT_PUBLIC_SYNDIX_PUBLISHER \
             NEXT_PUBLIC_SYNDIX_TREASURY OPENAI_API_KEY PINATA_JWT; do
    grep -qE "^${key}=." .env.local 2>/dev/null && ok "$key set" || bad "$key missing"
  done
else
  warn ".env.local not found - copy .env.example and fill it in"
fi

head_ "Result"
printf '  %d passed, %d warnings, %d failures\n\n' "$PASS" "$WARN" "$FAIL"

if [ -n "${NODE_BIN:-}" ]; then
  printf 'ExecStart line for this machine:\n\n'
  printf '  ExecStart=%s --env-file=/opt/syndix/.env.local \\\n' "$NODE_BIN"
  printf '    /opt/syndix/node_modules/.bin/tsx /opt/syndix/scripts/publish-cycle.ts\n\n'
fi

if [ "$FAIL" -gt 0 ]; then
  printf 'Fix the failures before installing.\n'
  exit 1
fi
printf 'Next: npm run cycle -- --dry-run   (measures and decides, writes nothing)\n'
