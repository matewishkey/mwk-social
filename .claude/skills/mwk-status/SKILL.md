---
name: mwk-status
description: Where the MWK social pipeline stands right now — unpushed work, the five timers and their last runs, what is in the queue and when it may go, account health, what is waiting for mate. Use at the start of a session, after a restart, or whenever he asks "where are we".
---

# mwk-status — the sweep, so nobody rediscovers it by hand

Every restart begins the same way: what ran, what is waiting, what broke. Doing it ad-hoc takes
ten minutes and misses something. This is the order, and each line is a command that has been run.

Run everything from the repo root. Anything touching Zernio or Cloudflare goes through
`scripts/with-secrets.sh` — systemd's `EnvironmentFile` can read neither `~/.secrets` nor the
sops-encrypted project env, and neither can a bare `node`.

## 1. The code

```sh
git fetch -q origin
git status --short
git rev-list --left-right --count origin/main...HEAD   # behind<TAB>ahead
git log --oneline -8
```

`0	0` is level. **Anything ahead is unpushed work on a box with no backup** — push it before
anything else.

## 2. The timers

```sh
systemctl --user list-timers 'mwk-*' --all --no-pager
for u in mwk-queue mwk-first-comment mwk-ship-events mwk-ship-stats mwk-yt-notes; do
  echo "=== $u ==="; journalctl --user -u "$u" -n 12 --no-pager -o cat
done
```

Five units, all `Type=oneshot`. What each says when it is healthy:

| Unit | Healthy looks like |
|---|---|
| `mwk-queue` | **silence.** Under `--scheduled` it prints only when it actually posts — nine refusals an hour would drown the log |
| `mwk-first-comment` | `N post(s) in window …, 0 without a recorded first comment` |
| `mwk-ship-events` | `shipped N event(s)` or `nothing new, and the last heartbeat was N min ago` |
| `mwk-ship-stats` | `shipped N daily row(s)` + `shipped the platform table, the voice and the pace` |
| `mwk-yt-notes` | `N filled, N proposed, N approved and written` |

**Two `mwk-yt-notes` failures are normal, not faults:** a live event that has not aired
(`This live event will begin in N days`) and a video YouTube has not auto-captioned yet. Both are
deferred and retried under `MWK_CAPTION_GRACE_HOURS`. Read them; do not chase them.

## 3. The queue and the pace

```sh
./scripts/with-secrets.sh node scripts/run-queue.js --dry-run
node -e 'const p=require("./scripts/lib/pace"),e=require("./scripts/lib/events");
  console.log(JSON.stringify(p.status(e.read()),null,1))'
```

`why: null` means it could go out this minute, and the timer asks every five minutes from `*:05`
to `*:45`. There is **no time-of-day window** — only six a day, ninety minutes apart.

## 4. The accounts

```sh
./node_modules/.bin/zernio accounts:health | node -e 'let s="";process.stdin.on("data",d=>s+=d)
  .on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.summary));
  for(const a of j.accounts) if(a.needsReconnect||a.status==="error")
    console.log("BROKEN",a.platform,a.username,JSON.stringify(a.issues));})'
```

Eight accounts. **`warning` is routine — never report it as a fault.** Zernio refreshes tokens
lazily, so an account passes through `warning` with "Token expired or expiring soon (auto-refresh
pending)" and returns to `healthy` on its own. Only `needsReconnect: true` or `status: error` is
a problem.

## 5. What is waiting on him

```sh
gh issue list -R "$(git remote get-url origin | sed 's#.*[:/]\([^/]*/[^/]*\)\.git#\1#')" --state open
ls ~/share/work/mat-mwk-social/input/          # his drop — anything here is still in play
```

The input drop is a to-do list, not a library: whatever is left in it has not been posted yet.
Used files belong in `input/archive/<YYYY-MM-DD>/`.

## 6. Report

**Every time you quote is Brisbane time.** The box runs `Etc/UTC`, so `systemctl`, `journalctl`
and the timestamps in the logs are all UTC — reading one out verbatim is ten hours wrong to him.
`TZ=Australia/Brisbane date '+%H:%M %Z'` is the current time; convert the rest as you write them.
The dashboard already displays Brisbane, so a time from the page needs no conversion.

Lead with the answer — green or not — then the table. Say plainly what is **waiting on him** (a
decision, an issue, a queued item about to go) versus what is **waiting on us**. A queued item
that is about to publish is the single most important line: give him the caption, the time, and
https://social.matewishkey.com/queue so he can stop it.
