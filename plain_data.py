"""Build the lab-result explorer data (window.HEALTH_DATA) from private/lab-values.json.

Marker names are resolved through a generic catalog: config/markers.default.json, merged with the
optional, git-ignored private/markers.json (same shape). Each catalog entry has an English display
name, a body-system group, a plain-language meaning and aliases. A report value matches an entry by
its name or any alias, case-insensitively, so a lab's own names (in any language) only need an alias.

private/lab-values.json is a list of dated reports (see config/lab-values.example.json):
  {"file", "iso", "reported"?, "preliminary"?, "screening"?,
   "values": [{"name", "value", "unit"?, "reference"?, "page"?}], "pending"?: [{"name", "note"?}]}
A value may end in " ↑" / " ↓" to mark it above / below the report's range. Unknown marker names
fail the build with the name only (never the value). A missing lab-values.json means no lab data.
"""
from pathlib import Path
import json,re
R=Path(__file__).resolve().parent

def _read(path):
 try:return json.loads(path.read_text(encoding='utf-8'))
 except ValueError:raise ValueError(f'{path.name} is not valid JSON')

def catalog(root=None):
 """-> {lowercased name or alias: (name, group, meaning)}"""
 root=root or R
 entries={}
 for path in (root/'config/markers.default.json',root/'private/markers.json'):
  if not path.is_file():continue
  data=_read(path)
  for m in data.get('markers',[]) if isinstance(data,dict) else []:
   if not isinstance(m,dict) or not isinstance(m.get('name'),str) or not m['name'].strip():raise ValueError(f'{path.name}: every marker needs a "name"')
   old=entries.get(m['name'],{})
   entries[m['name']]={'name':m['name'],'group':m.get('group',old.get('group','Other')),'meaning':m.get('meaning',old.get('meaning','')),
                       'aliases':list(dict.fromkeys(old.get('aliases',[])+[a for a in m.get('aliases',[]) if isinstance(a,str)]))}
 index={}
 for e in entries.values():
  for key in [e['name'],*e['aliases']]:index[key.strip().lower()]=(e['name'],e['group'],e['meaning'])
 return index

def number(v):
 m=re.search(r'-?\d+(?:\.\d+)?',str(v))
 if not m:raise ValueError('a lab value has no number')
 return float(m[0])

def make_with_pending(root=None):
 """-> (measurements, pending). Pending results have no number yet, so they are listed apart from the plotted points."""
 root=root or R
 path=root/'private/lab-values.json'
 if not path.is_file():return [],[]
 reports=_read(path)
 if not isinstance(reports,list):raise ValueError('lab-values.json must be a list of reports')
 cat=catalog(root)
 def lookup(name,where):
  d=cat.get(str(name).strip().lower())
  if not d:raise ValueError(f'lab-values.json: unknown marker name {name!r} in {where}; add it (or an alias) to private/markers.json')
  return d
 items={};pending=[]
 def add(alias,definition,point):
  name,group,meaning=definition
  if name not in items:items[name]=dict(id='m'+str(len(items)),name=name,group=group,meaning=meaning,aliases=[],points=[])
  m=items[name]
  if alias!=name and alias not in m['aliases']:m['aliases'].append(alias)
  m['points'].append(point)
 for i,r in enumerate(reports):
  where=f'entry {i}'
  if not(isinstance(r,dict) and isinstance(r.get('iso'),str) and isinstance(r.get('values'),list)):
   raise ValueError(f'lab-values.json: {where} needs "iso" (YYYY-MM-DD) and a "values" list')
  prelim=bool(r.get('preliminary'));screening=bool(r.get('screening'))
  if screening:note='Screening result; methods and testing conditions can differ.'
  else:note=('Preliminary result; it may change when the final report is issued. ' if prelim else '')+'Reference interval from this report. It is not a diagnosis or a personalized treatment target.'
  for v in r['values']:
   val=str(v['value']);d=lookup(v['name'],where);clean=val.replace(' ↑','').replace(' ↓','')
   unit=v.get('unit') or re.sub(r'^-?[\d.]+\s*','',clean)
   pt=dict(date=r['iso'],value=clean,n=number(val),unit=unit,source=r.get('file'),page=v.get('page',1),
           status='screening' if screening else 'high' if '↑' in val else 'low' if '↓' in val else 'range',
           range=None if screening else v.get('reference'),inferred=False,note=note)
   if prelim:pt['preliminary']=True
   if r.get('reported'):pt['reported']=r['reported']
   add(v['name'],d,pt)
  for q in r.get('pending') or []:
   name,group,meaning=lookup(q['name'],where)
   pending.append(dict(name=name,group=group,meaning=meaning,alias=q['name'],date=r['iso'],source=r.get('file'),note=q.get('note') or 'Result pending.'))
 for m in items.values():
  m['points'].sort(key=lambda p:p['date'])
  for p in m['points']:
   # Standardize display so units appear exactly once.
   p['display']=p['value'] if any(c.isalpha() for c in p['value']) or '%' in p['value'] or not p['unit'] else p['value']+' '+p['unit']
  m['latest']=m['points'][-1]
 if 'Iron circulating in blood' in items and 'Ferritin: iron stores' not in items:
  items['Iron circulating in blood']['meaning']+=' No ferritin result was supplied.'
 return list(items.values()),pending

def make(root=None):return make_with_pending(root)[0]

def data_js(data):
 """data.js holds only window.HEALTH_DATA."""
 return 'window.HEALTH_DATA='+json.dumps(data,ensure_ascii=False)+';'

if __name__=='__main__':
 data=make();(R/'public/data.js').write_text(data_js(data))
 print(len(data),'measurements with definitions')
