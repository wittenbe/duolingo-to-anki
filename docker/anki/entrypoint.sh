#!/bin/bash
# Replaces the base image's /startup.sh, which ignores SIGTERM: Docker then SIGKILLs Anki,
# which only saves its profile (including the AnkiWeb login) when it shuts down cleanly.

# On a restart of the same container (docker restart, daemon restart, reboot) /tmp keeps the
# previous run's X display lock and sockets; Xvnc then refuses to start and Anki aborts in a loop.
rm -rf /tmp/.X99-lock /tmp/.X11-unix/X99 /tmp/anki* /tmp/mpv.*

# Anki auto-updates add-ons, which resets AnkiConnect's config.json to bind 127.0.0.1.
# User config in meta.json survives updates, so set the bind address there on every start.
META=/data/addons21/2055492159/meta.json
if [ -d "$(dirname "$META")" ]; then
  [ -f "$META" ] || echo '{}' > "$META"
  jq '.config = ((.config // {}) + {"webBindAddress": "0.0.0.0"})' "$META" > /tmp/meta.json && mv /tmp/meta.json "$META"
else
  echo "AnkiConnect not found in /data/addons21; the poller won't be able to connect" >&2
fi

Xvnc :99 -geometry 1920x1080 -depth 24 -rfbport 5900 -SecurityTypes None -AlwaysShared \
  -desktop Anki -nolisten tcp &
for _ in $(seq 1 50); do
  [ -e /tmp/.X11-unix/X99 ] && break
  sleep 0.2
done
openbox &

stopping=0
anki_pid=
on_stop() {
  stopping=1
  [ -n "$anki_pid" ] && kill -TERM "$anki_pid" 2>/dev/null
}
trap on_stop TERM INT

while [ "$stopping" = 0 ]; do
  anki -b /data &
  anki_pid=$!
  wait "$anki_pid"
  [ "$stopping" = 1 ] && break
  echo "Anki exited, restarting in 2s..."
  sleep 2
done

# `wait` returns as soon as the trap fires; wait again for Anki to finish closing.
wait "$anki_pid" 2>/dev/null
echo "Anki closed cleanly"
