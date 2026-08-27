import test from "node:test";
import assert from "node:assert/strict";

import {
  INTERACTION_STATUS,
  cancelInteraction,
  completeInteraction,
  contextFor,
  findActiveInteraction,
  resolveConversationTurn,
} from "../js/conversation.js";
import { calendarDetails, normalizeFutureCall, normalizeReminderSchedule, scheduleFor, scheduleTitle, updateCalendarDetails } from "../js/schedule.js";
import { completionTarget, completePending, completePendingWithCalendar, findPendingMatches, findReminderMatches } from "../js/pending.js";
import { mockProvider, interpret, localCalendarUpdate, localReminderQuery, protectCalendarInterpretation } from "../js/ai.js";
import { fixtureTitle, reminderFixture } from './reminder-event-fixture.mjs';
import { applyCalendarUpdateToEntries, buildCalendarSearch, calendarEvent, scheduledReminderEvent, listAllCalendarPages, reconcileReminderEntries } from '../js/google.js';
import { fromCloudEntry, toCloudEntry } from '../js/cloud-entry.js';

test('reprogramar entiende frases naturales y separa objetivo de nueva fecha y hora',()=>{
  const now=new Date(2026,7,26,12);
  const cases=[
    ['Pasa la llamada de Miguel al viernes a las 11','Miguel','2026-08-28','11:00'],
    ['La llamada de Miguel ahora cambia de hora a las 11','Miguel',undefined,'11:00'],
    ['Retrasa el recordatorio de Carlos hasta mañana','Carlos','2026-08-27',undefined]
  ];
  for(const [text,title,date,time] of cases){
    const intent=localCalendarUpdate(text,now);
    assert.equal(intent.intent,'calendar.update');
    assert.equal(intent.target.title,title);
    assert.equal(intent.changes?.date,date);
    assert.equal(intent.changes?.time,time);
    assert.equal(resolveConversationTurn({text,interpretation:intent}).interaction.status,INTERACTION_STATUS.PENDING_CONFIRMATION);
  }
});

test('reprogramar sin hora mantiene el modal y una respuesta corta completa la misma operación',()=>{
  const now=new Date(2026,7,26,12);
  const firstIntent=localCalendarUpdate('Cámbiame la hora de llamar a Miguel',now);
  const first=resolveConversationTurn({text:'Cámbiame la hora de llamar a Miguel',interpretation:firstIntent});
  assert.equal(first.interpretation.intent,'calendar.update');
  assert.equal(first.interpretation.target.title,'Miguel');
  assert.equal(first.interaction.status,INTERACTION_STATUS.AWAITING_INPUT);
  assert.equal(first.interaction.question,'¿Para qué día u hora quieres cambiarlo?');
  const active={id:'update-miguel',aiIntent:first.interpretation,interaction:first.interaction};
  const answer=localCalendarUpdate('A las once',now,active);
  const second=resolveConversationTurn({active,text:'A las once',interpretation:answer});
  assert.equal(second.interpretation.intent,'calendar.update');
  assert.equal(second.interpretation.target.title,'Miguel');
  assert.deepEqual(second.interpretation.changes,{time:'11:00'});
  assert.equal(second.interaction.status,INTERACTION_STATUS.PENDING_CONFIRMATION);
});

test('una orden de cambio tiene prioridad aunque la IA la confunda con llamar ahora',()=>{
  const text='Cámbiame la hora de llamar a Miguel';
  const mistaken={intent:'contact.call',confidence:.95,contactName:'Miguel',requiresConfirmation:true,source:'ai'};
  const priority=localCalendarUpdate(text,new Date(2026,7,26,12));
  const routed=protectCalendarInterpretation(mistaken,priority);
  assert.equal(routed.intent,'calendar.update');
  assert.equal(routed.target.title,'Miguel');
  assert.equal(routed.changes,null);
  assert.equal(resolveConversationTurn({text,interpretation:routed}).interaction.status,INTERACTION_STATUS.AWAITING_INPUT);
});

test('la protección local no sustituye el objetivo semántico entendido por la IA',()=>{
  const cases=[
    ['Anula cita con Miguel','calendar.delete',localCalendarCancellation('Anula cita con Miguel'),null],
    ['Cámbiame la hora de Miguel','calendar.update',localCalendarUpdate('Cámbiame la hora de Miguel',new Date(2026,7,26,12)),null],
    ['Pasa lo de Miguel al viernes a las once','calendar.update',localCalendarUpdate('Pasa lo de Miguel al viernes a las once',new Date(2026,7,26,12)),{date:'2026-08-28',time:'11:00'}]
  ];
  for(const [text,intent,local,changes] of cases){
    const remote={intent,confidence:.95,target:{title:'Miguel',date:null,time:null},changes,requiresConfirmation:true,source:'ai'};
    const routed=protectCalendarInterpretation(remote,local);
    assert.equal(routed.intent,intent,text);
    assert.equal(routed.target.title,'Miguel',text);
  }
});

test('reprogramar busca por la persona y actualiza Calendar y el recordatorio local elegido',()=>{
  const search=buildCalendarSearch({target:{title:'Llamada de Miguel'}},'calendar.update');
  assert.equal(search.query,'Miguel');
  const entries=[
    {id:'action',proposal:{intent:'calendar.update',actionStatus:'pending_confirmation'}},
    {id:'miguel',type:'reminder',scheduledDate:'2026-08-27',scheduledTime:'09:00',schedule:{status:'scheduled',calendarEventId:'event-miguel',dueAt:'2026-08-27T09:00:00'}},
    {id:'carlos',type:'reminder',schedule:{status:'scheduled',calendarEventId:'event-carlos',dueAt:'2026-08-27T10:00:00'}}
  ];
  const updated=applyCalendarUpdateToEntries(entries,entries[0],'event-miguel','update',{}, {date:'2026-08-28',time:'11:00'});
  assert.equal(updated[0].proposal.actionStatus,'completed');
  assert.equal(updated[1].scheduledDate,'2026-08-28');
  assert.equal(updated[1].scheduledTime,'11:00');
  assert.equal(updated[1].schedule.dueAt,'2026-08-28T11:00:00');
  assert.equal(updated[1].schedule.status,'scheduled');
  assert.deepEqual(updated[2],entries[2]);
});

test('agenda: reúne todas las páginas de Calendar sin duplicar acciones parciales',async()=>{
  const received=[];
  const result=await listAllCalendarPages(async params=>{
    received.push(new URLSearchParams(params).get('pageToken'));
    if(received.length===1)return{calendarId:'primary',items:Array.from({length:20},(_,i)=>({id:`e${i}`})),nextPageToken:'page-2'};
    return{calendarId:'primary',items:Array.from({length:7},(_,i)=>({id:`e${i+20}`}))};
  },new URLSearchParams({maxResults:'20',timeMin:'2026-08-27T00:00:00Z'}));
  assert.equal(result.items.length,27);
  assert.equal(new Set(result.items.map(item=>item.id)).size,27);
  assert.deepEqual(received,[null,'page-2']);
});

test('agenda: un ciclo anómalo de páginas se muestra como error, no como lista incompleta',async()=>{
  await assert.rejects(()=>listAllCalendarPages(async()=>({items:[{id:'one'}],nextPageToken:'loop'}),new URLSearchParams(),2),/demasiadas páginas/);
});
import { temporalData, calendarQueryRange } from '../js/temporal.js';
import { preserveCancellation } from '../js/conversation.js';
import { localCalendarCancellation } from '../js/ai.js';
import { createUI } from '../js/ui.js';
import { readFileSync } from 'node:fs';
import { createAgendaActions } from '../js/agenda.js';
import { normalizeUndatedCall, deferredCallIntent } from '../js/schedule.js';

test('llamar a Miguel sin fecha no hereda la programación inventada por IA',()=>{
  for(const source of ['ai','fallback'])for(const text of ['Llamar a Miguel','Llama a Miguel Ibiza','Quiero llamar a Miguel ahora']){
    const wrong={intent:'reminder.create',contactName:'Miguel',date:'2026-08-27',time:null,missingFields:['time'],question:'¿Cuándo quieres que te recuerde?',source};
    const fixed=normalizeUndatedCall(wrong,text);
    const turn=resolveConversationTurn({text,interpretation:fixed});
    assert.equal(turn.interpretation.intent,'contact.call');
    assert.deepEqual(turn.interaction.missingFields,[]);
    assert.equal(turn.interpretation.date,null);
    assert.equal(turn.interpretation.time,null);
    assert.equal(turn.interpretation.source,source);
    assert.equal(scheduleFor(fixed,text),null);
  }
});

test('llamadas futuras, recordatorios explícitos y respuestas activas conservan su intención',()=>{
  const ai={intent:'reminder.create',date:'2026-08-27',time:null};
  for(const text of ['Recuérdame llamar a Miguel','Llamar a Miguel mañana','Llamar a Miguel a las siete','Llamar a Miguel en dos horas','Llamar a Miguel el 29','Llamar a Miguel la semana que viene','Anula llamada a Miguel'])assert.equal(normalizeUndatedCall(ai,text),ai);
  assert.equal(normalizeUndatedCall(ai,'Llamar a Miguel',{id:'active'}),ai);
});

test('elegir programar conserva el contacto y pide fecha/hora en la misma entrada',()=>{
  const note={id:'call',text:'Llamar a Miguel Ibiza',aiIntent:normalizeUndatedCall({intent:'reminder.create',source:'ai'},'Llamar a Miguel Ibiza')};
  for(const intent of ['reminder.create','calendar.create']){
    const next=deferredCallIntent(note,intent);
    const turn=resolveConversationTurn({text:'Programar',interpretation:next});
    assert.equal(turn.interpretation.intent,intent);
    assert.equal(turn.interpretation.contactName,'Miguel Ibiza');
    assert.deepEqual(turn.interaction.missingFields,['date','time']);
    const continued=resolveConversationTurn({active:{...note,aiIntent:next,interaction:turn.interaction},text:'Mañana a las diez',interpretation:{...next,date:'2026-08-27',time:'10:00',missingFields:[],question:null}});
    assert.equal(continued.interaction.status,'pending_confirmation');
    assert.equal(continued.interpretation.title,'Llamar a Miguel Ibiza');
    assert.equal(continued.interaction.sourceEntryId,'call');
  }
});

test('agenda: cancelar el ID seleccionado refresca la misma consulta y bloquea doble clic',async()=>{
  const note={id:'query',proposal:{intent:'calendar.query'}};
  let result={events:[{id:'one'},{id:'two'}]},release;
  const calls=[];
  const google={getCalendarResult:()=>result,
    deleteCalendarEvent:async(n,id)=>{calls.push(['delete',n.id,id]);await new Promise(r=>release=r);result=undefined},
    searchCalendar:async n=>{assert.equal(n,note);calls.push('search');result={events:[{id:'one'}]}}
  };
  const cancel=createAgendaActions({google,onDeleted:id=>calls.push(['deleted',id]),showWorking:()=>calls.push('working'),showList:n=>calls.push(['list',n.id])});
  await cancel(note,'missing');assert.deepEqual(calls,[]);
  const first=cancel(note,'two');await cancel(note,'two');release();await first;
  assert.deepEqual(calls,[['delete','query','two'],['deleted','two'],'working','search',['list','query']]);
  assert.deepEqual(result.events,[{id:'one'}]);
});

test('agenda: rechazar o fallar el borrado conserva la lista sin marcar éxito',async()=>{
  for(const mode of ['cancel','error']){
    const result={events:[{id:'one'}]},calls=[];
    const cancel=createAgendaActions({google:{getCalendarResult:()=>result,deleteCalendarEvent:async()=>{if(mode==='error')throw Error('red')},searchCalendar:()=>calls.push('search')},
      onDeleted:()=>calls.push('deleted'),showWorking:()=>{},showList:()=>calls.push('list')});
    const operation=cancel({id:'query',proposal:{intent:'calendar.query'}},'one');
    if(mode==='error')await assert.rejects(operation,/red/);else await operation;
    assert.deepEqual(calls,['list']);assert.equal(result.events.length,1);
  }
});

test('los listados limitan el modal y desplazan solo el contenido, conservando el cierre',()=>{
  const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(css,/\.action-modal:not\(\.conversation-modal\)\{[^}]*max-height:calc\(100% - 48px\)[^}]*overflow:hidden/);
  assert.match(css,/#modalBody\{[^}]*min-height:0;overflow-y:auto/);
  assert.match(css,/>\.modal-actions\{flex-shrink:0\}/);
});

test('el modal conversacional conserva micrófono propio y cabe en el viewport visible', t => {
  class Element {
    constructor() { this.children=[]; this.classList={values:new Set(),add:(...names)=>names.forEach(name=>this.classList.values.add(name)),remove:(...names)=>names.forEach(name=>this.classList.values.delete(name)),contains:name=>this.classList.values.has(name)}; this.blurCount=0; this.focusCount=0; }
    set innerHTML(value) { this.children=[]; this.html=value; }
    append(...children) { this.children.push(...children); }
    blur() { this.blurCount++; }
    focus() { this.focusCount++; }
  }
  const elements=new Map();
  const old=globalThis.document;
  globalThis.document={createElement:()=>new Element(),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)}};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old});
  t.mock.method(globalThis,'setTimeout',()=>0);
  let spoken=0;
  const ui=createUI({getMedia:async()=>null});
  ui.showDraft({onMic:()=>spoken++});
  const actions=elements.get('modalActions').children;
  const draft=elements.get('modalBody').children[0];
  assert.deepEqual(actions.map(button=>button.textContent),['Ahora no','🎙️ Hablar','➤ Enviar']);
  assert.ok(elements.get('actionModal').classList.contains('conversation-modal'));
  assert.equal(draft.focusCount,0);
  actions[1].onclick();
  assert.equal(draft.blurCount,1);
  assert.equal(spoken,1);
  const css=readFileSync(new URL('../styles-flow.css',import.meta.url),'utf8');
  assert.match(css,/--angeli-viewport-height,100dvh/);
  assert.match(css,/--angeli-viewport-top,0px/);
  assert.match(css,/\.modal-actions \.voice/);
});

test('evento y recordatorio comparten ficha editable sin añadir pasos al guardado normal', t => {
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.classList={add(){},remove(){},contains(){return false}}}
    set innerHTML(value){this.children=[];this.html=value}
    append(...children){this.children.push(...children)}
    blur(){}
  }
  const elements=new Map(),old=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)}};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old});
  t.mock.method(globalThis,'setTimeout',()=>0);
  const ui=createUI({getMedia:async()=>null});
  const event={id:'calendar-card',type:'calendar',text:'Cena con María mañana a las nueve en San Marcos de Gandía',scheduledDate:'2026-08-28',scheduledTime:'21:00',calendarTitle:'Cena con María',location:'San Marcos de Gandía',proposal:{intent:'calendar.create'}};
  ui.showEntryAction(event);
  assert.match(elements.get('modalBody').html,/Título que guardaré/);
  assert.match(elements.get('modalBody').html,/Cena con María/);
  assert.match(elements.get('modalBody').html,/San Marcos de Gandía/);
  assert.match(elements.get('modalBody').html,/Sin descripción/);
  const actions=elements.get('modalActions').children;
  assert.deepEqual(actions.map(button=>button.textContent),['Cancelar','Cambiar título','Añadir descripción','📅 Añadir']);
  assert.equal(actions[3].dataset.a,'calendar');

  let saved=null,micTarget=null;
  ui.showCalendarFieldEditor(event,'description',{onSave:value=>saved=value,onMic:id=>micTarget=id,onCancel:()=>{}});
  const editor=elements.get('modalBody').children[0],draft=editor.children[0],controls=editor.children[1];
  draft.value='Preparar el aniversario';
  controls.children[0].onclick();
  controls.children[1].onclick();
  assert.equal(micTarget,'calendarFieldDraft');
  assert.equal(saved,'Preparar el aniversario');

  const reminder={...reminderFixture(),aiIntent:{...reminderFixture().aiIntent,notes:null},proposal:{intent:'reminder.create'}};
  ui.showEntryAction(reminder);
  assert.match(elements.get('modalBody').html,/Llamar a Miguel Ibiza/);
  assert.deepEqual(elements.get('modalActions').children.map(button=>button.textContent),['Cancelar','Cambiar título','Añadir descripción','⏰ Programar']);
});
import { markCancelledReminder } from '../js/pending.js';

test('tras cancelar en Calendar solo deja de estar pendiente el recordatorio elegido',()=>{
  const entries=[1,2,3].map(i=>({id:`note-${i}`,type:'reminder',status:'pending',text:'Llamar a Miguel Ibiza',
    interaction:{status:'completed'},schedule:{status:'scheduled',calendarEventId:`event-${i}`}}));
  const updated=markCancelledReminder(entries,'event-2');
  assert.deepEqual(findReminderMatches(updated,{target:{title:'Miguel Ibiza'}}).map(e=>e.id),['note-1','note-3']);
  assert.equal(entries[1].schedule.status,'scheduled');
  assert.equal(updated[0],entries[0]);
  assert.equal(updated[2],entries[2]);
});

test('los resultados son seleccionables y piden confirmar el ID elegido antes de cancelar', t => {
  class Element {
    constructor(tag='div') { this.tagName=tag; this.children=[]; this.dataset={}; this.classList={add(){},remove(){},contains(){return false}}; }
    set innerHTML(value) { this.children=[]; this.html=value; }
    append(...children) { this.children.push(...children); }
  }
  const elements=new Map();
  const old=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag), getElementById:id=>{
    if(!elements.has(id))elements.set(id,new Element());return elements.get(id);
  }};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old});
  t.mock.method(globalThis,'setTimeout',()=>0);
  const ui=createUI({getMedia:async()=>null});
  ui.showEntryAction({id:'call-choice',type:'contact',text:'Llamar a Miguel',proposal:{intent:'contact.call'}},{getContactResult:()=>null});
  const callActions=elements.get('modalActions').children;
  assert.deepEqual(callActions.map(b=>b.textContent),['Ahora no','📞 Llamar ahora','Crear recordatorio','Agendar llamada']);
  assert.equal(callActions[1].dataset.a,'search-contact');
  assert.equal(callActions[2].dataset.a,'defer-call-reminder');
  assert.equal(callActions[3].dataset.a,'defer-call-calendar');
  const entries=[1,2,3].map(i=>({id:`reminder-${i}`,text:'Llamar a Miguel Ibiza',schedule:{status:'scheduled',dueAt:`2026-08-${26+i}T10:00:00`}}));
  let selected=null;
  ui.showReminderResults(entries,'Miguel Ibiza',{onSelect:entry=>{selected=entry;ui.showReminderCancellation(entry)}});
  const buttons=elements.get('modalBody').children[0].children;
  assert.equal(buttons.length,3);
  assert.ok(buttons.every(button=>button.tagName==='button'));
  assert.equal(selected,null);
  buttons[1].onclick();
  assert.equal(selected.id,'reminder-2');
  assert.equal(elements.get('modalTitle').textContent,'¿Cancelar este recordatorio?');
  const confirm=elements.get('modalActions').children[1];
  assert.equal(confirm.dataset.id,'reminder-2');
  assert.equal(confirm.dataset.a,'cancel-schedule');
  assert.ok(entries.every(entry=>entry.schedule.status==='scheduled'));
  ui.showEntryAction({id:'search',text:'Anula llamada a Miguel Ibiza',proposal:{intent:'calendar.delete'},aiIntent:{target:{title:'Miguel Ibiza'}}},
    {getCalendarResult:()=>({events:[]})});
  assert.match(elements.get('modalLead').textContent,/90 días/);
  assert.equal(elements.get('modalBody').children[0].children[0].children[0].type,'date');
  assert.equal(elements.get('modalActions').children[1].dataset.a,'search-calendar-date');
  const query={id:'agenda',text:'Qué tengo mañana',type:'calendar',proposal:{intent:'calendar.query'}};
  const google={getCalendarResult:()=>({events:[{id:'event-1',summary:'Cena <Carlos>',when:'27 ago, 23:00'},{id:'event-2',summary:'Llamar a Miguel',when:'28 ago, 10:00'}]})};
  ui.showEntryAction(query,google);
  const html=elements.get('modalBody').html;
  assert.equal((html.match(/data-a="agenda-view"/g)||[]).length,2);
  assert.equal((html.match(/data-a="agenda-delete"/g)||[]).length,2);
  assert.match(html,/Cena &lt;Carlos&gt;/);
  assert.match(html,/data-event-id="event-2"/);
  ui.showCalendarEvent(query,google,'event-2');
  assert.equal(elements.get('modalTitle').textContent,'Llamar a Miguel');
  assert.equal(elements.get('modalActions').children[1].dataset.eventId,'event-2');
  elements.get('modalActions').children[0].onclick();
  assert.match(elements.get('modalBody').html,/Cena &lt;Carlos&gt;/);
  const update={id:'update',text:'Pasa la llamada de Miguel al viernes a las 11',proposal:{intent:'calendar.update',actionStatus:'pending_confirmation'},aiIntent:{target:{title:'Miguel'},changes:{date:'2026-08-28',time:'11:00'}}};
  ui.showEntryAction(update,{getCalendarResult:()=>({events:[{id:'event-1',summary:'Llamar a Miguel',when:'27 ago, 09:00'},{id:'event-2',summary:'Llamar a Miguel Ibiza',when:'27 ago, 10:00'}]})});
  assert.equal(elements.get('modalTitle').textContent,'Modificar evento');
  assert.equal((elements.get('modalBody').html.match(/data-a="calendar-update"/g)||[]).length,2);
  assert.match(elements.get('modalBody').html,/data-event-id="event-2"/);
  ui.showEntryAction({...update,proposal:{...update.proposal,actionStatus:'completed'}},{getCalendarResult:()=>null});
  assert.equal(elements.get('modalTitle').textContent,'Evento modificado');
});

test('cancelar por nombre busca sin exigir día ni hora, incluso si la IA los pide', () => {
  const parsed = localCalendarCancellation('Anula llamada a Miguel Ibiza');
  assert.equal(parsed.intent, 'calendar.delete');
  assert.equal(parsed.target.title, 'Miguel Ibiza');
  const result = resolveConversationTurn({text:'Anula llamada a Miguel Ibiza',
    interpretation:{...parsed,source:'ai',missingFields:['date','time'],question:'¿Qué día y a qué hora?'}});
  assert.equal(result.interaction.status,'pending_confirmation');
  assert.deepEqual(result.interaction.missingFields,[]);
  assert.equal(result.interaction.question,null);
  assert.equal(localCalendarCancellation('Borra los datos del dispositivo'),null);
  assert.equal(localCalendarCancellation('Recuérdame llamar a Miguel'),null);
  const unknown = resolveConversationTurn({text:'Cancela',interpretation:{...parsed,target:null}});
  assert.deepEqual(unknown.interaction.missingFields,['target']);
});

test('anular cita con Miguel encuentra una quedada por la persona, no por la categoría literal', () => {
  for (const phrase of [
    'Anula cita con Miguel',
    'Cancela quedada con Miguel',
    'Borra reunión con Miguel',
    'Anula cena con Miguel'
  ]) {
    const parsed = localCalendarCancellation(phrase);
    assert.equal(parsed.intent, 'calendar.delete');
    assert.equal(buildCalendarSearch(parsed, 'calendar.delete').query, 'Miguel');
  }
});

test('no lo sé no convierte una cancelación activa en una consulta sin acciones', () => {
  const original=localCalendarCancellation('Anula llamada a Miguel Ibiza');
  const active={aiIntent:original,interaction:{status:'awaiting_input'}};
  for(const intent of ['reminder.query','calendar.query','note']) {
    const next=preserveCancellation(active,{intent,source:'ai',target:null});
    assert.equal(next.intent,'calendar.delete');
    assert.equal(next.target.title,original.target.title);
    assert.equal(resolveConversationTurn({active,text:'No lo sé',interpretation:next}).interaction.status,'pending_confirmation');
  }
  assert.equal(preserveCancellation(null,{intent:'reminder.query'}).intent,'reminder.query');
  assert.equal(preserveCancellation(active,{intent:'contact.call'}).intent,'contact.call');
});

test('BUG 3: mañana y pasado mañana son días distintos desde el 26/08/2026', () => {
  const now = new Date(2026, 7, 26, 12);
  for (const [phrase, expected] of [['mañana','2026-08-27'],['pasado mañana','2026-08-28']]) {
    const text = `Recuérdame llamar a Carlos Ferrer ${phrase} a las once de la mañana`;
    assert.equal(temporalData(text,now).scheduledDate, expected);
    assert.equal(temporalData(text,now).scheduledTime, '11:00');
    assert.equal(calendarQueryRange(`Qué tengo ${phrase}`,now).rangeStart, expected);
    assert.equal(normalizeReminderSchedule({intent:'reminder.create',date:'2026-08-27',time:'11:00'},text,now).date, expected);
  }
});

test('fechas relativas cruzan mes/año y de la mañana no es un día', () => {
  assert.equal(temporalData('pasado mañana',new Date(2026,7,31,12)).scheduledDate,'2026-09-02');
  assert.equal(temporalData('pasado mañana',new Date(2026,11,31,12)).scheduledDate,'2027-01-02');
  assert.equal(temporalData('hoy a las diez de la mañana',new Date(2026,7,26,8)).scheduledDate,'2026-08-26');
  assert.equal(temporalData('a las once de la mañana',new Date(2026,7,26,8)).scheduledDate,undefined);
});

test('P05 conserva Miguel Ibiza aunque la IA omita contactName', () => {
  assert.equal(fixtureTitle(), 'Llamar a Miguel Ibiza');
  const note = reminderFixture();
  const payload = scheduledReminderEvent(note);
  assert.equal(payload.summary, 'Llamar a Miguel Ibiza');
  assert.equal(payload.description, 'Confirmar presupuesto');
  assert.equal(payload.start.dateTime, '2026-08-27T10:00:00');
  assert.equal(payload.end.dateTime, '2026-08-27T11:00:00');
  assert.equal(payload.start.timeZone, 'Europe/Madrid');
  assert.equal(note.schedule.action.contactName, 'Miguel Ibiza');
  assert.equal(scheduleTitle({...note, schedule:{...note.schedule, action:{kind:'contact.call'}}}), payload.summary);
});

test('la ficha confirmada es exactamente el payload de Calendar para evento y recordatorio', () => {
  const event={id:'event-confirmation',type:'calendar',text:'Cena con María mañana a las nueve en San Marcos de Gandía',
    scheduledDate:'2026-08-28',scheduledTime:'21:00',calendarTitle:'Cena con María',location:'San Marcos de Gandía',
    calendarDescription:'Hablar del aniversario',aiIntent:{intent:'calendar.create',title:'Cena con María',notes:null}};
  assert.deepEqual(calendarDetails(event),{
    title:'Cena con María',description:'Hablar del aniversario',location:'San Marcos de Gandía',
    when:new Date('2026-08-28T21:00:00').toLocaleString('es-ES',{dateStyle:'full',timeStyle:'short'})
  });
  assert.deepEqual(calendarEvent(event),{
    id:'angelieventconfirmation',summary:'Cena con María',description:'Hablar del aniversario',location:'San Marcos de Gandía',
    start:{dateTime:'2026-08-28T21:00:00',timeZone:'Europe/Madrid'},end:{dateTime:'2026-08-28T22:00:00',timeZone:'Europe/Madrid'}
  });

  const base=reminderFixture();
  const reminder=updateCalendarDetails(updateCalendarDetails({...base,location:'Oficina de Miguel'},'title','Quedar con Miguel'),'description','Revisar el presupuesto');
  const details=calendarDetails(reminder),payload=scheduledReminderEvent(reminder);
  assert.equal(details.title,'Quedar con Miguel');
  assert.equal(details.description,'Revisar el presupuesto');
  assert.equal(payload.summary,details.title);
  assert.equal(payload.description,details.description);
  assert.equal(payload.location,details.location);
});

test('tener una persona no transforma quedar con Miguel en una llamada', () => {
  const text='Tengo que quedar con Miguel mañana a las nueve';
  const ai={intent:'reminder.create',title:'Quedar con Miguel',contactName:'Miguel',date:'2026-08-28',time:'09:00',notes:null};
  const note={id:'meet-miguel',type:'reminder',text,aiIntent:ai,schedule:scheduleFor(ai,text)};
  assert.equal(note.schedule.action.kind,'reminder');
  assert.equal(calendarDetails(note).title,'Quedar con Miguel');
  assert.equal(scheduledReminderEvent(note).summary,'Quedar con Miguel');
});

test('Firestore conserva la descripción confirmada de eventos y recordatorios', () => {
  const event={id:'event-description',type:'calendar',calendarTitle:'Cena con María',calendarDescription:'Mesa junto a la ventana'};
  const eventCloud=toCloudEntry(event,'2026-08-27T12:00:00.000Z');
  assert.equal(eventCloud.calendarDescription,'Mesa junto a la ventana');
  assert.equal(fromCloudEntry(eventCloud,event.id).calendarDescription,'Mesa junto a la ventana');

  const reminder={id:'reminder-description',type:'reminder',schedule:{status:'pending_confirmation',title:'Quedar con Miguel',description:'Llevar el presupuesto'}};
  const reminderCloud=toCloudEntry(reminder,'2026-08-27T12:00:00.000Z');
  assert.equal(reminderCloud.schedule.description,'Llevar el presupuesto');
  assert.equal(fromCloudEntry(reminderCloud,reminder.id).schedule.description,'Llevar el presupuesto');
});

test('P05 respeta nombre explícito, título IA y recordatorios que no son llamadas', () => {
  const note = reminderFixture();
  for (const title of ['Llamar a Miguel Ibiza', note.text]) {
    const ai = {...note.aiIntent, title};
    assert.equal(scheduleTitle({...note, aiIntent:ai, schedule:scheduleFor(ai,note.text)}), 'Llamar a Miguel Ibiza');
  }
  const ai = {...note.aiIntent, contactName:'Miguel Ibiza oficina'};
  assert.equal(scheduleTitle({...note, aiIntent:ai, schedule:scheduleFor(ai,note.text)}), 'Llamar a Miguel Ibiza oficina');
  assert.equal(scheduleTitle({text:'Comprar pan', schedule:{action:{kind:'reminder'}}}), 'Comprar pan');
  assert.equal(scheduleTitle({text:'Llamar', schedule:{action:{kind:'contact.call',phone:'123456789'}}}), 'Llamar a 123456789');
});

const NOW = "2026-08-24T08:00:00.000Z";

test("la consulta de recordatorios usa IA y mantiene un fallback de solo lectura", async () => {
  const response = { ...localReminderQuery("¿Qué recordatorios tengo de Miguel?"), confidence: .96 };
  const live = await interpret("¿Qué recordatorios tengo de Miguel?", { provider: async () => response });
  assert.equal(live.source, "ai");
  assert.equal(live.intent, "reminder.query");
  const fallback = await interpret("¿Qué recordatorios tengo de Miguel?", {
    provider: async () => { throw new Error("IA no disponible"); }, fallback: localReminderQuery,
  });
  assert.equal(fallback.source, "fallback");
  assert.equal(fallback.target.title, "Miguel");
  assert.equal(localReminderQuery("¿Qué recordatorios tengo?").target, null);
  assert.equal(localReminderQuery("Recuérdame llamar a Miguel"), null);
  assert.equal(localReminderQuery("Ya he llamado a Miguel"), null);
});

function intent(overrides = {}) {
  return {
    intent: "reminder.create",
    confidence: 0.96,
    title: "Llamar a Pepe",
    date: "2026-08-25",
    time: null,
    rangeStart: null,
    rangeEnd: null,
    location: null,
    contactName: "Pepe",
    phone: null,
    notes: null,
    target: null,
    changes: null,
    missingFields: ["time"],
    question: "¿A qué hora quieres que te lo recuerde?",
    requiresConfirmation: true,
    source: "ai",
    fallbackReason: null,
    ...overrides,
  };
}

test("P01 pregunta solo la hora que falta y mantiene abierta la operación", () => {
  const turn = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });

  assert.equal(turn.interaction.status, INTERACTION_STATUS.AWAITING_INPUT);
  assert.deepEqual(turn.interaction.missingFields, ["time"]);
  assert.equal(turn.interaction.question, "¿A qué hora quieres que te lo recuerde?");
  assert.equal(turn.interpretation.date, "2026-08-25");
});

test("P02 una respuesta corta completa la misma operación sin cambiar su intención", () => {
  const first = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });
  const active = {
    id: "entry-p01",
    date: NOW,
    aiIntent: first.interpretation,
    interaction: first.interaction,
  };
  const second = resolveConversationTurn({
    active,
    text: "A las doce",
    interpretation: intent({
      intent: "note",
      confidence: 0.5,
      title: null,
      date: null,
      time: "12:00",
      contactName: null,
      missingFields: [],
      question: null,
      source: "fallback",
      fallbackReason: "service_unavailable",
    }),
    now: "2026-08-24T08:01:00.000Z",
  });

  assert.equal(second.continuing, true);
  assert.equal(second.interpretation.intent, "reminder.create");
  assert.equal(second.interpretation.date, "2026-08-25");
  assert.equal(second.interpretation.time, "12:00");
  assert.equal(second.interaction.status, INTERACTION_STATUS.PENDING_CONFIRMATION);
  assert.equal(second.interaction.id, first.interaction.id);
});

test("un recordatorio completo no hace una pregunta innecesaria", () => {
  const turn = resolveConversationTurn({
    active: null,
    text: "Recuérdame mañana a las doce llamar a Pepe",
    interpretation: intent({ time: "12:00", missingFields: [], question: null }),
    now: NOW,
  });

  assert.equal(turn.interaction.status, INTERACTION_STATUS.PENDING_CONFIRMATION);
  assert.deepEqual(turn.interaction.missingFields, []);
  assert.equal(turn.interaction.question, null);
});

test("cancelar y completar cierran la interacción activa", () => {
  const first = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });
  const entry = { id: "entry-p01", interaction: first.interaction };

  assert.equal(cancelInteraction(entry, NOW).interaction.status, INTERACTION_STATUS.CANCELLED);
  assert.equal(completeInteraction(entry, NOW).interaction.status, INTERACTION_STATUS.COMPLETED);
  assert.equal(findActiveInteraction([cancelInteraction(entry, NOW)]), null);
});

test("el contexto enviado a la IA contiene solo el estado conversacional necesario", () => {
  const first = resolveConversationTurn({
    active: null,
    text: "Mañana tengo que llamar a Pepe",
    interpretation: intent(),
    now: NOW,
  });
  const context = contextFor({ interaction: first.interaction });

  assert.equal(context.intent, "reminder.create");
  assert.deepEqual(context.missingFields, ["time"]);
  assert.deepEqual(context.collectedData, {
    title: "Llamar a Pepe",
    date: "2026-08-25",
    contactName: "Pepe",
  });
  assert.equal(context.turns.at(-1).text, "Mañana tengo que llamar a Pepe");
});

test("una llamada con día pero sin hora se convierte en recordatorio y pregunta la hora", () => {
  const normalized = normalizeReminderSchedule(normalizeFutureCall(intent({
    intent: "contact.call",
    date: "2026-08-25",
    time: null,
    missingFields: [],
    question: null,
  }), "Llama a Pepe mañana"), "Llama a Pepe mañana", new Date(NOW));
  const turn = resolveConversationTurn({ active: null, text: "Llama a Pepe mañana", interpretation: normalized, now: NOW });

  assert.equal(turn.interpretation.intent, "reminder.create");
  assert.deepEqual(turn.interaction.missingFields, ["time"]);
  assert.equal(turn.interaction.question, "¿A qué hora?");
});

test("una llamada con hora pero sin día programa la próxima ocurrencia", () => {
  const normalized = normalizeReminderSchedule(normalizeFutureCall(intent({
    intent: "contact.call",
    date: null,
    time: "19:00",
    missingFields: [],
    question: null,
  }), "Llama a Pepe a las siete"), "Llama a Pepe a las siete", new Date(NOW));

  assert.equal(normalized.intent, "reminder.create");
  assert.equal(normalized.date, "2026-08-24");
  assert.equal(normalized.time, "19:00");
});

test("una llamada sin referencia temporal sigue siendo inmediata", () => {
  const immediate = intent({ intent: "contact.call", date: null, time: null });
  assert.equal(normalizeFutureCall(immediate, "Llama a Pepe").intent, "contact.call");
});

test("P03 completa el único pendiente existente sin crear otra entrada", async () => {
  const pending = { id: "task-miguel", text: "Llamar a Miguel", type: "reminder", status: "pending", interaction: { status: "completed" }, schedule: { status: "scheduled", title: "Llamar a Miguel", calendarEventId: "calendar-miguel" } };
  const interpretation = await mockProvider("Ya he llamado a Miguel");
  const matches = findPendingMatches([pending], interpretation);

  assert.equal(interpretation.intent, "task.complete");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, pending.id);
  const removed = [];
  const completed = await completePendingWithCalendar(matches[0], async entry => removed.push(entry.schedule.calendarEventId), NOW);
  assert.deepEqual(removed, ["calendar-miguel"]);
  assert.equal(completed.status, "done");
  assert.equal(completed.interaction.status, INTERACTION_STATUS.COMPLETED);
  assert.equal(completed.schedule.status, "completed");
});

test("P03 no marca el pendiente como completado si Calendar no puede retirar el aviso", async () => {
  const pending = { id: "task-miguel", text: "Llamar a Miguel", type: "reminder", status: "pending", interaction: { status: "completed" }, schedule: { status: "scheduled", calendarEventId: "calendar-miguel" } };
  await assert.rejects(
    completePendingWithCalendar(pending, async () => { throw new Error("Calendar no disponible"); }, NOW),
    /Calendar no disponible/
  );
  assert.equal(pending.status, "pending");
  assert.equal(pending.schedule.status, "scheduled");
});

test("P03 pide elegir cuando existen varios pendientes coincidentes", () => {
  const entries = [
    { id: "one", text: "Llamar a Miguel", type: "task", status: "pending" },
    { id: "two", text: "Llamar a Miguel por el presupuesto", type: "reminder", status: "pending" },
    { id: "done", text: "Llamar a Miguel", type: "task", status: "done" },
  ];
  assert.deepEqual(findPendingMatches(entries, { target: { title: "Miguel" } }).map(entry => entry.id), ["one", "two"]);
});

test("P03 extrae el objetivo y no inventa coincidencias", () => {
  assert.equal(completionTarget("Ya he llamado a Miguel."), "Miguel");
  assert.deepEqual(findPendingMatches([{ id: "pepe", text: "Llamar a Pepe", type: "task", status: "pending" }], { target: { title: "Miguel" } }), []);
});

test("la consulta posterior a P03 devuelve solo el recordatorio pendiente que queda", () => {
  const entries = [
    { id: "miguel", text: "Llamar a Miguel", type: "reminder", status: "done", schedule: { status: "completed", title: "Llamar a Miguel" } },
    { id: "ibiza", text: "Llamar a Miguel Ibiza", type: "reminder", status: "pending", interaction: { status: "completed" }, schedule: { status: "scheduled", title: "Llamar a Miguel Ibiza" } },
    { id: "task", text: "Preparar presupuesto de Miguel", type: "task", status: "pending" },
  ];

  assert.deepEqual(findReminderMatches(entries, { target: { title: "Miguel" } }).map(entry => entry.id), ["ibiza"]);
});

test("consultar todos los recordatorios excluye cancelados y completados sin mutar entradas", () => {
  const entries = [
    { id: "one", type: "reminder", status: "pending", text: "Llamar a Miguel", interaction: { status: "completed" }, schedule: { status: "scheduled" } },
    { id: "two", type: "reminder", status: "pending", text: "Llamar a Miguel Ibiza" },
    { id: "cancelled", type: "reminder", status: "pending", schedule: { status: "cancelled" } },
    { id: "completed", type: "reminder", status: "pending", schedule: { status: "completed" } },
  ];
  const original = JSON.stringify(entries);
  assert.deepEqual(findReminderMatches(entries, { title: "Qué recordatorios tengo" }).map(entry => entry.id), ["one", "two"]);
  assert.deepEqual(findReminderMatches(entries, { target: { title: "Miguel Ibiza" } }).map(entry => entry.id), ["two"]);
  assert.deepEqual(findReminderMatches(entries, { target: { title: "Pepe" } }), []);
  assert.equal(JSON.stringify(entries), original);
});

test("un aviso borrado fuera de Angeli deja de aparecer como pendiente", () => {
  const entries = [
    { id: "deleted", type: "reminder", status: "pending", interaction: { status: "completed" }, schedule: { status: "scheduled", calendarEventId: "gone" } },
    { id: "active", type: "reminder", status: "pending", interaction: { status: "completed" }, schedule: { status: "scheduled", calendarEventId: "alive" } },
  ];
  const reconciled = reconcileReminderEntries(entries, new Map([["gone", false], ["alive", true]]));
  assert.equal(reconciled[0].status, "done");
  assert.equal(reconciled[0].schedule.status, "cancelled");
  assert.equal(reconciled[0].schedule.externalChange, true);
  assert.equal(reconciled[1], entries[1]);
  assert.deepEqual(findReminderMatches(reconciled, {}), [entries[1]]);
});
