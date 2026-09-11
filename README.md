# duolingo-to-anki

Turns the words you've learned on Duolingo into Anki flashcards, with Duolingo's
pronunciation audio, and keeps them up to date. It runs as an always-on Docker service
next to a headless Anki: every 10 minutes it checks Duolingo for new words, adds them,
and syncs to AnkiWeb, so they show up on your phone.

Currently hardcoded to the Spanish-from-English course.

## What you get

```
Español (Duolingo)
├─ English → Spanish   "they" → ellas (also accepted: ellos) 🔊
└─ Spanish → English   ellas 🔊 → "they"
```

- One note per Spanish word, on a custom note type `Duolingo Spanish` with fields
  `Spanish`, `English`, `AlsoAccepted` and `Audio`.
- Each note has two cards, filed into the two subdecks.
- English → Spanish cards list other Spanish words with exactly the same English
  as "also accepted", so ambiguous prompts can still be graded fairly.
- When Duolingo changes a word's translation, the existing card is edited in place,
  so its review history is kept.

## Setup

### 1. Duolingo credentials

- **`DUOLINGO_TOKEN`**: log in on duolingo.com, open the browser dev tools and copy the
  value of the `jwt_token` cookie. Put it in `.env` with a `Bearer ` prefix:
  `DUOLINGO_TOKEN=Bearer eyJ...`
- **`DUOLINGO_USER_ID`**: the `sub` field of that token's payload. Decode the middle part
  of the JWT, e.g. on jwt.io.

```sh
cp .env.example .env    # then fill in both values
```

### 2. Deploy with Docker

Needs Docker Engine with the compose plugin (amd64 or arm64).

```sh
git clone https://github.com/wittenbe/duolingo-to-anki.git && cd duolingo-to-anki
cp .env.example .env    # fill in the credentials
docker compose up -d --build
```

### 3. Log in to AnkiWeb (once)

The fresh `anki` container starts with an empty collection. Until it's logged in and has
downloaded your collection, every poller run stops at its first step, which is harmless.

1. Tunnel VNC from your PC: `ssh -L 5900:localhost:5900 <user>@<server>`. On the same
   machine, skip this.
2. Connect a VNC viewer (e.g. TigerVNC Viewer) to `localhost:5900`. There's no password.
3. In Anki, click **Sync**, log in, and when asked choose **Download**.
   **Never choose Upload here**: it would replace your AnkiWeb collection with the
   empty one.
4. Run `docker compose restart anki`. Anki writes the login to disk only when it shuts
   down cleanly.
5. The next poll (or `docker compose restart poller`) runs the first full sync.

The login and collection live in the `anki-data` volume, so they survive restarts,
reboots and rebuilds. `docker compose down -v` deletes the volume, and you'll need to log
in again.

Run only one poller per AnkiWeb account. Two instances adding the same new word at the
same time would create duplicate notes once both sync.

### Without Docker

Against Anki desktop with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
add-on installed and Anki open:

```sh
npm install
npm start        # one full sync
npm run poll     # the 10-minute loop
```

## Configuration

Set in `.env`. `compose.yaml` already sets `ANKI_URL` and `VOCAB_FILE` for the container.

| Variable | Default | |
|---|---|---|
| `DUOLINGO_USER_ID` | required | See [credentials](#1-duolingo-credentials) |
| `DUOLINGO_TOKEN` | required | `Bearer <jwt>` |
| `ANKI_URL` | `http://localhost:8765` | AnkiConnect endpoint |
| `POLL_INTERVAL_MINUTES` | `10` | How often to check Duolingo for new words |
| `FULL_SYNC_INTERVAL_HOURS` | `24` | Forced full sync, catches edited translations |
| `VOCAB_FILE` | `spanish_vocab_prompt.txt` | Writes a tutoring prompt for an LLM with all your learned words; empty string disables it |

## How it works

### Polling (`src/poll.ts`)

Each poll makes 2 Duolingo requests and builds a fingerprint:
`<total learned words>:<newest word>`. A full sync runs only when:
- the fingerprint changes,
- the poller starts, or
- 24 hours have passed since the last full sync. That catches Duolingo editing an
  existing word's translation, which doesn't change the fingerprint.

A failed poll is logged and retried at the next interval.

### Full sync (`src/run-sync.ts`)

1. **Sync with AnkiWeb first.** If that fails, stop without touching the collection.
   An unsynced collection (fresh container, logged out, full sync pending) must never
   be modified, or it could later overwrite AnkiWeb.
2. Fetch all learned words from Duolingo (4 requests of 500) and validate the response
   shape with zod (`src/duolingo/schemas.ts`).
3. Add new notes, update changed ones, prune stale ones and file cards into their
   subdecks (`src/anki/sync.ts`).
4. Sync with AnkiWeb again, only if something changed.

### Handling Duolingo's data

Duolingo's translations are unstable, which is why notes are keyed on the Spanish word:
- A changed translation edits the existing card.
- A word whose translations come back empty (this happens temporarily after some
  lessons) is skipped: an existing card stays as it is, and a new word gets its card
  once translations appear.
- Words whose only translation is the word itself (e.g. `rap`) get no card.
- A note is deleted only when its Spanish word disappears from Duolingo, and a single run
  refuses to delete more than 10% of the deck, in case of a truncated response.

### Containers (`compose.yaml`)

- **`anki`**: Anki 26.8 from [ankimcp/headless-anki](https://github.com/ankimcp/headless-anki),
  running under TigerVNC and openbox, plus AnkiConnect (`docker/anki/`). AnkiConnect is
  reachable only from the poller container, and VNC only on the host's `127.0.0.1`.
  The health check connects the same way the poller does.
- **`poller`**: this repo on Node 24, run with tsx.

`docker/anki/entrypoint.sh` replaces the base image's startup script to fix three
problems found in testing:
- **Login lost on stop.** The base script ignores Docker's SIGTERM, so Anki got
  force-killed and never saved its profile, which holds the AnkiWeb login. The
  entrypoint forwards the signal and waits for Anki to close (`stop_grace_period: 60s`).
- **Crash loop after a restart.** A restarted container, including after a reboot,
  kept the previous run's X display lock in `/tmp`. Anki then aborted in a loop. The
  entrypoint deletes the stale files first.
- **Add-on updates reset the bind address.** Anki updates AnkiConnect by itself, which
  resets its `config.json` to accept only local connections. The entrypoint sets the
  bind address in `meta.json`, which updates don't touch.

## Troubleshooting

- **Logs**: `docker compose logs -f poller`
- **Update**: `git pull && docker compose up -d --build`. AnkiConnect is copied into the
  volume only when the volume is first created; after that Anki keeps it updated.
- **"auth not configured"**: the AnkiWeb login is missing, e.g. after a fresh volume or an
  unclean shutdown right after logging in. Repeat the [AnkiWeb login](#3-log-in-to-ankiweb-once).
- **"Sync status 2 not one of [0, 1]"**: a structural change (note type, field or card
  template added or removed) requires a full sync, which AnkiConnect can't do. Resolve
  it over VNC: choose **Download** if the change was made elsewhere, e.g. on your
  desktop. Make structural changes on the desktop, not by editing
  `src/anki/note-type.ts` against the server.

## Duolingo API notes

This uses Duolingo's unofficial API. Verified against live responses:

- `currentCourse.skills` is an array of arrays.
- The learned-words endpoint needs the progressed skills in the POST body, returns words
  newest first, and honors `limit` up to at least 500.
- `translations` can be temporarily empty (seen for `exigente`) and can flip between
  requests (`tranquila`: "calm" ↔ "calm down").
- `isNew`, `wordsLearned` and `numberOfWords` are useless as change signals.

## Project layout

```
src/
  poll.ts             polling loop (Docker entry point)
  index.ts            one-shot full sync (npm start)
  run-sync.ts         the full sync
  config.ts           env config, deck names
  duolingo/           typed Duolingo client + zod schemas
  anki/               AnkiConnect client, note type, sync logic
  vocab-file.ts       LLM tutoring prompt file
docker/anki/          headless Anki image + entrypoint
compose.yaml, Dockerfile
```
