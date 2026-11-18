#!/bin/sh
# `make check-images` (spec 0013a, AC6): builds the three production images for this machine's
# architecture and checks them in throwaway containers, removed on exit even after a failure.
set -eu

tag="homie-check-$$"
# Not a secret: the same dummy for every value that only has to be long enough.
dummy=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

cleanup() {
  docker rm -f "$tag-admin" "$tag-redis" "$tag-redis-nopass" >/dev/null 2>&1 || true
  docker image rm -f "$tag-api" "$tag-admin" "$tag-redis" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "check-images: $1" >&2
  exit 1
}

for name in api admin redis; do
  if grep '^FROM' "infra/Dockerfile.$name" | grep -qv '@sha256:'; then
    fail "infra/Dockerfile.$name: a FROM line has no @sha256: digest"
  fi
  docker build -q -f "infra/Dockerfile.$name" -t "$tag-$name" . >/dev/null
done

docker run --rm "$tag-api" sh -c \
  'test -f /app/data/settlements.csv && test ! -e /app/admin && test ! -e /app/tests' ||
  fail "api image: needs data/settlements.csv and neither admin/ nor tests/"
echo "check-images: api image ok"

# Docker may leave IPv6 off in a container, loopback included; Fly's machines have it on.
docker run -d --name "$tag-admin" --sysctl net.ipv6.conf.lo.disable_ipv6=0 \
  -e ADMIN_DATABASE_URL=postgresql+psycopg://check-images.invalid/none \
  -e ADMIN_PASSWORD="$dummy" -e ADMIN_SECRET_KEY="$dummy" \
  -e ADMIN_HTTPS_ONLY=true -e ADMIN_ALLOWED_HOSTS=localhost,127.0.0.1 "$tag-admin" >/dev/null
probe='import urllib.request as u; u.urlopen(u.Request("http://[::1]:8001/admin/login", headers={"Host": "localhost"}), timeout=2)'
tries=0
until docker exec "$tag-admin" /opt/venv/bin/python -c "$probe" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    docker logs "$tag-admin" >&2 || true
    fail "admin image: /admin/login did not answer on [::1]:8001"
  fi
  sleep 1
done
echo "check-images: admin image ok"

docker run -d --name "$tag-redis-nopass" "$tag-redis" >/dev/null
tries=0
while [ "$(docker inspect -f '{{.State.Running}}' "$tag-redis-nopass")" = true ]; do
  tries=$((tries + 1))
  [ "$tries" -lt 10 ] || fail "redis image: still running without REDIS_PASSWORD"
  sleep 1
done
[ "$(docker inspect -f '{{.State.ExitCode}}' "$tag-redis-nopass")" != 0 ] ||
  fail "redis image: exited 0 without REDIS_PASSWORD"

docker run -d --name "$tag-redis" -e REDIS_PASSWORD="$dummy" "$tag-redis" >/dev/null
tries=0
until docker exec "$tag-redis" redis-cli PING 2>&1 | grep -q NOAUTH; do
  tries=$((tries + 1))
  if [ "$tries" -ge 20 ]; then
    docker logs "$tag-redis" >&2 || true
    fail "redis image: an unauthenticated PING did not answer NOAUTH"
  fi
  sleep 1
done
config() {
  docker exec -e REDISCLI_AUTH="$dummy" "$tag-redis" redis-cli CONFIG GET "$1" | tail -n 1
}
[ "$(config maxmemory-policy)" = noeviction ] || fail "redis image: maxmemory-policy is not noeviction"
[ "$(config appendonly)" = yes ] || fail "redis image: appendonly is not yes"
uid=$(docker exec "$tag-redis" awk '/^Uid:/ { print $2 }' /proc/1/status)
[ -n "$uid" ] && [ "$uid" != 0 ] || fail "redis image: PID 1 runs as uid 0"
echo "check-images: redis image ok"
