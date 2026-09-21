import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dietarioEntries, groupDietarioByDay } from "../js/dietario.js";

const now = new Date("2026-09-15T09:00:00");

const notes = [
  { id: "cal1", type: "calendar", scheduledDate: "2026-09-15", scheduledTime: "10:00", calendarTitle: "Revisión con Laura", calendarStatus: "synced", location: "Oficina" },
  { id: "rem1", type: "reminder", status: "pending", schedule: { dueAt: "2026-09-15T12:30:00", status: "scheduled", action: { kind: "reminder" }, title: "Llamar al dentista" } },
  { id: "note1", type: "note", status: "pending", date: "2026-09-10T08:00:00", text: "Idea: renovar contrato", aiIntent: { title: "Renovar contrato" }, noteClassification: { scope: "casa", categoryLabel: "Casa" }, images: [{ id: "i1" }] },
  { id: "cal2", type: "calendar", scheduledDate: "2026-09-17", scheduledTime: "21:00", calendarTitle: "Cena con Marta", calendarStatus: "synced" },
  { id: "note2", type: "note", status: "pending", date: "2026-09-01T08:00:00", text: "Comprar regalo cumpleaños Ana" },
  { id: "note3", type: "note", status: "done", date: "2026-09-01T08:00:00", text: "Nota ya resuelta" },
  { id: "remCancelled", type: "reminder", status: "pending", schedule: { dueAt: "2026-09-15T08:00:00", status: "cancelled", action: { kind: "reminder" }, title: "Aviso cancelado" } },
  { id: "calFuture", type: "calendar", scheduledDate: "2026-09-30", scheduledTime: "09:00", calendarTitle: "Fuera de la semana", calendarStatus: "synced" },
  { id: "calQuery1", type: "calendar", status: "pending", date: "2026-09-14T08:00:00", text: "¿Qué tengo la semana que viene?", aiIntent: { intent: "calendar.query" }, proposal: { intent: "calendar.query" } },
  { id: "remPast", type: "reminder", status: "pending", schedule: { dueAt: "2026-09-10T09:00:00", status: "scheduled", action: { kind: "reminder" }, title: "Renovar el seguro del coche" } },
  { id: "calPast", type: "calendar", scheduledDate: "2026-09-05", scheduledTime: "17:00", calendarTitle: "Revisión pasada sin resolver", calendarStatus: "synced" }
];

const entries = dietarioEntries(notes);
assert.equal(entries.length, 8, "una nota hecha, un aviso cancelado y una consulta de calendario no deben considerarse activos");
assert.ok(!entries.some(item => item.id === "remCancelled"));
// Regresión real reportada por el usuario: preguntar por la agenda (incluidos
// los accesos "Hoy"/"Próxima semana") deja una entrada permanente sin fecha
// que se acumulaba en "Sin fecha" cada vez que se repetía la misma consulta,
// porque nunca se marca como hecha ni lleva calendarStatus. No es un evento
// real y no debe ocupar un hueco en el Dietario.
assert.ok(!entries.some(item => item.id === "calQuery1"), "una consulta de calendario (aiIntent.intent==='calendar.query') no debe aparecer en el Dietario");
assert.ok(!entries.some(item => item.id === "note3"), "una nota hecha no debe aparecer en el dietario");

const cal1 = entries.find(item => item.id === "cal1");
assert.equal(cal1.rail, "calendar");
assert.equal(cal1.title, "Revisión con Laura");
assert.equal(cal1.dateKey, "2026-09-15");
assert.equal(cal1.time, "10:00");

const rem1 = entries.find(item => item.id === "rem1");
assert.equal(rem1.rail, "reminder");
assert.equal(rem1.title, "Llamar al dentista");
assert.equal(rem1.dateKey, "2026-09-15");

const note1 = entries.find(item => item.id === "note1");
assert.equal(note1.rail, "note");
assert.equal(note1.dated, false, "una nota sin fecha programada va a la sección sin fecha");
assert.equal(note1.attachmentCount, 1);

const week = groupDietarioByDay(notes, { now, range: "week" });
assert.equal(week.days.length, 2, "solo los días dentro de la semana con elementos deben aparecer");
assert.equal(week.days[0].dateKey, "2026-09-15");
assert.equal(week.days[0].isToday, true);
assert.equal(week.days[0].items.length, 2);
assert.equal(week.days[0].items[0].id, "cal1", "los elementos de un día se ordenan por hora");
assert.equal(week.days[0].items[1].id, "rem1");
assert.ok(!week.days.some(day => day.dateKey === "2026-09-30"), "el rango semanal no incluye eventos fuera de la semana");
assert.equal(week.undated.length, 2);

const all = groupDietarioByDay(notes, { now, range: "all" });
assert.ok(all.days.some(day => day.dateKey === "2026-09-30"), "el rango 'todo' sí incluye eventos futuros lejanos");
assert.ok(!all.days.some(day => day.dateKey === "2026-09-10" || day.dateKey === "2026-09-05"), "ni siquiera 'todo' mira hacia el pasado: para eso está el rango 'pending'");

// Nuevo rango pedido por el propietario: "Pendientes o anteriores" — lo
// atrasado y activo (no cancelado ni completado) que ningún otro rango
// enseña porque todos miran solo hacia delante desde hoy.
const pending = groupDietarioByDay(notes, { now, range: "pending" });
assert.ok(!pending.days.some(day => day.dateKey === "2026-09-15" || day.dateKey === "2026-09-17" || day.dateKey === "2026-09-30"), "el rango 'pending' no debe repetir lo que ya se ve en hoy/semana/todo");
assert.deepEqual(pending.days.map(day => day.dateKey), ["2026-09-10", "2026-09-05"], "de más reciente a más antiguo, para ver primero lo más urgente de recuperar");
assert.equal(pending.days[0].items[0].id, "remPast");
assert.equal(pending.days[1].items[0].id, "calPast");
assert.equal(pending.undated.length, 2, "lo sin fecha también cuenta como pendiente");

const today = groupDietarioByDay(notes, { now, range: "today" });
assert.equal(today.days.length, 1);
assert.equal(today.days[0].items.length, 2);

const onlyCalendar = groupDietarioByDay(notes, { now, range: "all", type: "calendar" });
assert.ok(onlyCalendar.days.every(day => day.items.every(item => item.rail === "calendar")));
assert.equal(onlyCalendar.undated.length, 0, "el filtro por tipo también se aplica a la sección sin fecha");

const [html, app, serviceWorker, ui, css, google] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
  readFile(new URL("../js/ui.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
  readFile(new URL("../js/google.js", import.meta.url), "utf8")
]);
assert.match(html, /id="dietarioOpen"/);
assert.match(html, /id="dietarioLibrary"/);
assert.match(html, /id="dietarioList"/);
assert.match(html, /id="dietarioRangeFilters"/);
assert.match(html, /id="dietarioTypeFilters"/);
assert.match(app, /openDietario/);
assert.match(serviceWorker, /js\/dietario\.js/);
assert.match(ui, /groupDietarioByDay/);

// Regresión: los chips del dietario deben delegar el clic en su propio
// contenedor, no en un onclick por botón, porque el manejador genérico de
// `.filter` se ejecuta después y sobrescribía ese onclick (los filtros no
// hacían nada). Reutilizar la clase `.filter` tampoco vale: ese mismo
// manejador global vacía el estado "active" de TODOS los chips `.filter`
// del documento en cada clic.
assert.match(app, /\$\("dietarioRangeFilters"\)\.onclick/);
assert.match(app, /\$\("dietarioTypeFilters"\)\.onclick/);
assert.doesNotMatch(app, /#dietarioLibrary \[data-dietario-range\]/);
assert.doesNotMatch(app, /#dietarioLibrary \[data-dietario-type\]/);
assert.match(html, /class="dietario-filter/);
assert.doesNotMatch(html, /class="filter" data-dietario-(?:range|type)/);
assert.match(css, /\.dietario-filter/);
assert.match(css, /\.library-filters\{[^}]*overflow-x:auto/);

// Botón "⋮" en cada línea del dietario: acceso rápido a marcar como hecho
// o eliminar sin abrir la ficha completa. Una pulsación larga por temporizador
// resultó nada fiable en dispositivos reales (el gesto de scroll de la lista
// competía con el temporizador), así que se sustituye por un botón explícito.
assert.match(app, /openDietarioQuickActions/);
assert.match(app, /data-dietario-quick/);
assert.doesNotMatch(app, /pointerdown/);
assert.match(ui, /data-dietario-quick/);

// Regresión real en dispositivo: el botón "⋮" medía 26x26px, por debajo del
// tamaño táctil mínimo recomendado (44px iOS / 48px Android), así que el
// dedo fallaba el botón y abría la ficha normal en su lugar. Un primer
// arreglo lo dejó en 40x40px, todavía por debajo del mínimo citado aquí
// mismo (hallado en revisión externa antes de fusionar); ahora son 44x44px.
const quickButtonCss = css.match(/\.dietario-quick\{[^}]*\}/)?.[0] || "";
assert.ok(quickButtonCss, "debe existir la regla .dietario-quick");
const quickWidth = Number(quickButtonCss.match(/width:(\d+)px/)?.[1] || 0);
const quickHeight = Number(quickButtonCss.match(/height:(\d+)px/)?.[1] || 0);
assert.ok(quickWidth >= 44, `el botón "⋮" debe medir al menos 44px de ancho (mide ${quickWidth}px)`);
assert.ok(quickHeight >= 44, `el botón "⋮" debe medir al menos 44px de alto (mide ${quickHeight}px)`);

// Regresión: abrir "Avisos" desde el dietario cerraba el modal solo a los
// 1.8s porque reutilizaba showEntryAction (pensado para una confirmación
// justo tras crear algo, no para repasar algo ya existente). "Adjuntos"
// caía en el mensaje genérico de showEntryAction ("La entrada se ha
// guardado en tu conversación"), que ni siquiera es cierto para el dietario.
assert.match(ui, /function showDietarioDetail/);
const openDietarioEntrySource = app.match(/function openDietarioEntry\(id\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(openDietarioEntrySource, "openDietarioEntry debe existir");
assert.doesNotMatch(openDietarioEntrySource, /showEntryAction\(entry,google\)/, "el dietario ya no debe reutilizar la pantalla de confirmación transitoria showEntryAction");
assert.match(openDietarioEntrySource, /ui\.showDietarioDetail\(entry,\{onEdit:openDietarioCalendarMenu,onCancelEvent:cancelDietarioEvent,onCancelSchedule:cancelDietarioReminder,onDelete:deleteDietarioEntry\}\)/);
assert.match(openDietarioEntrySource, /mediaLibraryItems\(\[entry\]\)/, "las entradas de tipo foto/archivo deben abrir su ficha real de adjunto, no la genérica");

// Regresión real reportada por el usuario: openDietarioQuickActions abre el
// menú de "eliminar/marcar como hecho" con ui.openModal() sin cerrar antes
// #dietarioLibrary (a diferencia del resto de fichas, que sí lo cierran
// primero). Como #dietarioLibrary comparte la clase .media-library
// (z-index:8, por delante de .action-modal en z-index:6), el modal quedaba
// tapado detrás del propio Dietario y era imposible pulsar "Eliminar" sin
// cerrar antes el Dietario y perder el sitio en la lista.
const dietarioLibraryZ = Number(css.match(/#dietarioLibrary\{[^}]*z-index:(\d+)/)?.[1] ?? css.match(/\.media-library\{[^}]*z-index:(\d+)/)?.[1] ?? -1);
const actionModalZForDietario = Number(css.match(/\.action-modal\{[^}]*z-index:(\d+)/)?.[1] || -1);
assert.ok(dietarioLibraryZ >= 0 && actionModalZForDietario >= 0, "deben existir ambas reglas de z-index");
assert.ok(dietarioLibraryZ < actionModalZForDietario, `#dietarioLibrary (z-index ${dietarioLibraryZ}) debe quedar por detrás de .action-modal (z-index ${actionModalZForDietario}) para que el menú rápido sea visible y pulsable con el Dietario abierto`);

// Pedido explícito del propietario: un botón "+" dentro del propio Dietario
// con las mismas acciones de añadir de siempre (evento/aviso/nota/imagen/
// adjunto), para no tener que salir a buscarlas.
assert.match(html, /id="dietarioAdd"/);
assert.match(app, /function openDietarioAddMenu\(\)/);
assert.match(app, /\$\("dietarioAdd"\)\.onclick=openDietarioAddMenu/);
const addMenuSource = app.match(/function openDietarioAddMenu\(\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(addMenuSource, "openDietarioAddMenu debe existir");
assert.match(addMenuSource, /openNewEventDraft\(\)/, "añadir evento reutiliza la misma función de siempre");
assert.match(addMenuSource, /action:"reminder\.create"/, "añadir aviso reutiliza el mismo atajo de siempre");
assert.match(addMenuSource, /action:"note"/, "añadir nota reutiliza el mismo atajo de siempre");
assert.match(addMenuSource, /\$\("photoInput"\)\.click\(\)/, "añadir imagen reutiliza el mismo input de siempre");
assert.match(addMenuSource, /\$\("fileInput"\)\.click\(\)/, "añadir adjunto reutiliza el mismo input de siempre");

// Regresión evitada: dos botones sueltos en una cabecera con
// justify-content:space-between (comprobado en el navegador) quedan
// repartidos por todo el ancho en vez de juntos junto al de cerrar —
// deben ir agrupados en su propio contenedor, como ya hace .header-actions.
assert.match(html, /class="library-header-actions"><button id="dietarioAdd"/);
assert.match(css, /\.library-header-actions\{[^}]*display:flex/);

// Nuevo filtro de rango pedido explícitamente: "Pendientes o anteriores".
assert.match(html, /data-dietario-range="pending"/);
assert.match(ui, /function groupDietarioByDay|groupDietarioByDay/);

// Fricción reportada por el propietario: el Dietario solo dejaba "Cerrar" al
// abrir un evento o aviso ya confirmado — editarlo o cancelarlo exigía ir a
// Recordatorios/Calendario aparte y volver a buscarlo. Ahora reutiliza los
// editores de campo/fecha-hora ya existentes, pero sincronizando también con
// Calendar por el id ya guardado en la entrada, no solo el estado local.
assert.match(ui, /function showDietarioDetail\(note, \{ onEdit, onCancelEvent, onCancelSchedule, onDelete \} = \{\}\)/, "showDietarioDetail debe aceptar las nuevas acciones");
assert.match(ui, /if \(onDelete\) actions\.push\(\{ label: "🗑️ Eliminar"/, "la ficha del Dietario debe ofrecer siempre eliminar, para no dejar sin salida una entrada que falló al sincronizar");
assert.match(ui, /eventEditable[\s\S]{0,40}note\.calendarStatus === "synced"/, "un evento suelto o combinado solo se puede modificar/anular si ya está sincronizado de verdad en Calendar");
assert.match(ui, /reminderEditable[\s\S]{0,40}note\.schedule\?\.status === "scheduled"/, "un aviso solo se puede modificar/cancelar si sigue programado");
assert.match(ui, /"Anular evento"/);
assert.match(ui, /"Cancelar aviso"/);
assert.match(app, /ui\.showDietarioDetail\(entry,\{onEdit:openDietarioCalendarMenu,onCancelEvent:cancelDietarioEvent,onCancelSchedule:cancelDietarioReminder,onDelete:deleteDietarioEntry\}\)/);
const calendarMenuSource = app.match(/function openDietarioCalendarMenu\(note\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(calendarMenuSource, "openDietarioCalendarMenu debe existir");
assert.match(calendarMenuSource, /Cambiar título/);
assert.match(calendarMenuSource, /Cambiar fecha y hora/);
assert.match(calendarMenuSource, /bundled\?\[\{label:"Cambiar aviso"/, "un evento+aviso combinados también debe poder cambiar el título del aviso, no solo el del evento");
const fieldEditorSource = app.match(/function openDietarioCalendarFieldEditor\(note,field\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(fieldEditorSource, "openDietarioCalendarFieldEditor debe existir");
assert.match(fieldEditorSource, /google\.updateSyncedCalendarEntry\(next\)/, "guardar un cambio desde el Dietario debe sincronizar con Calendar, no solo con el estado local");
const dateTimeEditorSource = app.match(/function openDietarioCalendarDateTimeEditor\(note\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(dateTimeEditorSource, "openDietarioCalendarDateTimeEditor debe existir");
assert.match(dateTimeEditorSource, /google\.updateSyncedCalendarEntry\(next\)/);
const cancelEventSource = app.match(/async function cancelDietarioEvent\(note\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(cancelEventSource, "cancelDietarioEvent debe existir");
assert.match(cancelEventSource, /google\.cancelSyncedCalendarEvent\(note\)/);
const cancelReminderSource = app.match(/async function cancelDietarioReminder\(note\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(cancelReminderSource, "cancelDietarioReminder debe existir");
assert.match(cancelReminderSource, /google\.cancelScheduledReminder\(note\)/, "cancelar el aviso desde el Dietario reutiliza la misma función ya usada desde Recordatorios");
assert.match(google, /async function updateSyncedCalendarEntry\(note\)\{/);
assert.match(google, /async function cancelSyncedCalendarEvent\(note\)\{/);
assert.match(google, /updateSyncedCalendarEntry,\s*\n\s*cancelSyncedCalendarEvent,/, "las dos funciones deben exportarse desde createGoogleIntegration");

// 2ª auditoría: las cancelaciones del Dietario usaban confirm() nativo y no
// comprobaban si la operación falló. Ahora confirman con el modal propio y
// solo dan por hecha la cancelación si google.* devolvió true.
assert.doesNotMatch(cancelEventSource, /confirm\(/, "cancelDietarioEvent ya no debe usar el confirm() nativo");
assert.doesNotMatch(cancelReminderSource, /confirm\(/, "cancelDietarioReminder ya no debe usar el confirm() nativo");
assert.match(cancelEventSource, /ui\.openModal\(\{title:"¿Anular este evento\?"/, "debe confirmar con el modal propio");
assert.match(cancelEventSource, /const ok=await google\.cancelSyncedCalendarEvent\(note\);\s*\n\s*if\(!ok\)/, "debe comprobar si la cancelación del evento falló");
assert.match(cancelReminderSource, /const ok=await google\.cancelScheduledReminder\(note\);\s*\n\s*if\(!ok\)/, "debe comprobar si la cancelación del aviso falló");
assert.match(google, /notify\("Evento cancelado"\);\s*\n\s*return true;/, "cancelSyncedCalendarEvent debe devolver true al éxito");
assert.match(google, /notify\("Aviso cancelado"\);\s*\n\s*return true;/, "cancelScheduledReminder debe devolver true al éxito");

console.log("dietario: ok");
