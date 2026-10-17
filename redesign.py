"""Generate the git-ignored public/data.js, public/reports-data.js, public/data-child.js and public/index.html.

Outputs are written to a temp file and moved into place atomically, so the running server never
serves a half-written file. Set BUILD_OUT_DIR to build into a staging directory instead of public/.
public/notes.js (HEALTH_NOTES, LOCKED_PDFS) is hand-maintained, git-ignored and never overwritten;
a neutral stub is created only if it is missing.

public/index.html is NOT tracked: it is rendered from the tracked templates/index.template.html plus
the git-ignored files in private/:
  members.json       household members (required; config/members.example.json)
  reports.json       report library of the lab-results member (optional; config/reports.example.json)
  overview.json      overview page text: takeaway cards, records summary, urgent-help and "About dates"
                     notes (optional; generic defaults are used when missing; config/overview.example.json)
  lab-values.json    lab results (optional; see plain_data.py)
  profiles/<id>/child-record.json   growth/check-up/vaccination record of each child member (optional;
                     config/child-record.example.json)
A malformed file fails the build with a "BUILD ERROR:" line naming it.
"""
from pathlib import Path
import json,os,subprocess,sys
R=Path(__file__).resolve().parent
MARKER='<!--REPORT_LIBRARY-->'
SLOTS=('takeaways','records_summary','urgent_help','about_dates')
SLOT_MARK={s:f'<!--SLOT:{s}-->' for s in SLOTS}
TEMPLATE=R/'templates/index.template.html'
OUT=R/'public/index.html'
REQUIRED_PRIVATE=('members.json',)
DEFAULT_OVERVIEW={
 'takeaways':[],
 'records_summary':'<span class="dot"></span> Your records<br><small>Not a live health assessment</small>',
 'urgent_help':'<summary>When symptoms need urgent attention</summary><p>Call your local emergency number for chest pain, trouble breathing, signs of a stroke, severe bleeding or sudden confusion. This app cannot alert anyone for you.</p>',
 'about_dates':'<summary>About dates, units and the original reports</summary><p>Values are shown with the units and reference ranges printed on each report. Ranges differ between laboratories.</p>'}
TAKEAWAY_HEAD='<div class="section-head"><div><p class="eyebrow">THE MAIN TAKEAWAYS</p><h2>Start with these</h2></div><span class="muted">Tap a result to explore it</span></div>'

def build_error(msg):raise SystemExit('BUILD ERROR: '+msg)

def load_private(name,default=None):
 p=R/'private'/name
 if default is not None and not p.is_file():return default
 try:return json.loads(p.read_text(encoding='utf-8'))
 except ValueError:build_error(f'private/{name} is not valid JSON')

def preflight():
 """Name every missing required private input at once, before anything is computed or written."""
 missing=[n for n in REQUIRED_PRIVATE if not (R/'private'/n).is_file()]
 if missing:
  build_error('missing required private file(s): '+', '.join('private/'+n for n in missing)+' (examples: config/*.example.json; see README.md)')

def check_overview(ov):
 """Validate the personal page slots; returns {slot: html}. Never reports slot content, only names."""
 if not isinstance(ov,dict):build_error('private/overview.json must be a JSON object')
 ov={**DEFAULT_OVERVIEW,**ov}
 extra=[k for k in ov if k not in SLOTS]
 if extra:build_error(f'private/overview.json has {len(extra)} unknown key(s); allowed slots: '+', '.join(SLOTS))
 cards=ov['takeaways']
 if not isinstance(cards,list) or not all(isinstance(c,str) and c.strip() for c in cards):
  build_error('private/overview.json slot "takeaways" must be a list of non-empty HTML strings')
 for s in SLOTS[1:]:
  if not isinstance(ov[s],str) or not ov[s].strip():build_error(f'private/overview.json slot "{s}" must be a non-empty HTML string')
 takeaways=TAKEAWAY_HEAD+'<div class="takeaways">'+''.join(cards)+'</div>' if cards else ''
 return {'takeaways':takeaways,**{s:ov[s] for s in SLOTS[1:]}}

def render_index(reports,overview,template=None):
 t=template if template is not None else TEMPLATE.read_text(encoding='utf-8')
 for m in (MARKER,*SLOT_MARK.values()):
  if t.count(m)!=1:raise SystemExit(f'{TEMPLATE.name} must contain exactly one {m}')
 slots=check_overview(overview)
 library=''.join(f'<a class="record" href="/records/{f}" target="_blank" rel="noopener"><span class="pdf">PDF</span><span><strong>{name}</strong><small>{date} · {pages}</small></span><span aria-hidden="true">↗</span></a>'for f,name,date,pages in reports)
 for s,html in slots.items():t=t.replace(SLOT_MARK[s],html)
 return t.replace(MARKER,library)

def tracked(path):
 """True if git tracks path. Any failure to find out raises: the caller must fail closed."""
 try:r=subprocess.run(['git','ls-files','--',str(path.relative_to(R))],cwd=R,capture_output=True,text=True)
 except OSError as e:raise SystemExit(f'Cannot verify that public/index.html is untracked (git unavailable: {e.__class__.__name__}). Refusing to build.')
 if r.returncode!=0:raise SystemExit('Cannot verify that public/index.html is untracked (git ls-files failed). Refusing to build.')
 return bool(r.stdout.strip())

def atomic_write(path,text):
 path=Path(path);tmp=path.with_name('.'+path.name+f'.{os.getpid()}.tmp')
 try:
  with open(tmp,'w',encoding='utf-8') as f:
   f.write(text);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
 finally:
  if tmp.exists():tmp.unlink()

NOTES_STUB='window.HEALTH_NOTES=window.HEALTH_NOTES||{};\nwindow.LOCKED_PDFS=window.LOCKED_PDFS||[];\n'

def child_records(members):
 """{member id: record} for child members that have private/profiles/<id>/child-record.json."""
 out={}
 for m in members:
  if m.get('kind')!='child':continue
  p=R/'private/profiles'/m['id']/'child-record.json'
  if not p.is_file():continue
  try:rec=json.loads(p.read_text(encoding='utf-8'))
  except ValueError:build_error(f'private/profiles/{m["id"]}/child-record.json is not valid JSON')
  if not isinstance(rec,dict):build_error(f'private/profiles/{m["id"]}/child-record.json must be a JSON object')
  out[m['id']]=rec
 return out

def load_members():
 ms=load_private('members.json')
 import re
 if not isinstance(ms,list) or not ms or not all(isinstance(m,dict) and isinstance(m.get('id'),str) and re.fullmatch(r'[a-z][a-z0-9-]{0,31}',m['id']) for m in ms):
  build_error('private/members.json must be a non-empty list of members with valid ids (see config/members.example.json)')
 return ms

def main():
 if tracked(OUT):raise SystemExit('Refusing to write public/index.html: it is tracked by git. It must stay untracked (see AGENTS.md).')
 preflight()
 out=Path(os.environ.get('BUILD_OUT_DIR') or R/'public');out.mkdir(parents=True,exist_ok=True)
 from plain_data import make,data_js
 members=load_members()
 reports=[tuple(r) for r in load_private('reports.json',[])]  # [[file,name,date,pages],...]
 overview=load_private('overview.json',{})
 try:data=make(R)
 except ValueError as e:build_error(str(e))
 outputs={ # everything is computed and validated before anything is published
  'data.js':data_js(data),
  'data-child.js':'window.CHILD_RECORDS='+json.dumps(child_records(members),ensure_ascii=False).replace('<','\\u003c')+';',
  'reports-data.js':'window.REPORTS='+json.dumps([{'file':f,'name':n,'date':d,'pages':pg} for f,n,d,pg in reports])+';',
  'index.html':render_index(reports,overview)}
 for name,text in outputs.items():atomic_write(out/name,text)
 notes=R/'public/notes.js'
 if out==R/'public' and not notes.exists():
  atomic_write(notes,NOTES_STUB);print('NOTE: created an empty public/notes.js. Put personal result notes there (template: config/notes.example.js).')
 print(f'Built {len(data)} measurements, {len(reports)} reports, {len(outputs)} files.')

if __name__=='__main__':main()
