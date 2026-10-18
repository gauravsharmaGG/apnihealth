"""Build the plain-English health dashboard from verified source data."""
import os,shutil,subprocess,sys
import redesign
redesign.main()

# Report-reading assets (pinned and sha256-checked; cached after the first download). Not fatal: without them the
# app works and simply doesn't offer "Read values". APNI_OCR_ASSETS=skip turns it off (offline builds, tests).
if os.environ.get('APNI_OCR_ASSETS')!='skip':
    node=shutil.which('node')
    ok=bool(node) and subprocess.run([node,'scripts/vendor-ocr.mjs'],cwd=os.path.dirname(os.path.abspath(__file__))).returncode==0
    if not ok:print('Warning: report-reading assets not installed (needs Node and the npm registry once): node scripts/vendor-ocr.mjs',file=sys.stderr)
