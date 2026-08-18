# Running Syndix unattended

This is the runbook for the publishing cycle on a server. The web app does not
need to be here - Vercel serves that. This box does one thing: wake up, look at
the chain, and publish an issue if something happened.

## What actually runs

```
systemd timer (4x/day)
  -> npm run cycle
       -> lib/telemetry.ts    measure GIWA: head, gas, latency, freshness, treasury
       -> lib/novelty.ts      diff against the last issue's pinned snapshot
       -> (stop here on most runs)
       -> SyndixPublisher     check the daily allowance BEFORE spending money
       -> OpenAI              write the issue from measured figures only
       -> Pinata              pin it; a draft that will not pin is discarded
       -> SyndixPublisher     publish on chain with the hot key
```

The order is cheapest-first. A cycle that finds nothing new costs a few RPC
calls and stops before the model is ever called.

## Why the timer runs more often than it can publish

The timer fires four times a day. `SyndixPublisher.maxPublishesPerDay` is **1**.

That is not a contradiction, it is the design. A reader claim can land at any
hour, and checking once daily would leave it unreported for up to a day.
Checking four times means the next check picks it up. The publishing ceiling is
enforced by the contract, so **editing the timer cannot make Syndix publish more
often than once a day** - the fourth call of the day reverts with
`DailyLimitReached` no matter what this box believes.

## Installing on a box that already runs other things

This is written for a server with existing services on it. The cycle is built
to be a bad neighbour to nothing:

- **It binds no ports.** Every call it makes is outbound, so it cannot collide
  with anything already listening.
- **It does not need Next, a web server, or a database.** `publish-cycle.ts`
  imports viem, the OpenAI client and this repo's `lib/` and nothing else. The
  app on Vercel is unaffected by any of this.
- **It runs for ~90 seconds, four times a day**, then exits. `Type=oneshot`
  means nothing stays resident between runs.
- **The unit is capped** at `MemoryMax=1G` and `CPUQuota=80%`, and the systemd
  hardening (`ProtectSystem=strict`, `PrivateTmp`, `ProtectHome`) is scoped to
  this service alone. None of it changes anything for other units.

**The one real risk is Node.** If another service on this box pins a Node
version, do not upgrade the system one to satisfy this. Check first:

```bash
bash scripts/preflight.sh
```

That inspects the machine and writes nothing. It reports the Node version,
whether `syndix`/`/opt/syndix`/the units already exist, disk and memory
headroom, whether the three external hosts answer, and it prints the exact
`ExecStart` line for this machine.

If the system Node is older than 20 and something else depends on it, install a
second one for the `syndix` user only and point `ExecStart` at that binary -
never replace the system one:

```bash
sudo -u syndix bash -c 'curl -fsSL https://fnm.vercel.app/install | bash'
sudo -u syndix ~syndix/.local/share/fnm/fnm install 22
# preflight prints the resulting path; put it in ExecStart
```

Node 20+ is required for `--env-file`, which is how secrets reach the process
without adding a dotenv dependency.

## Install

Not one command - roughly six, and `preflight.sh` first.

```bash
# 1. Inspect. Changes nothing.
bash scripts/preflight.sh

# 2. A dedicated unprivileged user, so nothing here runs as root or as the
#    user your other services use.
#
#    NOT --create-home. That would populate /opt/syndix with shell skeleton
#    files, and git clone refuses a directory that is not empty. The directory
#    is made separately below so git owns its contents.
sudo useradd --system --home-dir /opt/syndix --shell /usr/sbin/nologin syndix

# 3. Code. `install -d` creates the directory already owned by syndix, so the
#    clone runs unprivileged into an empty path.
sudo install -d -o syndix -g syndix -m 755 /opt/syndix
sudo -u syndix git clone https://github.com/mrnetwork0001/Syndix.git /opt/syndix
cd /opt/syndix

# 4. Dependencies. --include=dev is deliberate: tsx is a devDependency, and a
#    box with NODE_ENV=production set globally would otherwise skip it and the
#    unit would fail with "tsx: not found".
sudo -u syndix npm ci --include=dev

# 5. Secrets.
sudo -u syndix cp .env.example .env.local
sudo -u syndix nano .env.local
sudo chmod 600 /opt/syndix/.env.local

# 6. Confirm it works BEFORE handing it to systemd.
sudo -u syndix npm run cycle -- --dry-run
```

Only once that dry run looks right:

```bash
sudo cp deploy/syndix-cycle.service deploy/syndix-cycle.timer /etc/systemd/system/
# Edit ExecStart if preflight said your node is somewhere systemd cannot see.
sudo nano /etc/systemd/system/syndix-cycle.service
sudo systemctl daemon-reload
sudo systemctl enable --now syndix-cycle.timer
```

`daemon-reload` re-reads unit files; it does not restart anything already
running.

### Required in `.env.local`

| Key | Why |
| --- | --- |
| `PUBLISHER_PRIVATE_KEY` | The hot key. Publishes and nothing else. |
| `NEXT_PUBLIC_SYNDIX_PUBLISHER` | The guard contract it calls. |
| `NEXT_PUBLIC_SYNDIX_TREASURY` | Read for treasury state and the last snapshot. |
| `OPENAI_API_KEY` | Writing the issue. |
| `PINATA_JWT` | Pinning the body. |
| `PINATA_GATEWAY` | Reading the last issue's snapshot quickly. |
| `SYNDIX_TRACK` | Optional; defaults to `giwa-l2`. |

**`PRIVATE_KEY` (the treasury owner) must NOT be on this box.** The whole point
of `SyndixPublisher` is that the server holds a key that cannot withdraw, cannot
change caps, and cannot take treasury ownership. Putting the owner key here
throws that away. `preflight.sh` fails the run if it finds one.

## Uninstalling cleanly

If it turns out to be a nuisance, it leaves nothing behind:

```bash
sudo systemctl disable --now syndix-cycle.timer
sudo rm /etc/systemd/system/syndix-cycle.{service,timer}
sudo systemctl daemon-reload
sudo rm -rf /opt/syndix
sudo userdel syndix
```

## Operating

```bash
systemctl list-timers syndix-cycle.timer     # when it next fires
journalctl -u syndix-cycle.service -n 50     # what the last cycle decided
journalctl -u syndix-cycle.service -f        # follow
sudo systemctl start syndix-cycle.service    # run one now
```

Every cycle logs why it did or did not publish. `[gate]` lines carry the reason.

## Funding

Two addresses, two different jobs.

| Address | Holds | Runs out when |
| --- | --- | --- |
| `SyndixPublisher` `0xb542E132e43149E99bef100654Dbe9e079470824` | ETH it spends on reward pools | Cycle dies at `[allowance]` with "holds N wei but needs M" |
| Hot wallet `0x96fd6EF88C0e4A298bE4144df614cA9C955EE910` | ETH for gas | Transaction send fails |

At 0.0006 ETH per issue and one issue a day, the guard needs roughly **0.018
ETH/month**. Gas is about 0.05% of that and rounds to nothing, but the hot
wallet still needs a balance to pay it.

The cycle checks the guard's balance before generating, so an underfunded guard
costs a log line rather than a wasted model call.

`SyndixSponsorship` (`0xC853Eaef43Fa30FBB990F13cb3fCaea2A00A256a`) is the
intended long-run source: sponsors deposit, 80% is committed to readers, and
`fundTreasury` moves it where only readers can reach it. It funds the treasury,
not the guard, so the guard is still topped up by hand today.

## If something goes wrong

**Stop publishing immediately**

```bash
sudo systemctl disable --now syndix-cycle.timer
```

**Revoke the hot key** - from the cold owner wallet, not this box:

```bash
cast send $PUBLISHER "setPublisher(address)" 0x0000000000000000000000000000000000000000 \
  --private-key $OWNER_KEY --rpc-url https://sepolia-rpc-flashblocks.giwa.io
```

The guard keeps working; it simply has no publisher. Rotate to a fresh key with
the same call.

**Take the treasury back entirely**

```bash
cast send $PUBLISHER "recoverTreasuryOwnership(address)" $YOUR_COLD_WALLET \
  --private-key $OWNER_KEY --rpc-url https://sepolia-rpc-flashblocks.giwa.io
```

Ownership returns in one transaction. This was tested end to end on
2026-08-17 before anything depended on it - see `docs/ENGINEERING.md`.

## What this setup does not protect against

Worth being explicit, because the guard covers less than it looks like.

- **A stolen hot key can still publish.** It cannot steal funds, raise caps or
  touch the treasury, but it can publish one issue a day with whatever content
  it likes, funded from the guard. The cap bounds the money, not the words.
- **Nobody reads the draft.** Every issue published before this cycle existed
  was reviewed by a human first. That check is gone; what replaces it is the
  measured-figures rule and the novelty gate, which are narrower.
- **The gate can only see what it measures.** Something newsworthy that does
  not move gas, latency, freshness or treasury state will not trigger an issue.
