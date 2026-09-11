# Deployment plan: automated Duolingo → Anki sync

## Goal

Replace the manual `duolingo_update.bat` workflow (launch Anki → run WSL
script → kill Anki) with a service on a separate always-on Linux machine
that, roughly every 10 minutes, checks whether new Duolingo vocab has been
learned and, if so, pushes it into Anki and syncs to AnkiWeb — with no manual
step required day-to-day.

## Proposed solution

Two containers in one `docker-compose.yaml`, on the same Docker network:

1. **`anki` service** — [ankimcp/headless-anki](https://github.com/ankimcp/headless-anki),
   `x11-vnc-addons` variant. Runs actual Anki headless (Xvfb + VNC) with the
   AnkiConnect add-on pre-installed and patched to bind `0.0.0.0`, so it's
   reachable from the poller container. Exposes:
   - `8765` — AnkiConnect (used by the poller)
   - `5900` — VNC (for one-time interactive setup / occasional debugging)

2. **`poller` service** — our own small container running `src/index.ts`
   (already ported to npm/tsx, config via env vars) in a loop every 10
   minutes, talking to `http://anki:8765` instead of `localhost:8765`.

### One-time manual setup

`headless-anki` doesn't document an AnkiWeb login flow. Expectation: connect
a VNC client to the `anki` container once and log into AnkiWeb interactively,
same as first-time desktop Anki setup. Needs to be confirmed on the actual
box.

### Script change (agreed)

Currently `main()` unconditionally calls `ankiRequest("sync")` at the end.
Change this to only sync to AnkiWeb when `upsertNotes` actually added or
updated notes — avoids syncing every 10 minutes for no reason when there's
nothing new.

## Open risk to verify before relying on this

The `headless-anki` example `docker-compose.yaml` only volume-mounts
`prefs21.db`:

```yaml
volumes:
  - ./data/prefs21.db:/data/prefs21.db
```

It's not confirmed whether that's sufficient to survive a container
recreate with decks/notes/login intact, or whether more of the Anki data
directory (collection, media, sync auth) needs to be mounted too. Needs to
be tested directly (add a note, recreate the container, confirm the note
and AnkiWeb login both survive) before treating this as production-ready.

## Status

Paused — user wants to dig into something else before finalizing this plan.
