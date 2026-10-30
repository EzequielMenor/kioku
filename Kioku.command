#!/bin/bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
exec "$project_dir/scripts/kioku-local.sh" open
