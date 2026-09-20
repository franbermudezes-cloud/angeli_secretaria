/**
 * Palabras clave para reconocer intención por texto, centralizadas aquí
 * desde js/ai.js, js/classifier.js y js/shortcuts.js — hallazgo de "calidad
 * de código" de la auditoría completa: el disparador de "esto habla de un
 * recordatorio" vivía repetido, a veces literalmente idéntico y a veces con
 * pequeñas variaciones acumuladas con el tiempo, en varios sitios de esos
 * tres archivos. Ya causó una regresión real: el guard de "recuérdame" (V0.22.4)
 * tuvo que parchearse por separado en localReminderQuery Y localNoteQuery,
 * cada una con su propia copia pegada del mismo patrón, porque no había un
 * único sitio que las conectara.
 *
 * Este módulo no cambia ningún comportamiento por sí solo — cada constante
 * conserva exactamente las mismas palabras que tenía en su sitio original.
 * Lo que cambia es que ahora viven juntas, con la relación entre ellas
 * explicada, así que la próxima vez que haga falta añadir o corregir una
 * palabra clave de recordatorio hay un único archivo donde mirar primero.
 */

// Disparador estricto de "esto es (parte de) una orden de recordatorio",
// usado como guarda en varias funciones de ai.js para no confundir una orden
// nueva de recordatorio con la respuesta a otra pregunta pendiente, ni con
// una consulta vacía de notas/recordatorios.
export const REMINDER_TRIGGER = /\brecu[eé]rdame(?:l[oa]s?)?\b|\b(?:recuerda|acu[eé]rdate)\b/i;

// classify() (clasificar una entrada nueva sin más contexto) añade el verbo
// suelto "recordar", que REMINDER_TRIGGER no cubre (no hace falta ahí,
// porque su uso es un guard sobre frases que ya tienen otro verbo delante).
export const REMINDER_CLASSIFY_TRIGGER = /\brecu[eé]rdame(?:l[oa]s?)?\b|\brecordar\b/i;

// shortcutSemantics() (clasificar el texto de un acceso directo guardado)
// añade "recordatorio"/"avisame" en vez de "recuerda"/"acuérdate" — el texto
// de un acceso directo suele ser un nombre corto ("Recordatorio de la ITV"),
// no una orden hablada, así que las palabras típicas son otras.
export const REMINDER_SHORTCUT_TRIGGER = /\b(?:recordatorio|recuerdame|avisame)\b/i;
