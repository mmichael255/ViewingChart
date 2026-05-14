#!/bin/sh
set -e

retries=30
delay=2

echo "Waiting for database..."
for i in $(seq 1 "$retries"); do
  if alembic upgrade head 2>&1; then
    echo "Migrations applied successfully."
    break
  fi
  echo "Migration attempt $i/$retries failed. Retrying in ${delay}s..."
  sleep "$delay"
done

if ! alembic current > /dev/null 2>&1; then
  echo "FATAL: Could not apply migrations after $retries attempts." >&2
  exit 1
fi

echo "Starting application..."
exec "$@"