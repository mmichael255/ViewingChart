#!/bin/sh
set -e

retries=30
delay=2

echo "Waiting for database..."
for i in $(seq 1 "$retries"); do
  if alembic upgrade head 2>&1; then
    echo "Migrations applied successfully."
    exec "$@"
  fi
  echo "Migration attempt $i/$retries failed. Retrying in ${delay}s..."
  sleep "$delay"
done

echo "FATAL: Could not apply migrations after $retries attempts." >&2
exit 1