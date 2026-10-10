import { enhanceHistoryInputs, cleanupHistoryInputs } from "./history-inputs.js";
import { getLanguage } from "./i18n.js";
import { escapeHtml } from "./profile.js";
const l = (bg, en) => (getLanguage() === "en" ? en : bg);
const pair = (bg, en) => ({ bg, en });
const text = (value) => escapeHtml(value[getLanguage()]);
const records = [
  {
    id: "sms-1",
    type: "sms",
    date: "2026-10-10T09:44:00+03:00",
    status: "sent",
    title: pair(
      "Ало ти изпрати телефона на Иван",
      "Alo sent you Ivan’s number",
    ),
    detail: pair(
      "СМС от Ало до теб: „Телефонът на Иван Петров е 0888 123 456.“",
      "SMS from Alo to you: “Ivan Petrov’s phone number is 0888 123 456.”",
    ),
    message: pair("Телефонът на Иван Петров е 0888 123 456.", "Ivan Petrov’s phone number is 0888 123 456."),
    call: "call-3",
    task: "task-4",
  },
  {
    id: "callback-1",
    type: "callback",
    date: "2026-10-10T09:43:00+03:00",
    status: "notified",
    duration: "0:38",
    transcript: [
      ["00:00", "alo", pair("Здравей! Обаждам се да ти кажа, че срещата с Мария е добавена в календара за понеделник, 12 октомври, от 14:00 до 14:30, в офиса.", "Hi! Your meeting with Maria is now in your calendar for Monday, October 12, from 14:00 to 14:30, at the office.")],
      ["00:14", "user", pair("Чудесно. А имейлът?", "Great. What about the email?")],
      ["00:18", "alo", pair("Черновата е готова. Чака твоето потвърждение, преди да я изпратя.", "The draft is ready. It’s waiting for your approval before I send it.")],
      ["00:28", "user", pair("Ще я прегледам. Благодаря!", "I’ll review it. Thanks!")],
      ["00:33", "alo", pair("Добре, приятен ден!", "Sounds good. Have a lovely day!")],
    ],
    title: pair(
      "Ало ти се обади за срещата",
      "Alo called you about the meeting",
    ),
    detail: pair(
      "Ало ти се обади с резултата: срещата с Мария е добавена в календара за 12 октомври, 14:00–14:30, в офиса.",
      "Alo called you with the result: your meeting with Maria was added to the calendar for October 12, 14:00–14:30, at the office.",
    ),
    call: "call-1",
    task: "task-2",
  },
  {
    id: "task-1",
    type: "task",
    date: "2026-10-10T09:42:00+03:00",
    status: "waiting",
    title: pair("Имейл до Мария", "Email to Maria"),
    detail: pair(
      "Черновата за срещата в понеделник е готова. Очаква твоето потвърждение преди изпращане.",
      "The draft for Monday’s meeting is ready. Awaiting your confirmation before sending.",
    ),
    call: "call-1",
  },
  {
    id: "task-2",
    type: "task",
    date: "2026-10-10T09:41:00+03:00",
    status: "done",
    title: pair("Среща с Мария", "Meeting with Maria"),
    detail: pair(
      "Добавена в Google Calendar за 12 октомври, 14:00–14:30. Място: офисът.",
      "Added to Google Calendar for October 12, 14:00–14:30. Location: the office.",
    ),
    call: "call-1",
  },
  {
    id: "call-1",
    type: "call",
    date: "2026-10-10T09:38:00+03:00",
    duration: "3:24",
    title: pair("Планове за понеделник", "Plans for Monday"),
    detail: pair(
      "Среща с Мария и имейл с подробностите.",
      "A meeting with Maria and an email with the details.",
    ),
    transcript: [
      [
        "00:00",
        "user",
        pair(
          "Ало, запази ми среща с Мария в понеделник в два, за половин час.",
          "Alo, schedule a half-hour meeting with Maria on Monday at two.",
        ),
      ],
      [
        "00:18",
        "alo",
        pair(
          "На 12 октомври, от 14:00 до 14:30. Къде ще е срещата?",
          "October 12, from 14:00 to 14:30. Where will you meet?",
        ),
      ],
      [
        "00:31",
        "user",
        pair(
          "В офиса. Добави я в календара.",
          "At the office. Add it to the calendar.",
        ),
      ],
      [
        "00:44",
        "alo",
        pair(
          "Срещата е добавена. Да подготвя ли и имейл до Мария?",
          "The meeting is added. Shall I also draft an email to Maria?",
        ),
      ],
      [
        "01:05",
        "user",
        pair(
          "Да, напиши ѝ кога и къде, но искам да го прегледам преди да го изпратиш.",
          "Yes, tell her when and where, but I want to review it before you send it.",
        ),
      ],
      [
        "03:12",
        "alo",
        pair(
          "Черновата е готова и чака потвърждението ти.",
          "The draft is ready and waiting for your confirmation.",
        ),
      ],
    ],
  },
  {
    id: "task-3",
    type: "task",
    date: "2026-10-09T17:16:00+03:00",
    status: "progress",
    title: pair("Час за сервиз", "Car service appointment"),
    detail: pair(
      "Търси се свободен час за вторник сутрин. Часът още не е потвърден.",
      "Looking for an available appointment on Tuesday morning. The booking is not confirmed yet.",
    ),
    call: "call-2",
  },
  {
    id: "call-2",
    type: "call",
    date: "2026-10-09T17:14:00+03:00",
    duration: "1:52",
    title: pair("Записване за сервиз", "Booking a car service"),
    detail: pair(
      "Проверка за свободен час във вторник.",
      "Checking availability for Tuesday.",
    ),
    transcript: [
      [
        "00:00",
        "user",
        pair(
          "Провери за час в сервиза във вторник сутрин.",
          "Check for a car service appointment on Tuesday morning.",
        ),
      ],
      [
        "00:16",
        "alo",
        pair(
          "В обичайния сервиз ли? Има ли час, след който не си свободен?",
          "At your usual garage? Is there a time after which you are unavailable?",
        ),
      ],
      [
        "00:33",
        "user",
        pair(
          "Да, в същия. Трябва да приключа до единайсет.",
          "Yes, the same one. I need to be done by eleven.",
        ),
      ],
      [
        "01:40",
        "alo",
        pair(
          "Ще проверя за час преди единайсет. Засега няма потвърдена резервация.",
          "I’ll check for an appointment before eleven. There is no confirmed booking yet.",
        ),
      ],
    ],
  },
  {
    id: "task-4",
    type: "task",
    date: "2026-10-08T12:08:00+03:00",
    status: "done",
    title: pair("Телефонът на Иван", "Ivan’s phone number"),
    detail: pair(
      "Намерен е контактът на Иван Петров в Google Contacts.",
      "Found Ivan Petrov’s entry in Google Contacts.",
    ),
    call: "call-3",
  },
  {
    id: "call-3",
    type: "call",
    date: "2026-10-08T12:07:00+03:00",
    duration: "0:48",
    title: pair("Контакт на Иван", "Ivan’s contact"),
    detail: pair("Търсене на телефонен номер.", "Looking up a phone number."),
    transcript: [
      [
        "00:00",
        "user",
        pair(
          "Намери ми телефона на Иван Петров.",
          "Find Ivan Petrov’s phone number.",
        ),
      ],
      [
        "00:12",
        "alo",
        pair(
          "Намерих Иван Петров в контактите ти. Да ти прочета номера?",
          "I found Ivan Petrov in your contacts. Shall I read out the number?",
        ),
      ],
      ["00:23", "user", pair("Да, моля.", "Yes, please.")],
      [
        "00:30",
        "alo",
        pair(
          "Номерът е нула осем осем осем, сто двайсет и три, четиристотин петдесет и шест.",
          "The number is zero eight eight eight, one two three, four five six.",
        ),
      ],
    ],
  },
];
let statusFilter = "all", period = "all", durationFilter = "all", sortOrder = "newest", fromDate = "", toDate = "";
let filter = "all",
  query = "",
  selected = null;
const date = (r) =>
  new Intl.DateTimeFormat(getLanguage() === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Sofia",
  }).format(new Date(r.date));
const isComplete = r => r.type === "call" || ["done", "sent", "notified"].includes(r.status);
const status = r => isComplete(r) ? l("Завършено", "Complete") : l("В процес", "In Progress");
const statusIndicator = r => `<span class="history-status ${isComplete(r) ? "complete" : "in-progress"}" title="${status(r)}"><span class="history-status-label">${status(r)}</span><svg class="history-status-symbol" viewBox="0 0 20 20" fill="none" aria-hidden="true">${isComplete(r) ? '<path d="m4 10 4 4 8-8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' : '<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.8" opacity=".2"/><path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'}</svg></span>`;
const listDate = r => {
  const locale = getLanguage() === "bg" ? "bg-BG" : "en-GB";
  const value = new Date(r.date);
  const day = new Intl.DateTimeFormat(locale, {day:"numeric", month:"short", year:"numeric", timeZone:"Europe/Sofia"}).format(value);
  const time = new Intl.DateTimeFormat(locale, {hour:"2-digit", minute:"2-digit", hour12:false, timeZone:"Europe/Sofia"}).format(value);
  return `${day} · ${time}`;
};
const shortDuration = duration => { const [m,s] = duration.split(":").map(Number); return `${m}m ${s}s`; };
export const historyLegend = () => `<div class="history-legend"><span>${l("Заглавие", "Title")}</span><span>${l("Статус", "Status")}</span></div>`;
const typeLabel = (type) =>
  ({
    call: l("Входящи", "In"),
    callback: l("Изходящи", "Out"),
    task: l("Задача", "Task"),
    sms: l("СМС", "SMS"),
  })[type];
function row(r, icon) {
  return `<button class="history-row type-${r.type}" data-record="${r.id}"><span class="history-symbol">${icon({ call: "phone", callback: "callback", task: "task", sms: "sms" }[r.type])}</span><span class="history-copy"><strong>${text(r.title)}</strong></span><span class="history-row-meta"><span class="history-chips"><time class="history-chip" datetime="${r.date}">${listDate(r)}</time>${r.duration ? `<span class="history-chip">${shortDuration(r.duration)}</span>` : ""}</span>${statusIndicator(r)}</span>${icon("chevron")}</button>`;
}

const secondsOf = r => r.duration ? r.duration.split(":").reduce((m,s) => Number(m)*60+Number(s)) : null;
const dayOf = r => new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Sofia', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(r.date));
function filteredRecords() {
 const needle = query.trim().toLocaleLowerCase();
 const today = dayOf({date:new Date().toISOString()});
 const past = days => new Date(Date.parse(today+'T12:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
 const start = period==='today' ? today : period==='week' ? past(7) : period==='month' ? past(30) : period==='custom' ? fromDate : '';
 const end = period==='custom' ? toDate : period==='all' ? '' : today;
 return records.filter(r => {
  const sec=secondsOf(r), day=dayOf(r);
  return (filter==='all'||r.type===filter) && (statusFilter==='all'||isComplete(r)===(statusFilter==='complete')) && (!start||day>=start) && (!end||day<=end) && (durationFilter==='all'||durationFilter==='short'&&sec!==null&&sec<60||durationFilter==='medium'&&sec!==null&&sec>=60&&sec<300||durationFilter==='long'&&sec!==null&&sec>=300||durationFilter==='none'&&sec===null) && `${r.title[getLanguage()]} ${r.detail[getLanguage()]} ${status(r)} ${(r.transcript||[]).map(turn=>turn[2][getLanguage()]).join(' ')}`.toLocaleLowerCase().includes(needle);
 }).sort((a,b)=>{
  const tie=()=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id);
  if(sortOrder==='oldest') return a.date.localeCompare(b.date)||a.id.localeCompare(b.id);
  if(sortOrder==='az'||sortOrder==='za') return a.title[getLanguage()].localeCompare(b.title[getLanguage()],getLanguage())*(sortOrder==='az'?1:-1)||tie();
  if(sortOrder==='shortest'||sortOrder==='longest') { const x=secondsOf(a),y=secondsOf(b); if(x===null||y===null) return x===y?tie():x===null?1:-1; return (x-y)*(sortOrder==='shortest'?1:-1)||tie(); }
  if(sortOrder==='status') return Number(isComplete(a))-Number(isComplete(b))||tie();
  return tie();
 });
}
function results(icon) {
 const found=filteredRecords();
 return historyLegend()+(found.length?found.map(r=>row(r,icon)).join(''):`<p class="history-empty">${l('Няма намерени записи.','No results found.')}</p>`);
}
function selectControl(id,label,value,choices) {
 return `<label class="history-select"><span>${label}</span><select id="${id}" aria-label="${label}">${choices.map(([key,title])=>`<option value="${key}" ${value===key?'selected':''}>${title}</option>`).join('')}</select></label>`;
}
function historyControls(icon) {
 return `<button class="history-tool" id="filter-trigger" popovertarget="history-filter-popover" title="${l('Подреждане и филтри','Sort & Filter')}">${icon("sliders")}<span>${l("Подреждане и филтри","Sort & Filter")}</span><span id="filter-count" hidden></span></button><div id="history-filter-popover" class="history-popover" popover><div class="history-popover-title">${l("Подреждане и филтри","Sort & Filter")}</div><div class="history-refinements">${selectControl('sort-order',l('Подреди','Sort'),sortOrder,[['newest',l('Най-нови','Newest first')],['oldest',l('Най-стари','Oldest first')],['az',l('Заглавие: А–Я','Title: A–Z')],['za',l('Заглавие: Я–А','Title: Z–A')],['shortest',l('Най-кратки','Shortest first')],['longest',l('Най-дълги','Longest first')],['status',l('Първо в процес','In Progress first')]])}${selectControl('status-filter',l('Статус','Status'),statusFilter,[['all',l('Всички','All')],['complete',l('Завършено','Complete')],['progress',l('В процес','In Progress')]])}${selectControl('duration-filter',l('Продължителност','Duration'),durationFilter,[['all',l('Всички','Any duration')],['short',l('Под 1 мин','Under 1 min')],['medium',l('1–5 мин','1–5 min')],['long',l('5+ мин','5+ min')],['none',l('Без продължителност','No duration')]])}${selectControl('period-filter',l('Период','Date Range'),period,[['all',l('Всички дати','All dates')],['today',l('Днес','Today')],['week',l('Последните 7 дни','Last 7 days')],['month',l('Последните 30 дни','Last 30 days')],['custom',l('Избери дати','Custom dates')]])}<button type="button" class="primary full options-button" id="reset-history" aria-label="${l('Изчисти','Reset')}"><span class="reset-label-window" aria-hidden="true"><span class="reset-label-track"><span>${l('Изчисти','Reset')}</span><span>${l('Изчисти периода','Clear Range')}</span></span></span></button></div><div class="history-date-range" ${period==='custom'?'':'hidden'}><label>${l('От','From')}<input id="history-from" type="date" value="${fromDate}" /></label><label>${l('До','To')}<input id="history-to" type="date" value="${toDate}" /></label></div><p class="history-filter-feedback" id="history-filter-feedback" role="status"></p></div>`;
}
function durationLabel(duration) {
  const [minutes, seconds] = duration.split(":").map(Number);
  const parts = [];
  if (minutes)
    parts.push(
      `${minutes} ${minutes === 1 ? l("минута", "minute") : l("минути", "minutes")}`,
    );
  if (seconds || !minutes)
    parts.push(
      `${seconds} ${seconds === 1 ? l("секунда", "second") : l("секунди", "seconds")}`,
    );
  return parts.join(" ");
}
export function historyBreadcrumb(icon) {
  const record = records.find(r => r.id === selected);
  if (!record) return "";
  return `<h1 class="history-breadcrumb" tabindex="-1"><span class="topbar-title">${l("История", "History")}</span><span class="breadcrumb-detail">${icon("chevron")}<span class="breadcrumb-current" title="${text(record.title)}">${text(record.title)}</span></span></h1>`;
}
function transcriptHeader(title, icon) {
  return `<div class="transcript-header"><h2 id="transcript-title">${title}</h2><button class="icon-button transcript-expand" data-transcript-expand aria-label="${l("Отвори на цял екран", "Open fullscreen")}">${icon("expand")}</button></div>`;
}
function callTranscript(r, icon) {
  return `<aside class="transcript-panel" aria-labelledby="transcript-title">${transcriptHeader(l("Транскрипция на разговора", "Call Transcript"), icon)}<div class="transcript" tabindex="0" role="region" aria-label="${l("Транскрипция на разговора", "Call Transcript")}"><p class="chat-event">${l("Започнат Разговор", "Call started")} <time datetime="${r.date}">${date(r)}</time></p>${r.transcript.map(([time, speaker, words]) => `<div class="transcript-turn ${speaker === "user" ? "outgoing" : "incoming"}" aria-label="${speaker === "user" ? l("Ти", "You") : l("Ало", "Alo")}"><p class="chat-bubble">${text(words)}</p><span class="chat-caption">${speaker === "user" ? l("Ти", "You") : l("Ало", "Alo")} · <time>${time}</time></span></div>`).join("")}<p class="chat-event">${l("Приключен Разговор", "Call ended")} · ${durationLabel(r.duration)}</p></div></aside>`;
}
export function historyView(icon) {
  const r = records.find((r) => r.id === selected);
  if (r)
    return `<section class="history-detail ${["call", "callback", "sms"].includes(r.type) ? "transcript-detail" : ""}"><div class="conversation-summary"><div class="history-meta">${statusIndicator(r)}<time datetime="${r.date}">${date(r)}</time></div><p class="history-summary">${text(r.detail)}</p>${
      r.type === "call"
        ? `<h2>${l("От този разговор", "From this call")}</h2><div class="history-list">${historyLegend()}${records
            .filter((task) => task.call === r.id)
            .map((task) => row(task, icon))
            .join(
              "",
            )}</div></div>`
        : `${
            r.task
              ? `<h2>${l("Свързана задача", "Related task")}</h2><div class="history-list">${historyLegend()}${row(
                  records.find((task) => task.id === r.task),
                  icon,
                )}</div>`
              : ""
          }<h2>${l("Свързан разговор", "Related call")}</h2><div class="history-list">${historyLegend()}${row(
            records.find((call) => call.id === r.call),
            icon,
          )}</div>`
    }${r.type === "call" ? "" : "</div>"}${["call", "callback"].includes(r.type) ? callTranscript(r, icon) : ""}${r.type === "sms" ? `<aside class="transcript-panel" aria-labelledby="transcript-title">${transcriptHeader(l("СМС транскрипция", "SMS Transcript"), icon)}<div class="transcript" tabindex="0" role="region" aria-label="${l("СМС транскрипция", "SMS Transcript")}"><p class="chat-event"><time datetime="${r.date}">${date(r)}</time></p><div class="transcript-turn incoming" aria-label="${l("Ало", "Alo")}"><p class="chat-bubble">${text(r.message)}</p><span class="chat-caption">${l("Ало", "Alo")}</span></div></div></aside>` : ""}</section>`;
  return `<section class="history-index" aria-label="${l("История", "History")}"><div class="history-toolbar"><div class="history-filters" role="group" aria-label="${l("Тип записи", "Record type")}"><span class="history-tab-highlight" aria-hidden="true"></span>${[
    ["all", l("Всички", "All")],
    ["call", typeLabel("call")],
    ["callback", typeLabel("callback")],
    ["task", typeLabel("task")],
    ["sms", typeLabel("sms")],
  ]
    .map(
      ([id, label]) =>
        `<button data-filter="${id}" aria-pressed="${filter === id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><input type="search" id="history-search" placeholder="${l("Търси", "Search")}" aria-label="${l("Търси в историята", "Search history")}" value="${escapeHtml(query)}" />${historyControls(icon)}</div><div class="history-list" id="history-results" tabindex="0" role="region" aria-label="${l("Записи в историята", "History records")}">${results(icon)}</div></section>`;
}
let filterObserver;
export function bindHistory(root, render, icon) {
  root.querySelector("[data-transcript-expand]")?.addEventListener("click", (event) => {
    const trigger = event.currentTarget;
    const panel = trigger.closest(".transcript-panel");
    const source = panel.querySelector(".transcript");
    const dialog = document.createElement("dialog");
    dialog.className = "transcript-fullscreen";
    dialog.setAttribute("aria-labelledby", "fullscreen-transcript-title");
    dialog.innerHTML = `<div class="transcript-header"><h2 id="fullscreen-transcript-title">${escapeHtml(panel.querySelector("h2").textContent)}</h2><button class="icon-button transcript-close" aria-label="${l("Затвори", "Close")}" autofocus>${icon("close")}</button></div>`;
    const content = source.cloneNode(true);
    dialog.append(content);
    document.body.append(dialog);
    document.body.classList.add("transcript-is-fullscreen");
    dialog.querySelector(".transcript-close").onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
      source.scrollTop = content.scrollTop;
      document.body.classList.remove("transcript-is-fullscreen");
      dialog.remove();
      trigger.focus({preventScroll:true});
    }, {once:true});
    dialog.showModal();
    content.scrollTop = source.scrollTop;
  });
  filterObserver?.disconnect();
  const filters = root.querySelector(".history-filters");
  const moveHighlight = () => {
    const active = filters?.querySelector('[aria-pressed="true"]');
    const highlight = filters?.querySelector(".history-tab-highlight");
    if (!active || !highlight) return;
    highlight.style.width = `${active.offsetWidth}px`;
    highlight.style.transform = `translateX(${active.offsetLeft}px)`;
  };
  if (filters) {
    moveHighlight();
    requestAnimationFrame(() => filters.classList.add("tabs-ready"));
    filterObserver = new ResizeObserver(moveHighlight);
    filterObserver.observe(filters);
  }
  const bindRows = () =>
    root.querySelectorAll("[data-record]").forEach(
      (button) =>
        (button.onclick = () => {
          selected = button.dataset.record;
          render();
          window.scrollTo(0, 0);
          root.querySelector("h1")?.focus({ preventScroll: true });
        }),
    );
  bindRows();
  const refresh = () => {
    const resultsEl=root.querySelector('#history-results');
    if(!resultsEl) return;
    resultsEl.innerHTML=results(icon); resultsEl.scrollTop=0; bindRows();
    const count=[statusFilter!=='all',period!=='all',durationFilter!=='all',sortOrder!=='newest'].filter(Boolean).length;
    const badge=root.querySelector('#filter-count'); badge.textContent=count; badge.hidden=!count;
    root.querySelector('#filter-trigger').classList.toggle('is-active',count>0);

    root.querySelector('#history-filter-feedback').textContent = period==='custom' && fromDate && toDate && fromDate>toDate ? l('Началната дата трябва да е преди крайната.','Start date must be before end date.') : `${filteredRecords().length} ${l('записа','results')}`;
  };
  for(const id of ['status-filter','period-filter','duration-filter','sort-order','history-from','history-to']) root.querySelector('#'+id)?.addEventListener('change', e=>{
    const value=e.target.value;
    if(id==='status-filter') statusFilter=value;
    if(id==='period-filter') {period=value;root.querySelector('.history-date-range').hidden=value!=='custom';}
    if(id==='duration-filter') durationFilter=value;
    if(id==='sort-order') sortOrder=value;
    if(id==='history-from') fromDate=value;
    if(id==='history-to') toDate=value;
    refresh();
  });
  root.querySelector('#reset-history')?.addEventListener('click',()=>{if(root.querySelector('#history-filter-popover').classList.contains('range-focused'))return;filter='all';query='';statusFilter='all';period='all';durationFilter='all';sortOrder='newest';fromDate='';toDate='';render();root.querySelector('#filter-trigger').focus();});
  refresh();
  enhanceHistoryInputs(root);
  for (const [triggerId,popoverId] of [['filter-trigger','history-filter-popover']]) {
    const trigger=root.querySelector('#'+triggerId), popover=root.querySelector('#'+popoverId);
    popover?.addEventListener('beforetoggle',e=>{
      if(e.newState!=='open') return;
      const r=trigger.getBoundingClientRect();
      const mobile=matchMedia('(max-width: 750px)').matches;
      const content=root.querySelector('.history-index').getBoundingClientRect();
      const width=mobile ? content.width : Math.min(300,innerWidth-24);
      popover.style.width=width+'px';
      popover.style.left=(mobile ? content.left : Math.max(12,Math.min(r.right-width,innerWidth-width-12)))+'px';
      popover.style.top=Math.min(r.bottom+8,innerHeight-120)+'px';
      popover.style.maxHeight=Math.max(100,innerHeight-r.bottom-20)+'px';
    });
  }
  root.querySelector("[data-history-back]")?.addEventListener("click", () => {
    selected = null;
    render();
    root.querySelector("h1")?.focus({ preventScroll: true });
  });
  root.querySelectorAll("[data-filter]").forEach(
    (button) =>
      (button.onclick = () => {
        filter = button.dataset.filter;
        root
          .querySelectorAll("[data-filter]")
          .forEach((b) =>
            b.setAttribute("aria-pressed", String(b.dataset.filter === filter)),
          );
        moveHighlight();
        refresh();
      }),
  );
  root.querySelector("#history-search")?.addEventListener("input", (e) => {
    query = e.target.value;
    refresh();
  });
}
export function resetHistory() {
  selected = null;
}

export function historyOverview(icon) {
  const calls = records.filter((r) => r.type === "call");
  const seconds = calls.reduce((total, r) => {
    const [m, s] = r.duration.split(":").map(Number);
    return total + m * 60 + s;
  }, 0);
  return {
    calls: calls.length,
    minutes: Math.ceil(seconds / 60),
    completed: records.filter((r) => r.type === "task" && r.status === "done")
      .length,
    pending: records.filter((r) => r.type === "task" && r.status !== "done")
      .length,
    activity: historyLegend() + records
      .slice(0, 3)
      .map((r) => row(r, icon))
      .join(""),
  };
}
export function selectHistoryRecord(id) {
  selected = records.some((r) => r.id === id) ? id : null;
}

export function cleanupHistory() { filterObserver?.disconnect(); cleanupHistoryInputs(); }
