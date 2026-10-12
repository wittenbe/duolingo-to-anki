# duolingo-to-anki

Turns the words you've learned on Duolingo into Anki flashcards, with Duolingo's
pronunciation audio, and keeps them up to date. It runs as an always-on Docker service
next to a headless Anki: every 10 minutes it checks Duolingo for new words, adds them,
and syncs to AnkiWeb, so they show up on your phone.

Currently hardcoded to the Spanish-from-English course.

## What you get

```
Español (Duolingo)
├─ English → Spanish   "they" (a group of women) → ellas (also accepted: ellos) 🔊
└─ Spanish → English   ellas 🔊 → "they" (a group of women)
```

- One note per Spanish word, on a custom note type `Duolingo Spanish` with fields
  `Spanish`, `English`, `AlsoAccepted`, `Audio` and `Notes`.
- Each note has two cards, filed into the two subdecks.
- English → Spanish cards list other Spanish words with exactly the same English
  as "also accepted", so ambiguous prompts can still be graded fairly.
- When Duolingo changes a word's translation, the existing card is edited in place,
  so its review history is kept.
- `Notes` is yours. Whatever you type there is shown on both cards and is never
  overwritten by the sync, see [your own notes](#your-own-notes).

Optionally it also keeps two **tutoring prompts** up to date in Google Drive. Give either
to Claude, Gemini or any other chatbot and it quizzes you with sentences you can actually
answer:

- a **reference prompt** with every word you've learned and every grammar concept the
  course has taught you, for looking things up, and
- a **daily drill prompt** with a few words picked by Anki from the ones you keep getting
  wrong, three rotating grammar concepts, and an explicit list of the structures you have
  *not* been taught yet.

The second one exists because a list of 1900 words is not a constraint a chatbot can
keep: it reads as a suggestion, and you get sentences full of words and tenses you have
never seen. Forty words it has to use is a constraint it can keep.

## Setup

Needs Docker Engine with the compose plugin (amd64 or arm64).

### 1. Clone

```sh
git clone https://github.com/wittenbe/duolingo-to-anki.git && cd duolingo-to-anki
cp .env.example .env
```

### 2. Add your Duolingo credentials to `.env`

- **`DUOLINGO_TOKEN`**: log in on duolingo.com, open the browser dev tools and copy the
  value of the `jwt_token` cookie. Add a `Bearer ` prefix:
  `DUOLINGO_TOKEN=Bearer eyJ...`
- **`DUOLINGO_USER_ID`**: the `sub` field of that token's payload. Decode the middle part
  of the JWT, e.g. on jwt.io.

### 3. Start

```sh
docker compose up -d --build
```

### 4. Log in to AnkiWeb (once)

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

### Optional: tutoring prompts in Google Drive

1. In Google Cloud Console:
   1. Create a project and enable the **Google Drive API**.
   2. Create a service account; it needs no roles.
   3. Under its **Keys** tab, choose **Add key → JSON**.
   4. Save the key as `google-service-account.json` in the repo folder. It's gitignored.
      In Docker the container runs as uid 1000, so that user must be able to read the file.
2. In Google Drive, create or upload a file per prompt you want (e.g. two `.txt` files),
   and share each with the service account's email as **Editor**. Service accounts have no
   Drive storage of their own, so they can overwrite a file you own but can't create one.
3. Set `GOOGLE_DRIVE_FILE_ID` (reference prompt) and `GOOGLE_DRIVE_DAILY_FILE_ID` (daily
   drill) in `.env`. Either can be left unset to skip that prompt. An ID is the part
   between `/d/` and `/view` in the file's link.

A file's contents are replaced only when the prompt actually changed. Its ID stays the
same, so links and chatbot attachments keep working.

### The daily drill

The drill set is picked by Anki, which is the only part of this that knows how you are
actually doing. Three searches feed it, in Anki's own
[search syntax](https://docs.ankiweb.net/searching.html):

| Pool | Search | Share |
|---|---|---|
| Words you keep forgetting | `prop:lapses>2` | 15 of 40 |
| Due today anyway | `is:due` | 15 of 40 |
| Learned in the last month | `introduced:30` | 10 of 40 |

A pool that comes up short is made up for from the rest of the deck, so a new deck with
nothing due still gets a full set. If Anki can't be reached at all, the words are sampled
from Duolingo's list instead and the run says so.

The set is drawn once per day (seeded with the date) and then kept, so the file is
rewritten about once a day and reopening a chat later gets you the same words. Restarting
the poller draws a new set for the rest of the day.

### Customizing the prompts

The defaults are `prompt/template.example.md` (reference) and `prompt/daily.example.md`
(drill). To change one, copy it to `prompt/template.md` or `prompt/daily.md` (both
gitignored, so `git pull` never conflicts with your edits) and edit it. Templates are
re-read on every poll, so edits are published within 10 minutes, with no rebuild or
restart.

Placeholders, each replaced if present and ignored if not:

| | Template | Replaced with |
|---|---|---|
| `{{vocabulary}}` | reference | every word you've learned, one per line |
| `{{grammar}}` | reference | every concept you've been taught, with explanations and tables |
| `{{words}}` | daily | today's drill words |
| `{{spotlight}}` | daily | three concepts to lean on today, with explanations |
| `{{learningNow}}` | daily | concepts from the unit you're in the middle of |
| `{{concepts}}` | daily | the titles of every concept you've been taught, by CEFR level |
| `{{notCovered}}` | daily | concepts from the units just ahead: off limits |
| `{{date}}` | daily | today's date |

`{{vocabulary}}` and `{{words}}` are required in their template; a missing one is an
error, on the assumption that you mistyped it.

### Your own notes

Duolingo's English is sometimes too vague to answer: "to leave" could be `salir` or
`dejar`. The `Notes` field is for exactly that. Write into it wherever you review it —
in Anki desktop, or mid-review on the phone (AnkiDroid: **More → Edit note**).

It shows on the English → Spanish front, where the ambiguity is the problem, and on the
Spanish → English back as extra context. The poller identifies notes by their Spanish
word and only ever writes `English`, `AlsoAccepted` and `Audio`, so your text survives
changed translations, full syncs and container rebuilds. It goes away only if the word
disappears from Duolingo and its note is pruned.

Your notes are the one thing here the poller can't recreate, so they only exist in the
collection; Anki's own backups are the backstop.

**One-time, when upgrading an existing deck:** the first run adds the `Notes` field to
the note type and logs that it did. Adding a field is a schema change, so that run ends
with `Sync status 2` and needs one manual full sync:

1. Sync your phone and desktop first, so nothing is left unsynced anywhere.
2. Over VNC, press **Sync** and choose **Upload**. Here that's the right direction: the
   server holds your collection plus the new field.
3. Your other devices will ask to download the full collection on their next sync.

### Without Docker

Against Anki desktop with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159)
add-on installed and Anki open:

```sh
npm install
npm start        # one full sync
npm run poll     # the 10-minute loop
```

## Configuration

Set in `.env`. `compose.yaml` already sets `ANKI_URL` for the container.

| Variable | Default | |
|---|---|---|
| `DUOLINGO_USER_ID` | required | See [credentials](#2-add-your-duolingo-credentials-to-env) |
| `DUOLINGO_TOKEN` | required | `Bearer <jwt>` |
| `ANKI_URL` | `http://localhost:8765` | AnkiConnect endpoint |
| `POLL_INTERVAL_MINUTES` | `10` | How often to check Duolingo for new words |
| `FULL_SYNC_INTERVAL_HOURS` | `24` | Forced full sync, catches edited translations |
| `GOOGLE_DRIVE_FILE_ID` | unset | Drive file for the reference prompt; unset disables it |
| `GOOGLE_DRIVE_DAILY_FILE_ID` | unset | Drive file for the daily drill prompt; unset disables it |
| `DRILL_WORD_COUNT` | `40` | Words in one drill set |
| `DRILL_SPOTLIGHT_COUNT` | `3` | Grammar concepts a drill session leans on |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `google-service-account.json` | Service account key file |

## How it works

### Polling (`src/poll.ts`)

Each poll makes 2 Duolingo requests and builds a fingerprint:
`<total learned words>:<newest word>:<finished units>`. The unit count is in there so that
finishing a unit that taught no new words still refreshes the grammar. A full sync runs
only when:
- the fingerprint changes,
- the poller starts, or
- 24 hours have passed since the last full sync. That catches Duolingo editing an
  existing word's translation, which doesn't change the fingerprint.

A failed poll is logged and retried at the next interval.

### Full sync (`src/run-sync.ts`)

1. Fetch all learned words from Duolingo (4 requests of 500) and validate the response
   shape with zod (`src/duolingo/schemas.ts`).
2. Read the grammar tips out of the unit guidebooks (see below). Any failure here costs
   the grammar sections, not the run.
3. Publish the reference prompt if it changed. This doesn't depend on Anki, and a failure
   is logged and retried at the next poll.
4. **Sync with AnkiWeb before touching Anki.** If that fails, stop without changing the
   collection. An unsynced collection (fresh container, logged out, full sync pending)
   must never be modified, or it could later overwrite AnkiWeb.
5. Add new notes, update changed ones, prune stale ones and file cards into their
   subdecks (`src/anki/sync.ts`).
6. Sync with AnkiWeb again, only if something changed.
7. Ask Anki for today's drill words and publish the daily prompt. Doing it after the push
   means a word added in this run can be drilled the same day.

### Grammar, and the guidebooks it comes from

Every unit on the Duolingo path has a guidebook holding its grammar tips, and the profile
response already carries its URL (`currentCourse.pathSectioned[].units[].guidebook.url`);
the CDN serving it needs no auth. A unit counts as finished when all of its levels are
`legendary`, `passed` or `completed` — `isUnlocked` is `false` on every unit, finished
ones included, so it can't be used for this.

The guidebook is a flat list of rendered elements, and **the only thing separating a
grammar explanation from an example sentence is its font size.** That is an undocumented
detail that can change at any time, so every assumption about it sits in one object,
`GUIDEBOOK_LAYOUT` in `src/duolingo/guidebook.ts`:

| | Means |
|---|---|
| 25px bold | the name of a concept |
| 19px | an explanation belonging to the concept above it |
| a `table` element | a conjugation grid, flattened onto that explanation |
| 17px bold blue | a section marker (`KEY PHRASES`, `TIP`), skipped |

If Duolingo restyles its guidebooks, that object is what needs editing, and nothing else
should. To notice when that day comes, each run checks how many finished units yielded any
concept at all: measured over a finished course section it is about 90%, and below 50% the
run prints a warning naming `GUIDEBOOK_LAYOUT`. Unknown element types, unexpected shapes
and failed fetches are skipped rather than thrown on, one unit at a time.

Guidebooks are cached by URL for the life of the process. The URL contains a hash of the
content, so a cached entry can never be stale: an edited guidebook arrives under a new
URL. A cold start reads the finished units plus the next section (about 180 requests on a
course two thirds done); after that only newly finished units are fetched.

Tips run out after A2: in the Spanish course the 172 units of the B1 and B2 sections carry
key phrases only, so past that point the grammar sections stop growing.

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
  unclean shutdown right after logging in. Repeat the [AnkiWeb login](#4-log-in-to-ankiweb-once).
- **"Sync status 2 not one of [0, 1]"**: a structural change (note type, field or card
  template added or removed) requires a full sync, which AnkiConnect can't do. Resolve
  it over VNC: choose **Upload** if the poller made the change (it logs the field or
  template it added, see [your own notes](#your-own-notes)), **Download** if it was made
  elsewhere, e.g. on your desktop. Sync your other devices before uploading.

## Duolingo API notes

This uses Duolingo's unofficial API. Verified against live responses:

- `currentCourse.skills` is an array of arrays.
- The learned-words endpoint needs the progressed skills in the POST body, returns words
  newest first, and honors `limit` up to at least 500.
- `translations` can be temporarily empty (seen for `exigente`) and can flip between
  requests (`tranquila`: "calm" ↔ "calm down").
- `isNew`, `wordsLearned` and `numberOfWords` are useless as change signals;
  `numberOfWords` is the course's total, not yours.
- Every unit carries `guidebook.url`, and guidebook URLs are content-hashed, so they can
  be cached forever. The API hands out the `iOS` build; the `web` build of the same
  guidebook has different hashes but the same content.
- Irregular verb forms are their own lexemes ("soy", "tengo"), regular conjugations are
  not. Unused, but it does mean the list can tell you which irregular forms you have met.

## Project layout

```
src/
  poll.ts             polling loop (Docker entry point)
  index.ts            one-shot full sync (npm start)
  run-sync.ts         the full sync
  config.ts           env config, deck names
  duolingo/           typed Duolingo client + zod schemas
  anki/               AnkiConnect client, note type, sync logic
  prompt/             renders the two prompts, uploads them on change
  google/             minimal Google Drive client (service account)
  random.ts           date-seeded sampling, so a day's drill set is stable
prompt/               prompt templates (*.example.md, your template.md and daily.md)
docker/anki/          headless Anki image + entrypoint
compose.yaml, Dockerfile
```
