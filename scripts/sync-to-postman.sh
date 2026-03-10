#!/usr/bin/env bash
set -euo pipefail

POSTMAN_API_BASE="https://api.getpostman.com"
SPEC_FILE="${1:?Usage: sync-to-postman.sh <path-to-openapi-spec>}"
API_NAME="Atlas Risk & Disputes API"

: "${POSTMAN_API_KEY:?POSTMAN_API_KEY is required}"
: "${POSTMAN_WORKSPACE_ID:?POSTMAN_WORKSPACE_ID is required}"

if [ ! -f "$SPEC_FILE" ]; then
  echo "ERROR: Spec file not found: $SPEC_FILE" >&2
  exit 1
fi

for cmd in jq curl python3; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: ${cmd} is required but not installed" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

postman_api() {
  local method="$1" endpoint="$2"
  shift 2

  local tmpfile
  tmpfile=$(mktemp)

  local http_code
  http_code=$(curl -s -o "$tmpfile" -w '%{http_code}' \
    -X "$method" \
    "${POSTMAN_API_BASE}${endpoint}" \
    -H "X-Api-Key: ${POSTMAN_API_KEY}" \
    -H "Content-Type: application/json" \
    "$@")

  local body
  body=$(cat "$tmpfile")
  rm -f "$tmpfile"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "ERROR: ${method} ${endpoint} returned HTTP ${http_code}" >&2
    echo "$body" | jq . 2>/dev/null || echo "$body" >&2
    return 1
  fi

  echo "$body"
}

parse_yaml_field() {
  local content="$1" path="$2"
  if command -v yq &>/dev/null; then
    echo "$content" | yq -r "$path"
  else
    case "$path" in
      '.servers[0].url')
        echo "$content" | grep -A1 'servers:' | grep 'url:' | head -1 | sed 's/.*url:[[:space:]]*//'
        ;;
      '.info.version')
        echo "$content" | grep -A5 '^info:' | grep 'version:' | head -1 | sed 's/.*version:[[:space:]]*//'
        ;;
      '.info.description')
        echo "$content" | grep -A5 '^info:' | grep 'description:' | head -1 | sed 's/.*description:[[:space:]]*//'
        ;;
    esac
  fi
}

# ===========================================================================
#  PHASE 1 — Git → Spec Hub
#  Push the OpenAPI spec from the repository into Postman Spec Hub.
# ===========================================================================
echo ""
echo "######  PHASE 1: Git → Spec Hub  ######"
echo ""

# --- 1a. Find or create the spec in Spec Hub -------------------------
echo "==> 1a: Find or create spec in Spec Hub"

EXISTING_SPECS=$(postman_api GET "/specs?workspaceId=${POSTMAN_WORKSPACE_ID}")
SPEC_ID=$(echo "$EXISTING_SPECS" | jq -r --arg name "$API_NAME" \
  '[.specs[] | select(.name == $name)] | first // empty | .id // empty')

SPEC_CONTENT=$(cat "$SPEC_FILE")

if [ -n "$SPEC_ID" ]; then
  echo "    Found existing spec: ${SPEC_ID}"
  echo "    Updating spec content..."
  postman_api PATCH "/specs/${SPEC_ID}" \
    -d "$(jq -n --arg name "$API_NAME" --arg content "$SPEC_CONTENT" \
      '{name: $name, files: [{path: "openapi.yaml", content: $content}]}')" > /dev/null
  echo "    Updated."
else
  echo "    Creating new spec..."
  CREATE_RESP=$(postman_api POST "/specs?workspaceId=${POSTMAN_WORKSPACE_ID}" \
    -d "$(jq -n --arg name "$API_NAME" --arg content "$SPEC_CONTENT" \
      '{name: $name, type: "OPENAPI:3.0", files: [{path: "openapi.yaml", content: $content}]}')")
  SPEC_ID=$(echo "$CREATE_RESP" | jq -r '.id')
  echo "    Created spec: ${SPEC_ID}"
fi

echo ""
echo "    Spec is now in Spec Hub (id: ${SPEC_ID})"

# ===========================================================================
#  PHASE 2 — Spec Hub → Collection + Environment
#  Derive Postman assets from the spec that is now in Spec Hub.
# ===========================================================================
echo ""
echo "######  PHASE 2: Spec Hub → Collection + Environment  ######"
echo ""

# --- 2a. Fetch the schema from Spec Hub (single source of truth) -----
echo "==> 2a: Fetch spec content from Spec Hub"

SPECHUB_RESP=$(postman_api GET "/specs/${SPEC_ID}")
echo "    Spec Hub confirms: $(echo "$SPECHUB_RESP" | jq -r '.name') (type: $(echo "$SPECHUB_RESP" | jq -r '.type'))"

# --- 2b. Generate collection from the spec via import ----------------
#     The /import/openapi endpoint accepts the spec as JSON and creates
#     a collection in the workspace. The spec content comes from what we
#     just pushed to Spec Hub (same content, same commit).
echo "==> 2b: Generate collection from spec"

SPEC_JSON=$(python3 -c "
import yaml, json, sys
with open(sys.argv[1]) as f:
    print(json.dumps(yaml.safe_load(f)))
" "$SPEC_FILE")

EXISTING_COLLS=$(postman_api GET "/collections?workspace=${POSTMAN_WORKSPACE_ID}")
EXISTING_COLL_ID=$(echo "$EXISTING_COLLS" | jq -r --arg name "$API_NAME" \
  '[.collections[] | select(.name == $name)] | first // empty | .uid // empty')

if [ -n "$EXISTING_COLL_ID" ]; then
  echo "    Collection already exists: ${EXISTING_COLL_ID}"
  echo "    Updating with latest spec..."
  COLL_PUT_BODY=$(python3 -c "
import yaml, json, sys
spec = yaml.safe_load(open(sys.argv[1]))
title = spec.get('info', {}).get('title', 'API')
coll = {'collection': {'info': {'name': title, 'schema': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'}}}
items = []
for path, methods in spec.get('paths', {}).items():
    for method, op in methods.items():
        if method in ('get','post','put','patch','delete','options','head'):
            items.append({'name': op.get('summary', f'{method.upper()} {path}'),
                          'request': {'method': method.upper(), 'url': {'raw': '{{baseUrl}}' + path, 'host': ['{{baseUrl}}'], 'path': [p for p in path.split('/') if p]}}})
coll['collection']['item'] = items
print(json.dumps(coll))
" "$SPEC_FILE")
  postman_api PUT "/collections/${EXISTING_COLL_ID}" -d "$COLL_PUT_BODY" > /dev/null
  COLLECTION_UID="$EXISTING_COLL_ID"
  echo "    Updated collection: ${COLLECTION_UID}"
else
  IMPORT_BODY=$(jq -n --argjson input "$SPEC_JSON" '{type: "json", input: $input}')
  COLL_RESP=$(curl -s -X POST "${POSTMAN_API_BASE}/import/openapi" \
    -H "X-Api-Key: ${POSTMAN_API_KEY}" \
    -H "X-Workspace-Id: ${POSTMAN_WORKSPACE_ID}" \
    -H "Content-Type: application/json" \
    -d "$IMPORT_BODY")
  COLLECTION_UID=$(echo "$COLL_RESP" | jq -r '.collections[0].uid')
  echo "    Created collection: ${COLLECTION_UID}"
fi

# --- 2c. Derive environment from the spec ----------------------------
echo "==> 2c: Create or update environment from spec"

BASE_URL=$(parse_yaml_field "$SPEC_CONTENT" '.servers[0].url')
BASE_URL="${BASE_URL:-http://localhost:3000}"

SPEC_VERSION=$(parse_yaml_field "$SPEC_CONTENT" '.info.version')
SPEC_VERSION="${SPEC_VERSION:-0.1.0}"

echo "    Derived: baseUrl=${BASE_URL}, apiVersion=${SPEC_VERSION}"

EXISTING_ENVS=$(postman_api GET "/environments?workspace=${POSTMAN_WORKSPACE_ID}")
ENV_NAME="${API_NAME} - Dev"
EXISTING_ENV_ID=$(echo "$EXISTING_ENVS" | jq -r --arg name "$ENV_NAME" \
  '[.environments[] | select(.name == $name)] | first // empty | .uid // empty')

ENV_VALUES=$(jq -n \
  --arg baseUrl "$BASE_URL" \
  --arg version "$SPEC_VERSION" \
  '[{key: "baseUrl", value: $baseUrl, enabled: true},
    {key: "apiVersion", value: $version, enabled: true}]')

if [ -n "$EXISTING_ENV_ID" ]; then
  echo "    Updating existing environment: ${EXISTING_ENV_ID}"
  postman_api PUT "/environments/${EXISTING_ENV_ID}" \
    -d "$(jq -n --arg name "$ENV_NAME" --argjson values "$ENV_VALUES" \
      '{environment: {name: $name, values: $values}}')" > /dev/null
  ENV_ID="$EXISTING_ENV_ID"
else
  ENV_RESP=$(postman_api POST "/environments?workspace=${POSTMAN_WORKSPACE_ID}" \
    -d "$(jq -n --arg name "$ENV_NAME" --argjson values "$ENV_VALUES" \
      '{environment: {name: $name, values: $values}}')")
  ENV_ID=$(echo "$ENV_RESP" | jq -r '.environment.id')
  echo "    Created environment: ${ENV_ID}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================="
echo "  Sync complete"
echo "---------------------------------------------"
echo "  Phase 1 — Git → Spec Hub"
echo "    Spec ID:        ${SPEC_ID}"
echo "  Phase 2 — Spec Hub → Postman assets"
echo "    Collection UID: ${COLLECTION_UID}"
echo "    Environment ID: ${ENV_ID}"
echo "============================================="
