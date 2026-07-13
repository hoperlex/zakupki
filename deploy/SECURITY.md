# Deploy security & secret-handling rules

These rules are **mandatory** for anyone (human or AI assistant) operating the
zakupki deployment. The overriding goals: **never leak a secret into the
chat/transcript or shell history**, and **never disturb other production sites
on the shared VPS**.

## 1. Secrets never appear in commands or output

- Secrets live **only** in root-only files outside the repo:
  - Local machine: `/root/.config/zakupki/vps.env` (chmod 600) — SSH creds.
  - VPS: `/etc/zakupki/zakupki.env` (chmod 640, owner `zakupki`) — app env.
- **Never** `cat`, `echo`, `printf`, or `env` a file/variable that contains a
  secret (DB password, JWT secrets, SSH passphrase, SMTP/DaData tokens).
- To inspect a secret file, check **keys only**, never values, e.g.
  `grep -oE '^[A-Z_]+=' file` or `cut -d= -f1`.
- When a command needs a secret, pass it via env/`SSH_ASKPASS`/`EnvironmentFile`
  — never as a command-line argument (argv is visible in `ps`).
- Connect with `deploy/vps.sh`, which loads the key passphrase through
  `SSH_ASKPASS` so it never reaches argv or output.

## 2. `.env` / certs / keys are never committed

- `.gitignore` blocks `.env`, `.env.*` (except `.env.example`), `*.crt`, `*.pem`,
  `*.key`, `temp/`, `deploy/vps.env`, `deploy/*.local.*`.
- The Yandex CA cert is a deploy artifact placed on the server, **not** committed.
- Before every commit: `git status` and `git diff --cached` to confirm no secret,
  cert, or key is staged.

## 3. Do no harm to other sites on the VPS

- **Back up first**: nginx config, systemd units, and any file touched are copied
  to a timestamped backup dir before edits (see the deploy plan / `PLAN.md`).
- The portal runs as a **dedicated unprivileged user** (`zakupki`) in its own
  home; it does not touch other apps' files, ports, or containers.
- Add a **new** nginx server block for `zak.su10.ru` only — never edit another
  site's block. Always `nginx -t` before `systemctl reload nginx`.
- Pick a free upstream port (default `127.0.0.1:3000`; verify it's unused first).
- Prefer additive `systemctl enable/start` of the new unit; never stop/restart
  services you did not create.

## 4. Session hygiene

- Keep the number of concurrent SSH sessions low (avoid tripping fail2ban / rate
  limits). Reuse one connection where possible.
- Reboot note: the local ssh-agent socket does not survive a reboot — the first
  `deploy/vps.sh` call after boot re-loads the key automatically (from the stored
  passphrase) or prompts once.
