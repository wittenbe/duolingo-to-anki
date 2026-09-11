# Headless Anki (TigerVNC + openbox), https://github.com/ankimcp/headless-anki
FROM ghcr.io/ankimcp/headless-anki:x11-vnc-v1.5.0

# AnkiConnect, downloaded for this image's Anki version (26.8.1 -> 260801).
# Installed into /data, so it lands in the anki-data volume when that is first created;
# afterwards Anki keeps it updated itself.
ARG ANKICONNECT_ID=2055492159
ARG ANKI_VERSION_CODE=260801
RUN curl -sfL -o /tmp/ankiconnect.zip "https://ankiweb.net/shared/download/${ANKICONNECT_ID}?v=2.1&p=${ANKI_VERSION_CODE}" \
 && mkdir -p /data/addons21/${ANKICONNECT_ID} \
 && unzip -q /tmp/ankiconnect.zip -d /data/addons21/${ANKICONNECT_ID} \
 && rm /tmp/ankiconnect.zip \
 && chown -R anki /data/addons21

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
