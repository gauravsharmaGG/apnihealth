"""plain_data: dated reports, screening reports, pending results, catalog aliases and overrides, unknown markers (fictional data only)."""
import json,tempfile,shutil
from pathlib import Path
import plain_data as P
REPO=Path(__file__).resolve().parent
NEW=dict(file='example-labs-d.pdf',iso='2000-04-01',reported='2000-04-02',preliminary=True,values=[dict(name='eGFR',value='85',unit='mL/min/1.73m²',reference='>60',page=3),dict(name='Sodium',value='131 mmol/L ↓',unit='mmol/L',reference='135-145',page=1),dict(name='Ferritin',value='45 ng/mL',unit='ng/mL',reference='30-300',page=1)],pending=[dict(name='Soluble transferrin receptor (sTfR)')])
OLD=dict(file='example-labs-a.pdf',iso='2000-02-01',values=[dict(name='egfr',value='90',unit='mL/min/1.73m²',reference='>60',page=2),dict(name='Iron',value='80',unit='µg/dL',reference='60-160')])
SCREEN=dict(file='example-checkup.pdf',iso='2000-01-15',screening=True,values=[dict(name='Resting HR',value='62 bpm',page=2)])
def run(labs,markers=None):
 root=Path(tempfile.mkdtemp());(root/'private').mkdir();(root/'config').mkdir()
 shutil.copy(REPO/'config/markers.default.json',root/'config/markers.default.json')
 if labs is not None:(root/'private/lab-values.json').write_text(json.dumps(labs))
 if markers is not None:(root/'private/markers.json').write_text(json.dumps(markers))
 try:return P.make_with_pending(root)
 finally:shutil.rmtree(root)
by=lambda d,n:next(m for m in d if m['name']==n)
# no lab file: no data, no error
assert run(None)==([],[])
# one dated report
d,pend=run([NEW]);e=by(d,'Estimated kidney filtering ability')['points'][0]
assert (e['unit'],e['source'],e['page'])==('mL/min/1.73m²','example-labs-d.pdf',3) and e['preliminary'] and 'Preliminary' in e['note']
assert by(d,'Sodium')['latest']['status']=='low' and by(d,'Sodium')['latest']['value']=='131 mmol/L'
assert [(p['name'],p['date']) for p in pend]==[('Soluble transferrin receptor (sTfR)','2000-04-01')]
assert not any('transferrin receptor' in m['name'].lower() for m in d),'pending values are never plotted'
js=P.data_js(d);assert js.startswith('window.HEALTH_DATA=') and 'HEALTH_PENDING' not in js
# several reports merge by marker (aliases match case-insensitively); screening values carry no lab range
d,pend=run([NEW,OLD,SCREEN]);e=by(d,'Estimated kidney filtering ability')
assert [p['date'] for p in e['points']]==['2000-02-01','2000-04-01'] and 'egfr' in e['aliases']
hr=by(d,'Resting heart rate')['latest'];assert hr['status']=='screening' and hr['range'] is None and hr['unit']=='bpm' and hr['display']=='62 bpm'
assert 'ferritin' not in by(d,'Iron circulating in blood')['meaning'].lower()
d,_=run([OLD]);assert 'No ferritin result was supplied' in by(d,'Iron circulating in blood')['meaning']
# private/markers.json adds aliases (any language) and new markers
d,_=run([dict(OLD,values=[dict(name='Ferritin (Serum)',value='50',unit='ng/mL'),dict(name='EXM',value='3',unit='u')])],
        {'markers':[{'name':'Ferritin: iron stores','aliases':['Ferritin (serum)']},{'name':'Example marker','group':'Other','meaning':'Fictional.','aliases':['EXM']}]})
assert by(d,'Ferritin: iron stores')['latest']['n']==50 and by(d,'Example marker')['group']=='Other'
# unknown marker: clear error naming the marker, never the value
for bad in ([dict(NEW,values=[dict(name='Mystery marker',value='123.456',unit='u',reference='',page=1)])],[dict(NEW,pending=[dict(name='Mystery marker')])]):
 try:run(bad);raise SystemExit('expected ValueError')
 except ValueError as x:assert 'Mystery marker' in str(x) and '123.456' not in str(x)
for bad in ([{'foo':1}],{'not':'a list'}):
 try:run(bad);raise SystemExit('expected ValueError')
 except ValueError:pass
# the default catalog has no duplicate names or aliases
cat=json.loads((REPO/'config/markers.default.json').read_text())['markers'];keys=[k.lower() for m in cat for k in [m['name'],*m['aliases']]]
assert len(keys)==len(set(keys)),'duplicate marker name or alias in config/markers.default.json'
print('ok test-lab-values')
