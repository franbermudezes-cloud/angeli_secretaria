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
import { calendarDetails, linkedScheduleFor, normalizeFutureCall, normalizeReminderSchedule, scheduleFor, scheduleTitle, updateCalendarDetails, updateCalendarDateTime } from "../js/schedule.js";
import { completionTarget, completePending, completePendingWithCalendar, findPendingMatches, findReminderMatches } from "../js/pending.js";
import { mockProvider, interpret, localCalendarUpdate, localLinkedCalendarIntent, localReminderQuery, localNoteQuery, protectCalendarInterpretation, protectReadQuery, validateIntent } from "../js/ai.js";
import { fixtureTitle, reminderFixture } from './reminder-event-fixture.mjs';
import { applyCalendarUpdateToEntries, buildCalendarSearch, calendarEvent, scheduledReminderEvent, listAllCalendarPages, reconcileReminderEntries, linkedReminderSearch, calendarEventsForIntent } from '../js/google.js';
import { fromCloudEntry, toCloudEntry } from '../js/cloud-entry.js';
import { findNoteMatches, normalizeNoteClassification, removeNoteEntry, updateNoteDraft, updateNoteStatus } from '../js/notes.js';
import { addNoteSetting, applyExplicitNoteCategory, normalizeNoteSettings, noteInterpretationContext, removeNoteSetting, renameNoteSetting, settingLabel } from '../js/note-settings.js';
import { shortcutPrefix, shortcutSemantics, shortcutType } from '../js/shortcuts.js';

test('una petición normal sin acceso directo no intenta leer action de null',()=>{
  assert.equal(shortcutType(null),null);
  assert.equal(shortcutPrefix(null),'');
  assert.deepEqual(shortcutSemantics(null),{action:null,direct:false});
});

test('gestor: notas y recordatorios respetan este mes y ventanas de días',()=>{
  const now=new Date(2026,8,3,12),month=naturalQueryRange('dime las notas de este mes',now),last=naturalQueryRange('últimos 30 días',now),next=naturalQueryRange('próximos 60 días',now);
  assert.deepEqual(month,{rangeStart:'2026-09-01',rangeEnd:'2026-10-01'});
  assert.deepEqual(last,{rangeStart:'2026-08-04',rangeEnd:'2026-09-04'});
  assert.deepEqual(next,{rangeStart:'2026-09-03',rangeEnd:'2026-11-03'});
  assert.equal(localNoteQuery('Dime todas las notas que tengo de este mes').noteQuery,null);
  assert.equal(localReminderQuery('Dime los recordatorios de los próximos 60 días').target,null);
  const notes=[{id:'aug',type:'note',date:'2026-08-31',status:'pending',noteClassification:{}},{id:'sep',type:'note',date:'2026-09-02',status:'pending',noteClassification:{}}];
  assert.deepEqual(findNoteMatches(notes,{...month,noteStatus:'pending'}).map(item=>item.id),['sep']);
  const reminders=[{id:'past',type:'reminder',status:'pending',schedule:{status:'scheduled',dueAt:'2026-08-01T10:00:00'}},{id:'future',type:'reminder',status:'pending',schedule:{status:'scheduled',dueAt:'2026-09-20T10:00:00'}}];
  assert.deepEqual(findReminderMatches(reminders,next).map(item=>item.id),['future']);
});

test('consultas directas: «ver» y la petición breve nunca se guardan como nota',()=>{
  const doneNotes=localNoteQuery('Ver las notas que tenemos hechas');
  assert.equal(doneNotes.intent,'note.query');
  assert.equal(doneNotes.noteStatus,'done');
  assert.equal(localReminderQuery('Ver recordatorios pendientes').intent,'reminder.query');
  assert.equal(localReminderQuery('Recordatorios').intent,'reminder.query');
  assert.equal(localReminderQuery('Mis recordatorios pendientes').intent,'reminder.query');
  const wrongRemote={intent:'note',confidence:.99,title:'Recordatorios',source:'ai'};
  assert.equal(protectReadQuery(wrongRemote,null,localReminderQuery('Recordatorios')).intent,'reminder.query');
  assert.equal(protectReadQuery(wrongRemote,localNoteQuery('Ver las notas que tenemos hechas')).noteStatus,'done');
  assert.equal(localNoteQuery('Guarda esta lista de notas de la reunión'),null);
});

test('consultar recordatorios sin resultados muestra el estado vacío y no crea entrada',()=>{
  const query=localReminderQuery('Ver recordatorios pendientes');
  assert.deepEqual(findReminderMatches([],query),[]);
  const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8');
  assert.match(ui,/No hay recordatorios pendientes/);
  assert.match(ui,/No tienes recordatorios pendientes/);
});

test('gestor: los tres listados abren fichas editables y conservan scroll',()=>{
  const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8'),css=readFileSync(new URL('../styles-flow.css',import.meta.url),'utf8'),app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.match(ui,/showNoteDetail/);assert.match(ui,/showReminderDetail/);assert.match(ui,/showCalendarEventEditor/);
  assert.match(ui,/Abrir ficha/);assert.match(ui,/Modificar recordatorio/);assert.match(ui,/Modificar evento/);
  assert.match(app,/updateScheduledReminder/);assert.match(app,/updateListedCalendarEvent/);
  assert.match(css,/\.manager-row/);assert.match(css,/\.record-editor/);
});

test('las preguntas pendientes de Gemini siempre se presentan en español',()=>{
  const event=validateIntent({intent:'calendar.create',confidence:.95,title:null,date:'2026-09-03',time:'18:00',missingFields:['title'],question:'What is the title of the event?',requiresConfirmation:true});
  assert.equal(event.question,'¿Qué título quieres poner al evento?');
  assert.equal(validateIntent({...event,missingFields:['date'],question:'What day is it?'}).question,'¿Para qué día es?');
  assert.equal(validateIntent({...event,missingFields:['time'],question:'What time?'}).question,'¿A qué hora?');
  assert.equal(validateIntent({...event,missingFields:['location'],question:'Where is it?'}).question,'¿Dónde es?');
  assert.equal(validateIntent({...event,intent:'contact.call',missingFields:['contactName'],question:'Who?'}).question,'¿Con quién quieres contactar?');
});

test('notas: clasifica sin bloquear y conserva los metadatos en Firestore',()=>{
  const classification=normalizeNoteClassification({scope:'company',relationType:'project',relationName:'Karaoke',purpose:'Revisar el precio de las licencias',tags:['licencias','presupuesto','licencias']});
  const entry={id:'note-karaoke',type:'note',text:'Apunta para el proyecto Karaoke que debemos revisar el precio de las licencias',noteClassification:classification,aiIntent:{intent:'note',title:'Precio de las licencias',noteClassification:classification}};
  assert.deepEqual(classification,{scope:'company',relationType:'project',relationName:'Karaoke',purpose:'Revisar el precio de las licencias',tags:['licencias','presupuesto']});
  assert.deepEqual(fromCloudEntry(toCloudEntry(entry),entry.id).noteClassification,classification);
});

test('notas: una consulta natural no crea una nota y encuentra por relación, texto y etiqueta',()=>{
  const query=localNoteQuery('Qué notas tengo del proyecto Karaoke');
  assert.equal(query.intent,'note.query');
  assert.equal(query.noteQuery,'proyecto Karaoke');
  const entries=[
    {id:'one',type:'note',status:'pending',date:'2026-08-30',text:'Revisar licencias',aiIntent:{title:'Precio de las licencias'},noteClassification:{scope:'company',relationType:'project',relationName:'Proyecto Karaoke',purpose:null,tags:['presupuesto']}},
    {id:'two',type:'note',status:'pending',date:'2026-08-29',text:'Comprar pintura',aiIntent:{title:'Pintura del salón'},noteClassification:{scope:'personal',relationType:'none',relationName:null,purpose:null,tags:['casa']}},
  ];
  assert.deepEqual(findNoteMatches(entries,query).map(entry=>entry.id),['one']);
  assert.deepEqual(findNoteMatches(entries,{noteQuery:'presupuesto'}).map(entry=>entry.id),['one']);
});

test('notas: consultar todas o solo las personales aplica el filtro expresado',()=>{
  const entries=[
    {id:'company',type:'note',status:'pending',noteClassification:{scope:'company',relationType:'none',tags:[]}},
    {id:'personal',type:'note',status:'pending',noteClassification:{scope:'personal',relationType:'none',tags:[]}},
  ];
  assert.equal(findNoteMatches(entries,localNoteQuery('Muéstrame mis notas')).length,2);
  assert.deepEqual(findNoteMatches(entries,localNoteQuery('Muéstrame mis notas personales')).map(entry=>entry.id),['personal']);
});

test('notas: la PWA muestra clasificación al guardar y un listado desplazable al consultar',()=>{
  const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../styles-flow.css',import.meta.url),'utf8');
  const baseCss=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(ui,/✓ Nota guardada/);
  assert.match(ui,/showNoteResults\(matches, query/);
  assert.match(ui,/Relacionada con/);
  assert.match(css,/\.note-result/);
  assert.match(baseCss,/\.action-modal:not\(\.conversation-modal\) #modalBody\{[^}]*overflow-y:auto/);
});

test('notas: el borrador permite corregir toda la ficha antes de guardarla',()=>{
  const original={id:'draft-note',type:'note',text:'Comprar pintura',aiIntent:{intent:'note',title:'Pintura'},noteClassification:{scope:'general',relationType:'none',tags:[]}};
  const updated=updateNoteDraft(original,{title:'Pintura del salón',text:'Comprar pintura azul',scope:'personal',relationType:'project',relationName:'Reforma de casa',purpose:'Preparar el salón',tags:'casa, compra, casa'});
  assert.equal(updated.aiIntent.title,'Pintura del salón');
  assert.equal(updated.text,'Comprar pintura azul');
  assert.deepEqual(updated.noteClassification,{scope:'personal',relationType:'project',relationName:'Reforma de casa',purpose:'Preparar el salón',tags:['casa','compra']});
  const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8');
  assert.match(app,/proposal\.intent==="note"[\s\S]*reviewNoteDraft\(entry\)[\s\S]*return/);
  assert.match(ui,/Nada se guardará hasta que confirmes/);
  assert.match(ui,/Guardar nota/);
});

test('ajustes de notas: categorías y relaciones son flexibles y sincronizables',()=>{
  let settings=normalizeNoteSettings();
  settings=addNoteSetting(settings,'categories','Clientes VIP');
  settings=addNoteSetting(settings,'relationTypes','Proveedor');
  const category=settings.categories.find(option=>option.label==='Clientes VIP');
  const relation=settings.relationTypes.find(option=>option.label==='Proveedor');
  assert.ok(category?.id);assert.ok(relation?.id);
  settings=renameNoteSetting(settings,'categories',category.id,'Clientes preferentes');
  assert.equal(settingLabel(settings,'categories',category.id),'Clientes preferentes');
  settings=removeNoteSetting(settings,'relationTypes',relation.id);
  assert.equal(settings.relationTypes.some(option=>option.id===relation.id),false);
  const customNote={id:'custom-category',type:'note',status:'pending',text:'Revisar vencimiento',noteClassification:{scope:category.id,categoryLabel:'Clientes preferentes',relationType:'none',tags:[]}};
  assert.deepEqual(findNoteMatches([customNote],{noteQuery:'Clientes preferentes'}),[customNote]);
  const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
  const firebase=JSON.parse(readFileSync(new URL('../firebase.json',import.meta.url),'utf8'));
  assert.match(rules,/users\/\{userId\}\/settings\/\{settingId\}/);
  assert.match(rules,/request\.auth\.uid == userId/);
  assert.equal(firebase.firestore[0].database,'angelifirebase');
  assert.equal(firebase.firestore[0].rules,'firestore.rules');
});

test('notas: «anota en Bodas» usa la categoría personalizada y no la duplica como relación',()=>{
  const settings=addNoteSetting(normalizeNoteSettings(),'categories','Bodas');
  const bodas=settings.categories.find(option=>option.label==='Bodas');
  const mistaken={intent:'note',title:'Comprar una máquina',noteClassification:{scope:'general',relationType:'event',relationName:'Bodas',purpose:null,tags:[]}};
  const fixed=applyExplicitNoteCategory(mistaken,'Anota en Bodas que tenemos que comprar una máquina',settings);
  assert.equal(fixed.noteClassification.scope,bodas.id);
  assert.equal(fixed.noteClassification.categoryLabel,'Bodas');
  assert.equal(fixed.noteClassification.relationType,'none');
  assert.equal(fixed.noteClassification.relationName,null);
  const context=noteInterpretationContext(null,settings);
  assert.deepEqual(context.noteSettings.categories.find(option=>option.id===bodas.id),bodas);
});

test('notas: una relación explícita con Bodas no se convierte en categoría',()=>{
  const settings=addNoteSetting(normalizeNoteSettings(),'categories','Bodas');
  const interpretation={intent:'note',title:'Llamar al fotógrafo',noteClassification:{scope:'general',relationType:'event',relationName:'Bodas',purpose:null,tags:[]}};
  assert.deepEqual(applyExplicitNoteCategory(interpretation,'Relaciona esta nota con Bodas: llamar al fotógrafo',settings),interpretation);
});

test('notas: ciclo completo permite editar, completar, consultar hechas, reabrir y borrar',()=>{
  const created={id:'lifecycle-note',type:'note',status:'pending',text:'Comprar ruedas para butano',aiIntent:{intent:'note',title:'Comprar ruedas para butano'},noteClassification:{scope:'general',relationType:'none',tags:[]}};
  const edited=updateNoteDraft(created,{title:'Comprar ruedas del carro del butano',text:'Comprar dos ruedas',scope:'personal',relationType:'none',tags:'compra, casa'});
  assert.equal(edited.aiIntent.title,'Comprar ruedas del carro del butano');
  assert.equal(edited.text,'Comprar dos ruedas');
  const done=updateNoteStatus(edited,'done');
  assert.equal(findNoteMatches([done],localNoteQuery('Muéstrame mis notas pendientes')).length,0);
  assert.deepEqual(findNoteMatches([done],localNoteQuery('Muéstrame mis notas hechas')),[done]);
  const reopened=updateNoteStatus(done,'pending');
  assert.deepEqual(findNoteMatches([reopened],localNoteQuery('Muéstrame todas las notas')),[reopened]);
  assert.deepEqual(removeNoteEntry([reopened],reopened.id),[]);
});

test('notas: el validador conserva estados permitidos y rechaza estados desconocidos',()=>{
  const query=localNoteQuery('Muéstrame mis notas hechas');
  assert.equal(validateIntent(query).noteStatus,'done');
  assert.throws(()=>validateIntent({...query,noteStatus:'deleted'}),/Estado de nota IA no válido/);
});

test('notas: los resultados consultados ofrecen edición, estado y borrado confirmado',()=>{
  const ui=readFileSync(new URL('../js/ui.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  assert.match(ui,/note-result-actions/);
  assert.match(ui,/edit\.textContent = "Editar"/);
  assert.match(ui,/showNoteDeleteConfirmation/);
  assert.match(app,/const toggle=[\s\S]*updateNoteStatus/);
  assert.match(app,/const remove=[\s\S]*showNoteDeleteConfirmation/);
});

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

test('modificar la hora con una persona elimina el campo del objetivo de búsqueda',()=>{
  const text='Cámbiame la hora con María';
  const local=localCalendarUpdate(text,new Date(2026,7,26,12));
  assert.equal(local.target.title,'María');
  const remote={intent:'calendar.update',confidence:.95,target:{title:'hora con María',date:null,time:null},changes:null,requiresConfirmation:true,source:'ai'};
  const routed=protectCalendarInterpretation(remote,local);
  assert.equal(routed.target.title,'María');
  assert.equal(buildCalendarSearch(routed,'calendar.update').query,'María');
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
import { temporalData, calendarQueryRange, naturalQueryRange } from '../js/temporal.js';
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
  assert.deepEqual(actions.map(button=>button.textContent),['Cancelar','Cambiar título','Cambiar fecha y hora','Cambiar ubicación','Añadir descripción','📅 Añadir']);
  assert.equal(actions[3].dataset.field,'location');
  assert.equal(actions[5].dataset.a,'calendar');

  let saved=null,micTarget=null;
  ui.showCalendarFieldEditor(event,'description',{onSave:value=>saved=value,onMic:id=>micTarget=id,onCancel:()=>{}});
  const editor=elements.get('modalBody').children[0],draft=editor.children[0],controls=editor.children[1];
  draft.value='Preparar el aniversario';
  controls.children[0].onclick();
  controls.children[1].onclick();
  assert.equal(micTarget,'calendarFieldDraft');
  assert.equal(saved,'Preparar el aniversario');

  ui.showCalendarFieldEditor({...event,location:null},'location',{onSave:value=>saved=value,onMic:id=>micTarget=id,onCancel:()=>{}});
  const locationEditor=elements.get('modalBody').children[0],locationDraft=locationEditor.children[0];
  assert.equal(locationDraft.placeholder,'Di o escribe el recinto o dirección…');
  locationDraft.value='Complejo San Marcos de Gandía';
  locationEditor.children[1].children[1].onclick();
  assert.equal(saved,'Complejo San Marcos de Gandía');
  assert.equal(updateCalendarDetails(event,'location',saved).location,'Complejo San Marcos de Gandía');

  let changedWhen=null;
  ui.showCalendarDateTimeEditor(event,{onSave:value=>changedWhen=value,onCancel:()=>{}});
  const dateEditor=elements.get('modalBody').children[0];
  assert.equal(dateEditor.children[0].children[0].value,'2026-08-28');
  assert.equal(dateEditor.children[1].children[0].value,'21:00');
  dateEditor.children[0].children[0].value='2026-08-29';
  dateEditor.children[1].children[0].value='22:15';
  dateEditor.children[2].onclick();
  assert.deepEqual(changedWhen,{date:'2026-08-29',time:'22:15'});

  const reminder={...reminderFixture(),aiIntent:{...reminderFixture().aiIntent,notes:null},proposal:{intent:'reminder.create'}};
  ui.showEntryAction(reminder);
  assert.match(elements.get('modalBody').html,/Llamar a Miguel Ibiza/);
  assert.deepEqual(elements.get('modalActions').children.map(button=>button.textContent),['Cancelar','Cambiar título','Cambiar fecha y hora','Añadir ubicación','Añadir descripción','⏰ Programar']);

  const linked={...event,schedule:{dueAt:'2026-08-26T21:00:00',title:'Comprobar el equipo',status:'pending_confirmation'},calendarStatus:'pending'};
  ui.showEntryAction(linked);
  assert.match(elements.get('modalBody').html,/Cena con María/);
  assert.match(elements.get('modalBody').html,/Aviso vinculado/);
  assert.match(elements.get('modalBody').html,/Comprobar el equipo/);
  assert.deepEqual(elements.get('modalActions').children.map(button=>button.textContent),['Cancelar','Cambiar título','Cambiar fecha y hora','Cambiar aviso','Cambiar ubicación','Añadir descripción','📅 Crear los dos']);
  assert.equal(elements.get('modalActions').children[6].dataset.a,'calendar-bundle');
});

test('evento y recordatorio permiten corregir fecha y hora antes de guardar',()=>{
  const event={id:'event-date',scheduledDate:'2026-09-14',scheduledTime:'18:00',aiIntent:{date:'2026-09-14',time:'18:00'},proposal:{intent:'calendar.create'}};
  const changedEvent=updateCalendarDateTime(event,'2026-09-15','19:30');
  assert.equal(changedEvent.scheduledDate,'2026-09-15');
  assert.equal(changedEvent.scheduledTime,'19:30');
  assert.deepEqual([changedEvent.aiIntent.date,changedEvent.aiIntent.time],['2026-09-15','19:30']);

  const reminder={id:'reminder-date',scheduledDate:'2026-09-10',scheduledTime:'10:00',aiIntent:{date:'2026-09-10',time:'10:00'},proposal:{intent:'reminder.create'},schedule:{dueAt:'2026-09-10T10:00:00'}};
  const changedReminder=updateCalendarDateTime(reminder,'2026-09-11','11:15');
  assert.equal(changedReminder.schedule.dueAt,'2026-09-11T11:15:00');

  const linked={...event,aiIntent:{...event.aiIntent,linkedReminder:{title:'Preparar equipo',date:'2026-09-12',time:'18:00'}},schedule:{dueAt:'2026-09-12T18:00:00'},proposal:{intent:'calendar.create'}};
  const changedLinked=updateCalendarDateTime(linked,'2026-09-20','20:00');
  assert.equal(changedLinked.schedule.dueAt,'2026-09-18T20:00:00');
  assert.deepEqual([changedLinked.aiIntent.linkedReminder.date,changedLinked.aiIntent.linkedReminder.time],['2026-09-18','20:00']);
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

test("un aviso modificado fuera de Angeli actualiza título, descripción, fecha y hora", () => {
  const entry = {
    id: "external-update", type: "reminder", status: "pending",
    scheduledDate: "2026-09-04", scheduledTime: "10:00",
    aiIntent: { intent: "reminder.create", title: "Revisar equipo", date: "2026-09-04", time: "10:00" },
    schedule: { status: "scheduled", calendarEventId: "calendar-update", dueAt: "2026-09-04T10:00:00", title: "Revisar equipo", description: "", calendarUrl: "" }
  };
  const event = {
    id: "calendar-update", summary: "Montar equipo de la boda", description: "Llevar cableado nuevo",
    start: { dateTime: "2026-09-05T18:30:00+02:00" }, htmlLink: "https://calendar/evento", updated: "2026-08-30T09:15:00.000Z"
  };
  const [updated] = reconcileReminderEntries([entry], new Map([[event.id, { exists: true, event }]]));
  assert.equal(updated.schedule.title, "Montar equipo de la boda");
  assert.equal(updated.schedule.description, "Llevar cableado nuevo");
  assert.equal(updated.schedule.dueAt, "2026-09-05T18:30:00");
  assert.equal(updated.scheduledDate, "2026-09-05");
  assert.equal(updated.scheduledTime, "18:30");
  assert.equal(updated.aiIntent.title, "Montar equipo de la boda");
  assert.equal(updated.schedule.calendarUrl, "https://calendar/evento");
  assert.equal(updated.schedule.externalChange, true);
});

test("P05 conserva evento y recordatorio relativo como una operación vinculada", () => {
  const text="Tenemos una boda el 14 de septiembre a las 6 de la tarde en el Complejo San Marcos de Gandía. Recuérdame dos días antes comprobar el equipo.";
  const interpretation=localLinkedCalendarIntent(text,new Date(2026,7,27,12));
  assert.equal(interpretation.intent,"calendar.create");
  assert.equal(interpretation.title,"Boda");
  assert.equal(interpretation.date,"2026-09-14");
  assert.equal(interpretation.time,"18:00");
  assert.equal(interpretation.location,"el Complejo San Marcos de Gandía");
  assert.deepEqual(interpretation.linkedReminder,{title:"Comprobar el equipo de la boda en el Complejo San Marcos de Gandía",date:"2026-09-12",time:"18:00"});
  const validated=validateIntent(interpretation);
  const schedule=linkedScheduleFor(validated);
  const note={id:"p05-linked",text,type:"calendar",scheduledDate:validated.date,scheduledTime:validated.time,location:validated.location,calendarTitle:validated.title,aiIntent:validated,proposal:{intent:"calendar.create"},calendarStatus:"pending",schedule};
  assert.equal(calendarEvent(note).summary,"Boda");
  assert.equal(calendarEvent(note).location,"el Complejo San Marcos de Gandía");
  assert.equal(scheduledReminderEvent(note).summary,"Comprobar el equipo de la boda en el Complejo San Marcos de Gandía");
  assert.equal(scheduledReminderEvent(note).start.dateTime,"2026-09-12T18:00:00");
  assert.equal(updateCalendarDetails(note,"reminderTitle","Revisar todo el equipo").schedule.title,"Revisar todo el equipo");
  assert.equal(updateCalendarDetails(note,"title","Boda de Ana").calendarTitle,"Boda de Ana");
  assert.equal(updateCalendarDetails(note,"description","Llevar iluminación").calendarDescription,"Llevar iluminación");
  assert.equal(updateCalendarDetails(note,"title","Boda de Ana").schedule.title,"Comprobar el equipo de la boda en el Complejo San Marcos de Gandía");
  assert.equal(updateCalendarDetails(note,"location","Masía X").location,"Masía X");
  assert.deepEqual(findReminderMatches([note],{}),[note]);
  assert.equal(toCloudEntry(note).schedule.title,"Comprobar el equipo de la boda en el Complejo San Marcos de Gandía");
});

test("P05 protege título, ubicación y aviso contextual frente a una respuesta remota defectuosa", () => {
  const text="Tenemos una boda el 14 de septiembre a las 6 de la tarde en el complejo San Marcos de Gandía, recuérdame dos días antes comprobar el equipo.";
  const local=localLinkedCalendarIntent(text,new Date(2026,7,27,12));
  const remote={...local,title:"Boda complejo San Marcos de Gandía",location:null,linkedReminder:{title:"Comprobar el equipo",date:"2026-09-12",time:"18:00"}};
  const protectedIntent=protectCalendarInterpretation(remote,local);
  assert.equal(protectedIntent.title,"Boda");
  assert.equal(protectedIntent.location,"el complejo San Marcos de Gandía");
  assert.equal(protectedIntent.linkedReminder.title,"Comprobar el equipo de la boda en el complejo San Marcos de Gandía");
});

test("P05 cancelar el evento principal cancela también su aviso y no lo ofrece como otra boda", () => {
  const bundle={id:"bundle",calendarEventId:"boda-1",calendarStatus:"synced",schedule:{calendarEventId:"aviso-1",relatedEventId:"boda-1",status:"scheduled",calendarUrl:"https://calendar/aviso"}};
  const query={id:"query",proposal:{intent:"calendar.delete"}};
  const next=applyCalendarUpdateToEntries([bundle,query],query,"boda-1","delete");
  assert.equal(next[0].calendarStatus,"cancelled");
  assert.equal(next[0].schedule.status,"cancelled");
  assert.equal(next[0].schedule.calendarUrl,"");
  const items=[
    {id:"boda-1",summary:"Boda",status:"confirmed",start:{dateTime:"2026-09-14T18:00:00"}},
    {id:"aviso-1",summary:"Comprobar el equipo de la boda",status:"confirmed",start:{dateTime:"2026-09-12T18:00:00"},extendedProperties:{private:{angeliRelatedEventId:"boda-1"}}}
  ];
  assert.deepEqual(calendarEventsForIntent(items,"calendar.delete").map(item=>item.id),["boda-1"]);
  assert.deepEqual(calendarEventsForIntent(items,"calendar.query").map(item=>item.id),["boda-1","aviso-1"]);
  assert.equal(linkedReminderSearch("boda-1").get("privateExtendedProperty"),"angeliRelatedEventId=boda-1");
});

test("P05 prioriza la estructura vinculada y respeta una hora matinal explícita", () => {
  const action=localLinkedCalendarIntent("Tenemos una boda el 14 de septiembre a las seis. Recuérdame dos días antes cambiar las pilas.",new Date(2026,7,27,12));
  assert.equal(action.intent,"calendar.create");
  assert.equal(action.linkedReminder.title,"Cambiar las pilas de la boda");
  const morning=localLinkedCalendarIntent("Tenemos una boda el 14 de septiembre a las seis de la mañana. Recuérdame dos días antes comprobar el equipo.",new Date(2026,7,27,12));
  assert.equal(morning.time,"06:00");
  assert.equal(morning.linkedReminder.time,"06:00");
});

test("P05 entiende tienes que avisarme y pregunta la hora sin convertir la orden en nota", () => {
  const text="Disco móvil para el día 5 de septiembre en el Complejo San Marcos de Gandía. Tienes que avisarme un día antes para ir a montar el equipo.";
  const initial=localLinkedCalendarIntent(text,new Date(2026,7,27,12));
  assert.equal(initial.intent,"calendar.create");
  assert.equal(initial.title,"Disco móvil");
  assert.equal(initial.date,"2026-09-05");
  assert.equal(initial.time,null);
  assert.equal(initial.location,"el Complejo San Marcos de Gandía");
  assert.deepEqual(initial.missingFields,["time"]);
  assert.equal(initial.question,"¿A qué hora es el evento?");
  assert.deepEqual(initial.linkedReminder,{title:"Ir a montar el equipo del disco móvil en el Complejo San Marcos de Gandía",date:"2026-09-04",time:null});
  const first=resolveConversationTurn({text,interpretation:validateIntent(initial),now:"2026-08-27T12:00:00.000Z"});
  assert.equal(first.interaction.status,"awaiting_input");
  const active={id:"discomovil",text,aiIntent:first.interpretation,interaction:first.interaction};
  const completed=resolveConversationTurn({active,text:"A las seis de la tarde",interpretation:{...initial,intent:"note",title:"A las seis de la tarde",time:"18:00",linkedReminder:null,missingFields:[],question:null,source:"ai"},now:"2026-08-27T12:01:00.000Z"});
  assert.equal(completed.interpretation.intent,"calendar.create");
  assert.equal(completed.interpretation.title,"Disco móvil");
  assert.equal(completed.interpretation.time,"18:00");
  assert.equal(completed.interpretation.linkedReminder.time,"18:00");
  assert.equal(completed.interaction.status,"pending_confirmation");
  assert.ok(linkedScheduleFor(completed.interpretation));
});
