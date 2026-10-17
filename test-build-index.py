"""index.html rendering: the template holds no personal data; the report library, overview slots and child
records are injected only at build time; a missing members file or malformed input fails the build loudly."""
import json,os,re,subprocess,sys,tempfile,types
from pathlib import Path
import redesign
t=redesign.TEMPLATE.read_text(encoding='utf-8')
CFG=redesign.R/'config'
OV=json.loads((CFG/'overview.example.json').read_text())
assert t.count(redesign.MARKER)==1,'template needs exactly one marker'
for s,m in redesign.SLOT_MARK.items():assert t.count(m)==1,f'template needs exactly one slot marker for {s}'
assert 'class="record"' not in t and 'href="/records/' not in t and '.pdf' not in t,'template must not contain report links'
empty=redesign.render_index([],OV)
assert redesign.MARKER not in empty and '<div class="records"></div>' in empty and '<!--SLOT:' not in empty
out=redesign.render_index([('example-a.pdf','Example A','2026-01-01','2 pages')],OV)
assert out.count('href="/records/example-a.pdf"')==1 and 'Example A' in out and redesign.MARKER not in out
assert re.sub(r'<a class="record".*?</a>','',out,count=1)==empty,'only the library may differ from the empty render'
for card in OV['takeaways']:assert card in empty
for s in redesign.SLOTS[1:]:assert OV[s] in empty
assert empty.count('class="takeaway"')==len(OV['takeaways']) and 'THE MAIN TAKEAWAYS' in empty
# overview.json is optional: generic defaults fill every slot, and no takeaway section is rendered without cards
gen=redesign.render_index([],{})
assert '<!--SLOT:' not in gen and 'THE MAIN TAKEAWAYS' not in gen and redesign.DEFAULT_OVERVIEW['urgent_help'] in gen
def fails(fn,*needles):
 try:fn()
 except SystemExit as e:
  assert all(n in str(e) for n in needles),(needles,str(e));return
 sys.exit(f'expected a failure containing {needles}')
fails(lambda:redesign.render_index([],OV,template='<p>no marker</p>'),'exactly one')
for s,m in redesign.SLOT_MARK.items():fails(lambda:redesign.render_index([],OV,template=t.replace(m,'')),'exactly one',m)
# an empty text slot or a malformed takeaway list fails by name
for s in redesign.SLOTS[1:]:fails(lambda:redesign.render_index([],{**OV,s:''}),s,'non-empty')
fails(lambda:redesign.render_index([],{**OV,'takeaways':'x'}),'takeaways')
fails(lambda:redesign.render_index([],{**OV,'takeaways':['ok','']}),'takeaways')
fails(lambda:redesign.render_index([],{**OV,'extra':'x'}),'unknown key')
fails(lambda:redesign.render_index([],[]),'JSON object')
assert t.index('/notes.js')<t.index('/app.js'),'notes.js must load before app.js'

real=subprocess.run
def fake(rc=0,out='',exc=None):
 def run(*a,**k):
  if exc:raise exc
  return types.SimpleNamespace(returncode=rc,stdout=out)
 return run
try:
 subprocess.run=fake(out='')
 assert redesign.tracked(redesign.OUT) is False
 subprocess.run=fake(out='public/index.html\n')
 assert redesign.tracked(redesign.OUT) is True
 for bad in (fake(exc=FileNotFoundError('git')),fake(rc=128),fake(rc=1)):
  subprocess.run=bad
  fails(lambda:redesign.tracked(redesign.OUT),'Cannot verify')
  fails(redesign.main,'Cannot verify')
 subprocess.run=fake(out='public/index.html\n')
 fails(redesign.main,'tracked by git')
finally:subprocess.run=real
assert redesign.tracked(redesign.OUT) is False,'real git check on this repo'

def private_dir(root,**over):
 """A scratch repo root with the private inputs present (examples as content)."""
 (root/'private').mkdir(parents=True,exist_ok=True);(root/'public').mkdir(exist_ok=True)
 files={'reports.json':json.loads((CFG/'reports.example.json').read_text()),'overview.json':OV}
 files.update(over)
 for n,v in files.items():
  if v is not None:(root/'private'/n).write_text(v if isinstance(v,str) else json.dumps(v))
 return root
def in_root(root,fn):
 realR,realOUT=redesign.R,redesign.OUT;redesign.R=root;redesign.OUT=root/'public/index.html';subprocess.run=fake(out='')
 try:return fn()
 finally:subprocess.run=real;redesign.R=realR;redesign.OUT=realOUT

# staging build writes exactly the generated files and never a notes.js
root=private_dir(Path(tempfile.mkdtemp()));stage=tempfile.mkdtemp();os.environ['BUILD_OUT_DIR']=stage
try:in_root(root,redesign.main)
finally:del os.environ['BUILD_OUT_DIR']
assert sorted(os.listdir(stage))==['data-child.js','index.html','reports-data.js'],'staging build writes exactly the generated files, no temp leftovers, no notes.js'
assert open(stage+'/index.html',encoding='utf-8').read()==redesign.render_index([tuple(r) for r in json.loads((CFG/'reports.example.json').read_text())],OV)
# a notes.js that already exists is never overwritten; a missing one is stubbed
def twice():
 redesign.main();assert (root/'public/notes.js').read_text()==redesign.NOTES_STUB
 (root/'public/notes.js').write_text('window.HEALTH_NOTES={"X":"kept"};');redesign.main()
 assert 'kept' in (root/'public/notes.js').read_text(),'existing notes.js must never be overwritten'
in_root(root,twice)
d=tempfile.mkdtemp();f=os.path.join(d,'x.js');redesign.atomic_write(f,'a');redesign.atomic_write(f,'b')
assert open(f).read()=='b' and os.listdir(d)==['x.js']

OUTS=('data-child.js','reports-data.js','index.html')
def old_outputs(r):
 for n in OUTS:(r/'public'/n).write_text('OLD')
def untouched(r):return all((r/'public'/n).read_text()=='OLD' for n in OUTS)
# child records: one per member folder that has the file (valid ids only); a malformed record fails by member id
r=private_dir(Path(tempfile.mkdtemp()));(r/'private/profiles/mia').mkdir(parents=True);(r/'private/profiles/sam').mkdir(parents=True);(r/'private/profiles/Bad Id').mkdir(parents=True)
(r/'private/profiles/mia/child-record.json').write_text((CFG/'child-record.example.json').read_text())
(r/'private/profiles/Bad Id/child-record.json').write_text('{"ignored":true}')
in_root(r,redesign.main);js=(r/'public/data-child.js').read_text()
assert js.startswith('window.CHILD_RECORDS=') and json.loads(js[len('window.CHILD_RECORDS='):-1]).keys()=={'mia'}
(r/'private/profiles/mia/child-record.json').write_text('{ bad');old_outputs(r)
try:in_root(r,redesign.main);sys.exit('a malformed child record must fail')
except SystemExit as e:assert 'BUILD ERROR:' in str(e) and 'profiles/mia/child-record.json' in str(e)
assert untouched(r)
# optional inputs may be missing
r=private_dir(Path(tempfile.mkdtemp()),**{'reports.json':None,'overview.json':None});in_root(r,redesign.main)
assert (r/'public/reports-data.js').read_text()=='window.REPORTS=[];'
# no private inputs at all: the build still works with generic defaults (members live in the database)
assert redesign.REQUIRED_PRIVATE==()
r=Path(tempfile.mkdtemp());(r/'public').mkdir();in_root(r,redesign.main)
assert (r/'public/data-child.js').read_text()=='window.CHILD_RECORDS={};'
# malformed JSON and incomplete overview fail without publishing anything
for over,needle in (({'reports.json':'{ malformed'},'reports.json is not valid JSON'),({'overview.json':{**OV,'urgent_help':' '}},'urgent_help')):
 r=private_dir(Path(tempfile.mkdtemp()),**over);old_outputs(r)
 try:in_root(r,redesign.main);sys.exit('bad input must fail the build')
 except SystemExit as e:assert 'BUILD ERROR:' in str(e) and needle in str(e),str(e)
 assert untouched(r)
print('PASS: template has no personal data; library, overview slots and child records injected at build time; bad inputs fail loudly.')
