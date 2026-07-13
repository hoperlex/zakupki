#!/usr/bin/env bash
#
# deploy/vps.sh — secret-safe SSH/SCP wrapper for the zakupki VPS.
#
# ALL secrets (host, user, key path, key passphrase) live ONLY in a root-only
# file outside the repo — default: /root/.config/zakupki/vps.env (chmod 600).
# This script never prints the passphrase and never puts it on a command line,
# so it is safe to run in a shared/recorded session. See deploy/SECURITY.md.
#
# Usage:
#   deploy/vps.sh check                 # connectivity + identity probe
#   deploy/vps.sh ssh '<remote cmd>'    # run a command on the VPS
#   deploy/vps.sh scp-up   LOCAL REMOTE # upload a file
#   deploy/vps.sh scp-down REMOTE LOCAL # download a file
#   deploy/vps.sh rsync <rsync args...> # rsync over the same ssh transport
#
set -euo pipefail

VPS_ENV="${VPS_ENV:-/root/.config/zakupki/vps.env}"
AGENT_SOCK="${VPS_AGENT_SOCK:-/root/.config/zakupki/agent.sock}"

if [[ ! -r "$VPS_ENV" ]]; then
  echo "ERROR: secrets file '$VPS_ENV' not found or unreadable." >&2
  echo "       Create it from deploy/vps.env.example (chmod 600). See deploy/SECURITY.md." >&2
  exit 1
fi
# Load secrets (exported for the SSH_ASKPASS helper). Never echoed.
set -a
# shellcheck disable=SC1090
. "$VPS_ENV"
set +a

: "${VPS_HOST:?VPS_HOST missing in $VPS_ENV}"
: "${VPS_USER:?VPS_USER missing in $VPS_ENV}"
: "${VPS_SSH_KEY:?VPS_SSH_KEY missing in $VPS_ENV}"
VPS_PORT="${VPS_PORT:-22}"

# Common ssh options. IdentitiesOnly avoids offering unrelated agent keys.
# accept-new pins the host key on first use, then verifies it thereafter.
COMMON_OPTS=(
  -i "$VPS_SSH_KEY"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
)

ensure_agent() {
  export SSH_AUTH_SOCK="$AGENT_SOCK"
  # ssh-add -l: 0=has keys, 1=agent up but empty, 2=cannot reach agent.
  local rc
  ssh-add -l >/dev/null 2>&1 && rc=0 || rc=$?
  if [[ $rc -eq 2 ]]; then
    rm -f "$AGENT_SOCK"
    eval "$(ssh-agent -a "$AGENT_SOCK" -s)" >/dev/null
  fi
  # Load the key only if its fingerprint isn't already in the agent.
  local want
  want="$(ssh-keygen -lf "$VPS_SSH_KEY" 2>/dev/null | awk '{print $2}')"
  if [[ -z "$want" ]] || ! ssh-add -l 2>/dev/null | grep -qF "$want"; then
    if [[ -n "${VPS_KEY_PASSPHRASE:-}" ]]; then
      # Feed the passphrase via SSH_ASKPASS so it never touches argv/output.
      local askpass
      askpass="$(mktemp)"
      chmod 700 "$askpass"
      printf '#!/usr/bin/env bash\nprintf "%%s" "$VPS_KEY_PASSPHRASE"\n' >"$askpass"
      SSH_ASKPASS="$askpass" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}" \
        ssh-add "$VPS_SSH_KEY" </dev/null >/dev/null 2>&1 || {
        rm -f "$askpass"
        echo "ERROR: could not add key (wrong passphrase in $VPS_ENV?)." >&2
        exit 1
      }
      rm -f "$askpass"
    else
      # No stored passphrase: prompt interactively (key may be unencrypted).
      ssh-add "$VPS_SSH_KEY"
    fi
  fi
  # An encrypted key needs a sibling .pub so IdentitiesOnly can match the agent
  # key to the -i identity. Recreate it from the agent if it's missing.
  if [[ ! -f "${VPS_SSH_KEY}.pub" && -n "$want" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      local fp
      fp="$(printf '%s\n' "$line" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}')"
      if [[ "$fp" == "$want" ]]; then
        printf '%s\n' "$line" >"${VPS_SSH_KEY}.pub"
        chmod 644 "${VPS_SSH_KEY}.pub"
        break
      fi
    done < <(ssh-add -L 2>/dev/null)
  fi
}

target() { printf '%s@%s' "$VPS_USER" "$VPS_HOST"; }

main() {
  local cmd="${1:-check}"
  shift || true
  ensure_agent
  case "$cmd" in
    check)
      ssh "${COMMON_OPTS[@]}" -p "$VPS_PORT" "$(target)" \
        'echo "OK host=$(hostname) user=$(whoami) os=$(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"'
      ;;
    ssh)
      exec ssh "${COMMON_OPTS[@]}" -p "$VPS_PORT" "$(target)" "$@"
      ;;
    scp-up)
      [[ $# -eq 2 ]] || { echo "usage: vps.sh scp-up LOCAL REMOTE" >&2; exit 2; }
      exec scp "${COMMON_OPTS[@]}" -P "$VPS_PORT" "$1" "$(target):$2"
      ;;
    scp-down)
      [[ $# -eq 2 ]] || { echo "usage: vps.sh scp-down REMOTE LOCAL" >&2; exit 2; }
      exec scp "${COMMON_OPTS[@]}" -P "$VPS_PORT" "$(target):$1" "$2"
      ;;
    rsync)
      exec rsync -az --info=progress2 \
        -e "ssh ${COMMON_OPTS[*]} -p $VPS_PORT" "$@"
      ;;
    *)
      echo "usage: vps.sh {check|ssh <cmd>|scp-up L R|scp-down R L|rsync ...}" >&2
      exit 2
      ;;
  esac
}

main "$@"
