# Deploying to EC2

Target: `radware.ztat.me` on a `t3.small`, TLS via Caddy, DNS in Route 53.

## 1. Instance

- Ubuntu 24.04 LTS, `t3.small`, 30 GB gp3.
- **Allocate an Elastic IP and attach it.** Without one, a stop/start changes
  the public address and the A record silently points at nothing.
- Security group inbound:

| Port | Source | Why |
| --- | --- | --- |
| 22 | your address only | SSH |
| 80 | 0.0.0.0/0 | ACME HTTP-01 challenge and the redirect to 443 |
| 443 tcp+udp | 0.0.0.0/0 | HTTPS, and HTTP/3 over QUIC |

Nothing else. Postgres and n8n are never published.

## 2. DNS, before anything else

`ztat.me` is a Route 53 hosted zone. Create an A record for `radware.ztat.me`
pointing at the Elastic IP, and confirm it resolves:

```bash
dig +short radware.ztat.me
```

Do this first. Caddy requests a certificate on first start, and repeated
failures against a name that does not resolve will hit Let's Encrypt rate
limits, which are measured in hours.

## 3. Provision

```bash
ssh ubuntu@radware.ztat.me
sudo ./deploy/bootstrap.sh
```

Idempotent, and safe to re-run. It creates 2 GB of swap, installs Docker from
Docker's own repository, caps container logs, enables `ufw` with SSH already
allowed, and turns on unattended security upgrades.

`t3.small` is 2 GB of RAM. n8n, Postgres and Caddy fit within the memory limits
set in the compose file, but without swap the failure mode is the OOM killer
taking out Postgres mid-execution.

Log out and back in so the `docker` group applies.

## 4. Configure

```bash
git clone git@github.com:ZacharyToney/radware.ztat.me.git ~/radware.ztat.me
cd ~/radware.ztat.me
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env`:

```bash
openssl rand -hex 32     # N8N_ENCRYPTION_KEY
openssl rand -hex 24     # POSTGRES_PASSWORD
```

For the owner password hash, run `pnpm hash-password` on a machine that has
Node, and paste the line it prints verbatim. It emits the `$` characters
doubled, which is correct: Docker Compose collapses `$$` back to `$` when it
reads the file. An unescaped bcrypt hash is silently truncated by variable
interpolation, and the public owner account ends up with a password nobody
knows.

**Back up `N8N_ENCRYPTION_KEY` somewhere off the instance.** Lose it and every
stored credential becomes unreadable, including the Radware keys.

## 5. Start

```bash
cd deploy
docker compose up -d --build
```

The build compiles the guard node and runs its tests, so a failing test cannot
produce a running instance. First start also fetches a certificate; watch it:

```bash
docker compose logs -f caddy
```

## 6. Verify

```bash
curl -sI https://radware.ztat.me | head -1        # 200, valid TLS
docker compose exec n8n wget -qO- localhost:5678/healthz
```

Then in the browser: log in with the owner account, confirm `Radware Chat
Model` appears under Language Models and `Radware Guard` under the node picker,
and check that no deprecation warnings appear in `docker compose logs n8n`.

## 7. Credentials and workflows

Create both credentials in the UI, so the keys go into the encrypted store and
never touch a shell:

- **Radware In-Path API** — the `sk-rdwr-` key, provider `openai`. Use the
  credential test; it should go green.
- **Radware Out-of-Path API** — the key from the out-of-path homegrown agent.
  See [`portal-setup.md`](portal-setup.md); this is a *different* agent from the
  in-path one.

Then:

```bash
N8N_URL=https://radware.ztat.me N8N_PASSWORD='...' pnpm import:workflows
```

Activate `Lab 1 - In-Path Chat Agent` in the UI and copy its public chat URL.

## 9. Reviewer logins

```bash
N8N_URL=https://radware.ztat.me N8N_PASSWORD='...' \
  pnpm invite reviewer-one@example.com reviewer-two@example.com
```

Invites are issued as **admin**, and that needs saying out loud. n8n's Community
edition has no workflow sharing: per n8n's documentation, only the instance
owner and the creator can access a workflow. A `member` account here would log
in to an empty workspace, so admin is the only instance role that makes a review
possible.

An admin can view and edit every workflow, use every stored credential, and add
or remove users. n8n never returns credential values to the browser, but an
admin can build a workflow that *uses* one, so an admin invite is effectively
handing over use of the Radware and provider keys. Revoke the accounts when the
review is done, and rotate the keys if the instance outlives it.

No SMTP is configured, so nothing is emailed. The command prints one signup link
per person. Those links set a password on first use: treat them as credentials
and send them over a channel you would send a password over.

## 8. Before sharing the link

- Set a hard spend cap on the upstream provider account. Rate limiting bounds
  request volume; only the cap bounds cost.
- Confirm `send_email` is still the placeholder.
- Run one benign message and one guardrail-violating message, and check both
  appear in the portal's Security Events.

## Operating notes

```bash
docker compose logs -f n8n
docker compose pull && docker compose up -d --build   # upgrade
docker compose exec postgres pg_dump -U n8n n8n > backup.sql
```

Back up `deploy/.env` and the `n8n_data` volume together. The database is
useless without the encryption key.

Executions are pruned after seven days. Adjust `EXECUTIONS_DATA_MAX_AGE` if
evidence needs to outlive that, or export it to `reports/` instead.
