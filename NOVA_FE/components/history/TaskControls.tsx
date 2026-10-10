"use client";
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n-context';
import { taskRequest, type DelegatedTask } from '@/lib/tasks-api';
export function TaskControls({id,onUpdated}:{id:string;onUpdated:()=>void}) {
  const {lang}=useI18n();const l=(bg:string,en:string)=>lang==='bg'?bg:en;
  const [task,setTask]=useState<DelegatedTask|null>(null),[answer,setAnswer]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let live=true;setTask(null);setError('');
    const load=()=>taskRequest('get',id).then(t=>{if(live)setTask(t);}).catch(e=>{if(live)setError(e.message);});
    void load();const timer=setInterval(load,5000);return()=>{live=false;clearInterval(timer);};
  },[id]);
  const act=async(action:string)=>{
    if(!task)return;setBusy(true);setError('');
    try{setTask(await taskRequest(action,id,{revision:task.revision,...(action==='respond'?{answer:answer.trim()||'The connection is ready. Continue.'}:{})}));setAnswer('');onUpdated();}
    catch(e){setError(e instanceof Error?e.message:'Please try again.');}
    finally{setBusy(false);}
  };
  const pending=task?.pending;
  return <div className="task-controls" aria-busy={busy}>
    {task?.run_at&&<p>{l('Насрочена за','Scheduled for')} {new Intl.DateTimeFormat(lang==='bg'?'bg-BG':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:task.timezone}).format(new Date(task.run_at))} · {task.timezone}</p>}
    {task?.error&&<p role="status">{task.error}</p>}
    {pending&&<div className="task-response">
      <p>{pending.question}</p>
      {pending.kind==='approval'?<>
        <dl>{Object.entries(pending.args||{}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{Array.isArray(v)?v.join(', '):String(v)}</dd></div>)}</dl>
        <button className="primary options-button" disabled={busy} onClick={()=>act('approve')}>{l('Одобри действието','Approve action')}</button>
      </>:pending.kind==='connection'?<button className="primary options-button" disabled={busy} onClick={()=>act('respond')}>{l('Продължи след свързване','Continue after connecting')}</button>
      :pending.kind!=='uncertain'?<form onSubmit={e=>{e.preventDefault();void act('respond');}}>
        <label htmlFor="task-answer">{l('Твоят отговор','Your answer')}</label>
        <textarea id="task-answer" maxLength={4000} value={answer} onChange={e=>setAnswer(e.target.value)} required />
        <button className="primary options-button" disabled={busy||!answer.trim()}>{l('Продължи','Continue')}</button>
      </form>:null}
    </div>}
    {task&&!['completed','cancelled','failed'].includes(task.status)&&<button className="secondary" disabled={busy} onClick={()=>act('cancel')}>{l('Отмени задачата','Cancel task')}</button>}
    {task?.deliveries?.map(d=><p key={d.channel}>{d.channel}: {d.status}{d.error?` — ${d.error}`:''}</p>)}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
