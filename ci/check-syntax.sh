#!/usr/bin/env bash
# Syntax-only checks of every tracked source file (no app code is executed, no data needed).
set -u
cd "$(git rev-parse --show-toplevel)"
fail=0
n=0
check() { # file, command...
  local f=$1; shift
  n=$((n+1))
  if ! "$@" > /dev/null 2>&1 < /dev/null; then echo "::error file=$f::syntax error in $f"; fail=1; fi
}
while IFS= read -r f; do
  case "$f" in
    *.mjs) check "$f" node --check "$f" ;;
    *.cjs|*.js) check "$f" node --check "$f" ;;
    *.py) check "$f" python3 -c 'import sys;compile(open(sys.argv[1],encoding="utf-8").read(),"x","exec")' "$f" ;;
    *.json|*.webmanifest) check "$f" python3 -m json.tool "$f" ;;
    *.sh) check "$f" bash -n "$f" ;;
  esac
done < <(git ls-files)
if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: syntax checks passed ($n files)"
