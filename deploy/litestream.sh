#!/bin/sh
# The litestream container's whole entrypoint: check the credentials, write a config from the
# databases that ACTUALLY EXIST, replicate, and come back when that set changes.
#
# Why generated and not a checked-in litestream.yml: `dbs[].path` takes no wildcard in 0.3.13 —
# a `minds/*.db` entry is taken literally, so a glob backs up nothing while reporting itself
# healthy. A named roster is worse: the moment a child is born its mind db is outside the backup
# and nothing says so until a restore.
#
# Litestream replicates only WAL-mode databases; `openDb` sets that pragma on every open here.
set -eu

if [ -z "${LITESTREAM_BUCKET:-}" ] || [ -z "${LITESTREAM_ACCESS_KEY_ID:-}" ] ||
  [ -z "${LITESTREAM_SECRET_ACCESS_KEY:-}" ]; then
  echo "litestream: NOT BACKING ANYTHING UP — no S3 credentials." >&2
  echo "            Set LITESTREAM_BUCKET, LITESTREAM_ACCESS_KEY_ID and" >&2
  echo "            LITESTREAM_SECRET_ACCESS_KEY in .env — see deploy/.env.example." >&2
  exit 1
fi

CONFIG=/tmp/litestream.yml
# One full copy a day kept for a week: 6-hourly kept 28 copies of a database that grows 64 MB/day.
SNAPSHOT_INTERVAL=24h
RETENTION=168h

# Every .db under /data, and the S3 key is its path with the slashes turned into one name.
databases() {
  find /data -name '*.db' | sort
}

write_config() {
  echo 'dbs:' >"$CONFIG"
  for db in $(databases); do
    key=$(echo "${db#/data/}" | sed 's/\.db$//')
    cat >>"$CONFIG" <<YAML
  - path: $db
    replicas:
      - type: s3
        bucket: $LITESTREAM_BUCKET
        path: san-junipero/$key
        region: ${LITESTREAM_REGION:-us-east-1}
        endpoint: ${LITESTREAM_ENDPOINT:-}
        retention: $RETENTION
        snapshot-interval: $SNAPSHOT_INTERVAL
YAML
  done
}

write_config
echo "litestream: replicating $(databases | wc -l) database(s):" >&2
databases >&2

litestream replicate -config "$CONFIG" &
pid=$!
seen=$(databases)
while kill -0 "$pid" 2>/dev/null; do
  sleep 60
  # A mind db that appears after boot — a birth — is invisible to a running litestream, and
  # `restart: unless-stopped` is what brings this back with it in the config.
  if [ "$(databases)" != "$seen" ]; then
    echo 'litestream: the set of databases changed — restarting to pick it up' >&2
    kill "$pid"
    exit 1
  fi
done
wait "$pid"
