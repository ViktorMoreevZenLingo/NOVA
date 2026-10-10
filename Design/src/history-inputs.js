import { getLanguage } from './i18n.js';
const l = (bg,en) => getLanguage()==='bg'?bg:en;
const chevron = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
let cleanup;
export function enhanceHistoryInputs(root) {
 cleanup?.abort(); cleanup=new AbortController();
 const closers=[];
 function wire(wrapper,trigger,panel,onOpen) {
  panel.setAttribute('popover','manual');
  const close=()=>{if(panel.matches(':popover-open')) panel.hidePopover();panel.hidden=true;trigger.setAttribute('aria-expanded','false');wrapper.classList.remove('is-open');};
  const positionPanel = () => {
    if (panel.hidden) return;
    const r = trigger.getBoundingClientRect();
    const calendar = panel.classList.contains('crafted-calendar');
    const parent = wrapper.closest('.history-popover').getBoundingClientRect();
    const w = Math.min(calendar ? parent.width : r.width, innerWidth-24);
    panel.style.width = w+'px';
    const left = calendar ? parent.left + (parent.width-w)/2 : r.left;
    panel.style.left = Math.max(12,Math.min(left,innerWidth-w-12))+'px';
    panel.style.maxHeight = calendar ? 'none' : Math.min(360,innerHeight-24)+'px';
    const h = panel.getBoundingClientRect().height;
    panel.style.top = Math.max(12,Math.min(r.bottom+6,innerHeight-h-12))+'px';
  };
  window.addEventListener('resize', positionPanel, {signal:cleanup.signal});
  closers.push(close);
  trigger.onclick=()=>{const open=panel.hidden;closers.forEach(fn=>fn());if(open){panel.hidden=false;trigger.setAttribute('aria-expanded','true');wrapper.classList.add('is-open');panel.showPopover();onOpen?.();positionPanel();}};
  wrapper.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopPropagation();close();trigger.focus();}});
  document.addEventListener('pointerdown',e=>{if(!wrapper.contains(e.target))close();},{signal:cleanup.signal});
  wrapper.closest('[popover]')?.addEventListener('toggle',e=>{if(e.newState==='closed')close();});
  return close;
 }
 root.querySelectorAll('.history-popover select').forEach(select=>{
  select.hidden=true;
  const label=select.getAttribute('aria-label');
  const wrapper=document.createElement('div');wrapper.className='crafted-select';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='crafted-trigger';trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');menu.className='crafted-menu';menu.hidden=true;menu.id=select.id+'-choices';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);trigger.setAttribute('aria-controls',menu.id);
  select.after(wrapper);wrapper.append(trigger,menu);
  const choices=Array.from(select.options);
  function paint(){trigger.innerHTML=`<span></span>${chevron}`;trigger.firstChild.textContent=select.selectedOptions[0].textContent;if(select.id==='period-filter' && select.value==='custom'){const a=root.querySelector('#history-from')?.value,b=root.querySelector('#history-to')?.value;if(a&&b){const fmt=v=>new Intl.DateTimeFormat(getLanguage() === "en" ? "en-GB" : "bg-BG",{day:'numeric',month:'short',year:'numeric'}).format(new Date(v+'T12:00:00'));trigger.firstChild.textContent=fmt(a)+' – '+fmt(b);trigger.title=trigger.firstChild.textContent;}}trigger.setAttribute('aria-label',label+': '+trigger.firstChild.textContent);menu.querySelectorAll('button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.value===select.value)));}
  const close=wire(wrapper,trigger,menu,()=>menu.querySelector('[aria-selected=true]')?.focus());
  choices.forEach(option=>{const b=document.createElement('button');b.type='button';b.role='option';b.tabIndex=-1;b.dataset.value=option.value;b.textContent=option.textContent;b.onclick=()=>{select.value=option.value;paint();select.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();if(select.id==='period-filter' && option.value==='custom') wrapper.querySelector('.calendar-shortcut').click();};menu.append(b);});
  trigger.onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();if(menu.hidden)trigger.click();}};
  menu.onkeydown=e=>{const buttons=[...menu.children];let i=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[i].focus();}else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){const b=buttons.find(b=>b.textContent.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));b?.focus();}else if(e.key==='Tab')close();};
  paint();
  if (select.id === 'period-filter') {
    wrapper.classList.add('with-calendar');
    const calendar = document.createElement('button');
    calendar.type = 'button';
    calendar.className = 'calendar-shortcut';
    calendar.setAttribute('aria-label', l('Избери период от календара', 'Choose dates from calendar'));
    calendar.title = l('Избери период от календара', 'Choose dates from calendar');
    calendar.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16M8 14h3m2 3h3"/></svg>';
    trigger.after(calendar);
    const rangePanel=document.createElement('div');rangePanel.className='crafted-calendar';rangePanel.hidden=true;rangePanel.id='history-range-calendar';rangePanel.setAttribute('role','dialog');rangePanel.setAttribute('aria-label',l('Избери период','Choose date range'));wrapper.append(rangePanel);
    calendar.setAttribute('aria-controls',rangePanel.id);calendar.setAttribute('aria-expanded','false');
    const from=root.querySelector('#history-from'),to=root.querySelector('#history-to');
    let rangeStart='',rangeEnd='',pickingEnd=false,year,month;
    const stamp=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const pretty=value=>new Intl.DateTimeFormat(getLanguage() === "en" ? "en-GB" : "bg-BG",{day:'numeric',month:'short',year:'numeric'}).format(new Date(value+'T12:00:00'));
    const commit=()=>{from.value=rangeStart;to.value=rangeEnd;select.value=rangeStart?'custom':'all';from.dispatchEvent(new Event('change',{bubbles:true}));to.dispatchEvent(new Event('change',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));paint();if(rangeStart)trigger.firstChild.textContent=pretty(rangeStart)+' – '+pretty(rangeEnd);};
    function drawRange(){
      rangePanel.innerHTML='<div class="calendar-month"><button type="button" data-month="-1">‹</button><strong></strong><button type="button" data-month="1">›</button></div><p class="range-instruction" role="status"></p><div class="calendar-weekdays"></div><div class="calendar-days"></div>';
      rangePanel.querySelector('strong').textContent=new Intl.DateTimeFormat(getLanguage() === "en" ? "en-GB" : "bg-BG",{month:'long',year:'numeric'}).format(new Date(year,month,1));
      rangePanel.querySelector('.range-instruction').textContent=pickingEnd?l('Избери крайна дата','Choose an end date'):rangeStart&&rangeEnd?pretty(rangeStart)+' – '+pretty(rangeEnd):l('Избери начална дата','Choose a start date');
      rangePanel.querySelectorAll('[data-month]').forEach(b=>{b.setAttribute('aria-label',b.dataset.month==='-1'?l('Предишен месец','Previous month'):l('Следващ месец','Next month'));b.onclick=()=>{const d=new Date(year,month+Number(b.dataset.month),1);year=d.getFullYear();month=d.getMonth();drawRange();rangePanel.querySelector(`[data-month="${b.dataset.month}"]`).focus();};});
      (getLanguage()==='bg'?['П','В','С','Ч','П','С','Н']:['M','T','W','T','F','S','S']).forEach(day=>{const e=document.createElement('span');e.textContent=day;rangePanel.querySelector('.calendar-weekdays').append(e);});
      const first=new Date(year,month,1);first.setDate(1-(first.getDay()+6)%7);
      for(let i=0;i<42;i++){
        const d=new Date(first);d.setDate(first.getDate()+i);const value=stamp(d),button=document.createElement('button');button.type='button';button.textContent=d.getDate();button.dataset.date=value;
        button.className=(d.getMonth()!==month?'outside ':'')+(value===rangeStart||value===rangeEnd?'selected ':rangeStart&&rangeEnd&&value>rangeStart&&value<rangeEnd?'in-range':'');
        button.setAttribute('aria-label',new Intl.DateTimeFormat(getLanguage() === "en" ? "en-GB" : "bg-BG",{dateStyle:'full'}).format(d));button.setAttribute('aria-pressed',String(value===rangeStart||value===rangeEnd));
        button.onclick=()=>{if(!pickingEnd){rangeStart=value;rangeEnd='';pickingEnd=true;drawRange();rangePanel.querySelector(`[data-date="${value}"]`).focus();}else{[rangeStart,rangeEnd]=[rangeStart,value].sort();pickingEnd=false;commit();closeRange();calendar.focus();}};
        rangePanel.querySelector('.calendar-days').append(button);
      }

      rangePanel.querySelector('.calendar-days').onkeydown=e=>{const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];if(delta===undefined)return;e.preventDefault();const d=new Date(document.activeElement.dataset.date+'T12:00:00');d.setDate(d.getDate()+delta);year=d.getFullYear();month=d.getMonth();drawRange();rangePanel.querySelector(`[data-date="${stamp(d)}"]`)?.focus();};
    }
    rangePanel.setAttribute('role','region');
    const host = wrapper.closest('.history-popover');
    let focused = false, version = 0, originalTop, originalMaxHeight;
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const upper = [...host.querySelectorAll('.history-select')].filter(el=>!el.contains(select));
    const upperGroup=document.createElement('div');
    upperGroup.className='range-upper-fields';
    upper[0].before(upperGroup);upperGroup.append(...upper);
    let motion=[];
    async function setRangeView(open) {
      const ticket=++version;
      focused=open;close();
      const initial=host.getBoundingClientRect();
      const upperHeight=upperGroup.getBoundingClientRect().height;
      const upperOpacity=getComputedStyle(upperGroup).opacity;
      const calendarHeight=rangePanel.hidden?0:rangePanel.getBoundingClientRect().height;
      const calendarOpacity=rangePanel.hidden?0:getComputedStyle(rangePanel).opacity;
      const panelStyle=getComputedStyle(rangePanel);
      const calendarMargin=rangePanel.hidden?'0px':panelStyle.marginTop;
      const calendarPadding=rangePanel.hidden?'0px':panelStyle.paddingTop;
      const calendarBorder=rangePanel.hidden?'0px':panelStyle.borderTopWidth;
      const calendarTransform=rangePanel.hidden?'translateY(6px)':panelStyle.transform;
      host.classList.add('range-animating');
      motion.forEach(a=>a.cancel());motion=[];
      if(open && !host.classList.contains('range-focused')) {originalTop=host.style.top;originalMaxHeight=host.style.maxHeight;}
      host.classList.toggle('range-focused',open);
      host.querySelector('#reset-history').setAttribute('aria-label',open?l('Изчисти периода','Clear Range'):l('Изчисти','Reset'));
      upperGroup.inert=open;
      rangePanel.hidden=false;
      calendar.setAttribute('aria-expanded',String(open));trigger.setAttribute('aria-expanded',String(open));
      if(open) {
        rangeStart=from.value;rangeEnd=to.value;pickingEnd=false;
        const d=rangeStart?new Date(rangeStart+'T12:00:00'):new Date();year=d.getFullYear();month=d.getMonth();drawRange();
      }
      upperGroup.style.height='auto';
      const naturalUpper=upperGroup.getBoundingClientRect().height;
      upperGroup.style.height=open?'0px':'auto';
      upperGroup.style.opacity=open?'0':'1';
      rangePanel.style.height='auto';rangePanel.style.opacity=open?'1':'0';
      const naturalCalendar=rangePanel.getBoundingClientRect().height;
      if(!open)rangePanel.hidden=true;
      host.style.height='auto';host.style.maxHeight=open?(innerHeight-24)+'px':originalMaxHeight;
      const targetHeight=host.getBoundingClientRect().height;
      host.style.top=open?Math.max(12,Math.min(initial.top,innerHeight-targetHeight-12))+'px':originalTop;
      const targetTop=host.getBoundingClientRect().top;
      if(reduced()){host.classList.remove('range-animating');return;}
      host.style.maxHeight=(innerHeight-24)+'px';
      rangePanel.hidden=false;
      const animate=(el,frames,options)=>{const animation=el.animate(frames,{fill:'both',easing:'cubic-bezier(.22,.75,.2,1)',...options});motion.push(animation);return animation;};
      animate(upperGroup,[{height:upperHeight+'px',opacity:upperOpacity},{height:(open?0:naturalUpper)+'px',opacity:open?0:1}],{duration:320,delay:open?0:120});
      animate(rangePanel,[{height:calendarHeight+'px',marginTop:calendarMargin,paddingTop:calendarPadding,borderTopWidth:calendarBorder},{height:(open?naturalCalendar:0)+'px',marginTop:open?'8px':'0px',paddingTop:open?'14px':'0px',borderTopWidth:open?'1px':'0px'}],{duration:320,delay:open?120:0});
      animate(rangePanel,[{opacity:calendarOpacity,transform:calendarTransform},{opacity:open?1:0,transform:open?'translateY(0)':'translateY(6px)'}],{duration:180,delay:open?330:0});
      animate(host,[{height:initial.height+'px',top:initial.top+'px'},{height:targetHeight+'px',top:targetTop+'px'}],{duration:440});
      await Promise.all(motion.map(a=>a.finished.catch(()=>{})));
      if(ticket!==version)return;
      rangePanel.hidden=!open;
      motion.forEach(a=>a.cancel());motion=[];
      host.style.maxHeight=open?(innerHeight-24)+'px':originalMaxHeight;
      host.classList.remove('range-animating');
    }

    host.querySelector('#reset-history').addEventListener('click',()=>{
      if(!focused)return;
      rangeStart='';rangeEnd='';pickingEnd=false;commit();drawRange();
    });
    const closeRange=()=>setRangeView(false);
    calendar.onclick=e=>{e.preventDefault();setRangeView(!focused);};
    trigger.onclick=e=>{e.preventDefault();setRangeView(!focused);};
    trigger.setAttribute('aria-haspopup','false');
    trigger.setAttribute('aria-controls',rangePanel.id);
    trigger.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();setRangeView(true);}};
    host.addEventListener('keydown',e=>{if(e.key==='Escape'&&focused){e.preventDefault();e.stopPropagation();closeRange();trigger.focus();}});
    host.addEventListener('toggle',e=>{if(e.newState==='closed'){version++;focused=false;motion.forEach(a=>a.cancel());motion=[];upperGroup.style.height='auto';upperGroup.style.opacity='1';upperGroup.inert=false;host.getAnimations().forEach(a=>a.cancel());host.classList.remove('range-focused','range-animating');host.querySelector('#reset-history').setAttribute('aria-label',l('Изчисти','Reset'));rangePanel.hidden=true;calendar.setAttribute('aria-expanded','false');trigger.setAttribute('aria-expanded','false');if(originalTop!==undefined){host.style.top=originalTop;host.style.maxHeight=originalMaxHeight;}}});


  }
 });
}

export function cleanupHistoryInputs() { cleanup?.abort(); }
