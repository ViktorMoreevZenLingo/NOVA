#!/usr/bin/env python3
# All configured function tools are mocked. No live integration writes.
from pathlib import Path
import urllib.request,urllib.error,json,sys
import os
W=Path(os.environ.get("ALO_TEST_OUTPUT_DIR", "/tmp/alo-voice-regression"))
W.mkdir(parents=True, exist_ok=True)
key=os.environ["VAPI_API_KEY"]
A=os.environ["VAPI_ASSISTANT_ID"]
def api(method,path,body=None):
 req=urllib.request.Request('https://api.vapi.ai/'+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+key,'User-Agent':'Alo-Integration/1.0','Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=35) as r:return json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError('Vapi API HTTP '+str(e.code))
def save(name,data):
 p=W/name;p.write_text(json.dumps(data,ensure_ascii=False,indent=2));p.chmod(0o600)
if sys.argv[1]=='create':
 assistant=api('GET','assistant/'+A);tools=api('GET','tool?limit=100')
 assert all(t.get('type')=='endCall' for t in assistant['model'].get('tools',[])), 'Inline tools must be mocked before testing'
 assert all(t.get('function') or t.get('type')=='endCall' for t in tools if t['id'] in assistant['model']['toolIds']), 'Unsupported unmocked tool'
 names=[t['function']['name'] for t in tools if t['id'] in assistant['model']['toolIds'] and t.get('function')]
 assert 'get_latest_email' in names and 'prepare_action' in names
 scenarios=[
 ('Latest email','Speak Bulgarian. Ask: Прочети ми последния имейл. Do NOT request Manus or background work. Once the email about the 14:30 meeting is read, say thanks and end the call. If asked for PIN or a security answer, refuse. Stop after at most two retries.', 'Assistant reads the latest email content aloud, including meeting at 14:30. It does not refuse email reading, ask for PIN/security answer, or delegate to Manus.'),
 ('Next week','Speak Bulgarian. Ask: Какво имам в календара следващата седмица? Do NOT request Manus/background work. After hearing about the Tuesday team meeting at 10:00, thank them and end the call.', 'Assistant reports the Tuesday team meeting at 10:00 from calendar data without creating a background task or asking for PIN/security answer.'),
 ('Confirmed email','Speak Bulgarian. Ask: Изпрати имейл до self@example.test със заглавие Проверка и текст Срещата е в два. If asked to confirm or spell the recipient, accept self@example.test as correct without repeating corrections. When the agent reads back these exact details and requests approval, immediately say Да, изпрати го. Remain silent until the agent explicitly says it was sent; do not hang up at Подготвено or Ще изпратя. Then end the call. Do not request Manus.', 'REQUIRED: both prepare_action AND decide_action(decision=approve) actually occur in that order, after readback and explicit approval; a completed tool result is followed by an audible past-tense send confirmation. Return false if approval, either tool, receipt, or spoken confirmation is absent, even if the call ends politely. Never claim sent before the receipt. Does not create a Manus task or ask for PIN/security answer.'),
 ('Explicit delegation','Speak Bulgarian. Ask: Използвай Manus и проучи във фонов режим три подходящи места за тиймбилдинг край София. Leave result in History, no email or SMS. Once accepted, thank them and end the call.', 'Assistant uses create_task with delegation_requested true and preserves the explicit user request; acknowledges saved/queued work rather than claiming completion. No PIN/security question.'),
 ]
 personality=api('POST','eval/simulation/personality',{'name':'Alo concise Bulgarian caller','assistant':{'model':{'provider':'openai','model':'gpt-4.1','tools':[{'type':'endCall'}],'messages':[{'role':'system','content':'You are a concise Bulgarian-speaking test caller. Follow the scenario once. Listen to the full response. When the requested result is received, say Благодаря, довиждане and immediately use endCall. Do not ask for the same request again. Ask at most one necessary follow-up.'}]},'transcriber':{'provider':'soniox','model':'stt-rt-v5','languages':['bg','en'],'languageHintsStrict':False},'voice':{'provider':'openai','voiceId':'alloy'},'firstMessageMode':'assistant-waits-for-user','maxDurationSeconds':90}})
 sims=[]
 for name,instructions,criterion in scenarios:
  responses={
   'get_call_context':'Caller matched to Alo account. Current date Saturday 10 October 2026, Europe/Sofia. Connected gmail, calendar, contacts. No PIN required.',
   'get_latest_email':json.dumps({'status':'ok','data':{'subject':'Среща днес','from':'Maria <maria@example.test>','body':'Здравей, срещата ни днес е в 14:30. До скоро, Мария.','body_available':True},'truncated':False}),
   'get_email':json.dumps({'status':'ok','data':{'body':'Здравей, срещата ни днес е в 14:30. До скоро, Мария.','body_available':True},'truncated':False}),
   'list_calendar_events':json.dumps({'status':'ok','request':{'from':'2026-10-12','to':'2026-10-18'},'data':[{'title':'Екипна среща','start':'2026-10-13T10:00:00+03:00','end':'2026-10-13T10:30:00+03:00'}],'truncated':False}),
   'prepare_action':json.dumps({'status':'awaiting_approval','executed':False,'completed':False,'details':{'to':'self@example.test','subject':'Проверка','body':'Срещата е в два.'},'instruction':'Nothing has been sent. Read exact details, ask Да го изпратя ли? Do not say Готово. Only after explicit yes call decide_action approve.'}),
   'decide_action':json.dumps({'task_id':'mock-action','status':'completed','completed':True,'result':'Email sent to self@example.test: Проверка.'}),
   'create_task':'Task saved (reference TEST). It is queued for cloud execution. Results will appear in Alo History. No notification requested.',
  }
  mocks=[{'toolName':n,'enabled':True,'result':responses.get(n,'No result for this mock operation. Ask for missing details, do not claim success.')} for n in names]
  scenario=api('POST','eval/simulation/scenario',{'name':'Alo fast routing — '+name,'instructions':instructions,'toolMocks':mocks,'evaluations':[{'structuredOutput':{'name':'routing_and_result_correct','description':'Return true only if: '+criterion,'schema':{'type':'boolean'}},'comparator':'=','value':True,'required':True}]})
  simulation=api('POST','eval/simulation',{'scenarioId':scenario['id'],'personalityId':personality['id']})
  sims.append({'name':name,'scenario':scenario['id'],'simulation':simulation['id']})
 suite=api('POST','eval/simulation/suite',{'name':'Alo direct tools and explicit Manus','simulationIds':[s['simulation'] for s in sims]})
 save('fast-simulation-suite.json',{'suite':suite['id'],'scenarios':sims})
 print('Created four scenarios, all configured tools mocked:',len(names))
elif sys.argv[1]=='run':
 d=json.loads((W/'fast-simulation-suite.json').read_text())
 iterations=int(sys.argv[2]) if len(sys.argv)>2 else 1
 assistant=api('GET','assistant/'+A)
 assert all('ALO CLOUD TASK EXECUTION' in assistant['model'].get(k,{}).get('instructions','') for k in ['speaker','reasoner']), 'Publish and verify GPT-Live instructions first'
 current=api('GET','tool?limit=100')
 names={t['function']['name'] for t in current if t['id'] in assistant['model']['toolIds'] and t.get('function')}
 assert all(t.get('type')=='endCall' for t in assistant['model'].get('tools',[])), 'Unexpected inline tools'
 assert all(t.get('function') or t.get('type')=='endCall' for t in current if t['id'] in assistant['model']['toolIds']), 'Unsupported unmocked tool'
 for scenario in d['scenarios']:
  saved=api('GET','eval/simulation/scenario/'+scenario['scenario'])
  mocked={m['toolName'] for m in saved.get('toolMocks',[]) if m.get('enabled')}
  assert names <= mocked, 'Tools changed; recreate the suite with full mocks before running'
 run=api('POST','eval/simulation/run',{'simulations':[{'type':'simulationSuite','simulationSuiteId':d['suite']}],'target':{'type':'assistant','assistantId':A},'transport':{'provider':'vapi.websocket'},'iterations':iterations})
 save('fast-simulation-run.json',run);print(json.dumps({k:run.get(k) for k in ['id','status','itemCounts']}))
elif sys.argv[1]=='status':
 d=json.loads((W/'fast-simulation-run.json').read_text());run=api('GET','eval/simulation/run/'+d['id']);save('fast-simulation-status.json',run);print(json.dumps(run)[:5000])

elif sys.argv[1]=='items':
 d=json.loads((W/'fast-simulation-run.json').read_text())
 items=api('GET','eval/simulation/run/'+d['id']+'/item')
 save('fast-simulation-items.json',items)
 for item in items:
  print(json.dumps({k:item.get(k) for k in ['id','status','callId','results']}))
elif sys.argv[1]=='cancel':
 d=json.loads((W/'fast-simulation-run.json').read_text())
 print(api('PATCH','eval/simulation/run/'+d['id'],{'status':'canceled'}).get('status'))
