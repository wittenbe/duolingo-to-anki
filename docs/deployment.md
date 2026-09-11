# Duolingo → Anki: how it works and how to deploy it

## Goal

Replace the manual `duolingo_update.bat` workflow (launch Anki → run the
script → kill Anki) with an always-on service on a Linux machine. Every 10
minutes it checks whether new Duolingo vocab has been learned and, if so,
pushes it into Anki and syncs to AnkiWeb, with nothing to do day-to-day.

## How it works

Two containers, defined in `compose.yaml`:

- **`anki`**: real Anki running headless, from
  [ankimcp/headless-anki](https://github.com/ankimcp/headless-anki) (TigerVNC + openbox),
  plus the AnkiConnect add-on (`docker/anki/Dockerfile`). All Anki state (collection,
  media, AnkiWeb login, add-ons) lives in the `anki-data` volume at `/data`.
  AnkiConnect (`8765`) is only reachable from the poller container; VNC (`5900`, no
  password) is published on `127.0.0.1` only. The health check connects the way the
  poller does, so a `127.0.0.1`-only AnkiConnect shows up as unhealthy.
- `docker/anki/entrypoint.sh` replaces the base image's startup script to fix three
  problems found in testing:
  - **Login lost on stop.** Anki saves its profile, including the AnkiWeb login, only
    on a clean shutdown, and the base script ignores Docker's SIGTERM. The entrypoint
    forwards it and waits for Anki to close (`stop_grace_period: 60s`).
  - **Crash loop after a restart.** A restart of the same container (including after a
    reboot) keeps the previous run's X display lock in `/tmp`, so the display server
    won't start and Anki aborts in a loop. The entrypoint deletes it first.
  - **Add-on updates reset the bind address.** Anki updates AnkiConnect by itself, which
    resets its `config.json` to accept only local connections. The entrypoint sets the
    bind address in `meta.json`, which updates don't touch.
- **`poller`**: this repo, running `src/poll.ts`.

### Poll loop (`src/poll.ts`)

Each tick does a cheap check (2 Duolingo requests): the fingerprint
`<total learned words>:<newest word>`. A full sync runs only when the fingerprint
changes, on startup, and at least every 24 h (to catch Duolingo editing translations
of existing words, which doesn't change the fingerprint). A failed tick is logged and
retried next interval. Intervals: `POLL_INTERVAL_MINUTES`, `FULL_SYNC_INTERVAL_HOURS`.

### Full sync (`src/run-sync.ts`)

1. **Sync with AnkiWeb first.** If that fails, stop without touching the collection.
   An unsynced collection (fresh container, not logged in, full sync pending) must
   never be modified, because it could later overwrite AnkiWeb.
2. Fetch all learned words from Duolingo (4 requests of 500) and validate the
   response shape with zod (`src/duolingo/schemas.ts`).
3. Upsert notes, prune stale ones, file cards into their subdecks (`src/anki/sync.ts`).
4. Sync with AnkiWeb again, only if something changed.

### Card model

- Note type **`Duolingo Spanish`**, fields `Spanish` (identity), `English`,
  `AlsoAccepted`, `Audio`. One note per Spanish word.
- Two card templates, each filed into its own subdeck:
  - `Español (Duolingo)::English → Spanish`: back shows "also accepted" for other
    words with the exact same English.
  - `Español (Duolingo)::Spanish → English`: plays the Duolingo pronunciation on the front.
- Duolingo translations are unstable, so notes are keyed on the Spanish word:
  - A changed translation edits the existing card in place, keeping review history.
  - A word with (temporarily) empty translations is skipped: its existing card is left
    alone, and a new word gets its card once translations appear.
  - Words whose only translation is the word itself (`rap`) get no card.
- A note is deleted only when its Spanish word disappears from Duolingo, and a run
  refuses to delete more than 10% of the deck at once.

The identity was migrated from the old per-English-text Basic cards on 2026-09-11
(history preserved). Don't change the `Spanish` identity field again.

## Deploying

Needs Docker Engine with the compose plugin.

```sh
git clone https://github.com/wittenbe/duolingo-to-anki.git && cd duolingo-to-anki
cp .env.example .env    # fill in DUOLINGO_USER_ID and DUOLINGO_TOKEN
docker compose up -d --build
```

### First-time AnkiWeb login (once)

The fresh `anki` container has an empty collection. Until it's logged in and has
downloaded your collection, every poller tick fails at step 1, which is harmless.

1. From your PC, tunnel VNC: `ssh -L 5900:localhost:5900 <user>@<server>`
2. Connect a VNC viewer to `localhost:5900`.
3. In Anki, click **Sync**, log in to AnkiWeb, and when asked choose **Download**.
   **Never choose Upload here**: that would replace your AnkiWeb collection with the
   empty one.
4. Run `docker compose restart anki`. Anki writes the login to disk only when it shuts
   down cleanly; a crash or power cut before that means logging in again.
5. The next tick (or `docker compose restart poller`) runs the first full sync.

After that, the login and collection survive restarts, reboots and
`docker compose up --build`, because they live in the `anki-data` volume.
`docker compose down -v` deletes the volume, after which the login has to be repeated.

Run only one poller per AnkiWeb account. Two instances adding the same new word at the
same time would create duplicate notes once both sync.

## Operations

- Logs: `docker compose logs -f poller`
- Update: `git pull && docker compose up -d --build`. The AnkiConnect add-on is
  copied into the volume only when the volume is first created; after that Anki
  updates it itself.
- **"auth not configured"**: the AnkiWeb login is missing, e.g. after a fresh volume or
  an unclean shutdown right after logging in. Log in over VNC again (steps above).
- **"Sync status 2 not one of [0, 1]" / "full sync required"**: someone made a
  structural change (added or removed a note type, field or card template). AnkiConnect
  can't do full syncs, so resolve it over VNC. Choose **Download** if the change was
  made elsewhere (e.g. on the desktop). Make structural changes on the desktop, not by
  changing `src/anki/note-type.ts` against the server.
- Run without Docker, against Anki desktop with AnkiConnect: `npm start` (one full
  sync) or `npm run poll` (the loop).

## Duolingo API notes

Unofficial API, verified against live responses:

- `currentCourse.skills` is an array of arrays.
- The learned-words endpoint needs the progressed skills in the POST body, returns
  newest first, and honors `limit` up to at least 500.
- `translations` can be temporarily empty (seen for `exigente`) and can flip between
  requests (`tranquila`: "calm" ↔ "calm down").
- `isNew`, `wordsLearned` and `numberOfWords` are not usable as change signals.
