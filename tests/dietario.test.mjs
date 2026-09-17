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
  { id: "calFuture", type: "calendar", scheduledDate: "2026-09-30", scheduledTime: "09:00", calendarTitle: "Fuera de la semana", calendarStatus: "synced" }
];

const entries = dietarioEntries(notes);
assert.equal(entries.length, 6, "una nota hecha y un aviso cancelado no deben considerarse activos");
assert.ok(!entries.some(item => item.id === "remCancelled"));
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

const today = groupDietarioByDay(notes, { now, range: "today" });
assert.equal(today.days.length, 1);
assert.equal(today.days[0].items.length, 2);

const onlyCalendar = groupDietarioByDay(notes, { now, range: "all", type: "calendar" });
assert.ok(onlyCalendar.days.every(day => day.items.every(item => item.rail === "calendar")));
assert.equal(onlyCalendar.undated.length, 0, "el filtro por tipo también se aplica a la sección sin fecha");

const [html, app, serviceWorker, ui, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
  readFile(new URL("../js/ui.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);
assert.match(html, /id="dietarioOpen"/);
assert.match(html, /id="dietarioLibrary"/);
assert.match(html, /id="dietarioList"/);
assert.match(html, /title="Calendario"/);
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
assert.match(openDietarioEntrySource, /ui\.showDietarioDetail\(entry\)/);
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

console.log("dietario: ok");
