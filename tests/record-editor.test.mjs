import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Hallazgo de "calidad de código" de la auditoría completa: showReminderEditor
// y showCalendarEventEditor (js/ui.js) eran casi el mismo formulario
// (título/fecha/hora/ubicación/descripción) copiado dos veces con ids de
// campo distintos. Se extrae la construcción del formulario a
// buildRecordEditorForm(idPrefix); cada editor conserva sus propios valores
// iniciales, su propia validación (el recordatorio exige fecha y hora, el
// evento no) y su propio nombre de campo en el resultado (description vs
// notes) — este test comprueba que ese comportamiento no cambió al
// compartir la construcción del HTML.
test("showReminderEditor y showCalendarEventEditor comparten la construcción del formulario, sin cambiar su comportamiento", () => {
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /function buildRecordEditorForm\(idPrefix\)\{/, "debe existir una única función que construye el formulario");
  const builderSource = ui.match(/function buildRecordEditorForm\(idPrefix\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(builderSource, "buildRecordEditorForm debe existir");
  assert.match(builderSource, /\$\{idPrefix\}Title/);
  assert.match(builderSource, /\$\{idPrefix\}Date/);
  assert.match(builderSource, /\$\{idPrefix\}Time/);
  assert.match(builderSource, /\$\{idPrefix\}Location/);
  assert.match(builderSource, /\$\{idPrefix\}Description/);

  const reminderSource = ui.match(/function showReminderEditor\(entry,\{onSave,onCancel\}=\{\}\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(reminderSource, "showReminderEditor debe existir");
  assert.match(reminderSource, /buildRecordEditorForm\("reminderEdit"\)/, "debe reutilizar el formulario compartido, no volver a escribir el HTML");
  assert.match(reminderSource, /if\(!date\|\|!time\)return notify\("Indica la fecha y la hora"\)/, "el recordatorio sigue exigiendo fecha y hora");
  assert.match(reminderSource, /description:\$\("reminderEditDescription"\)\.value\.trim\(\)/, "el recordatorio sigue llamando 'description' al campo de texto libre");

  const eventSource = ui.match(/function showCalendarEventEditor\(event,\{onSave,onCancel\}=\{\}\)\{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(eventSource, "showCalendarEventEditor debe existir");
  assert.match(eventSource, /buildRecordEditorForm\("eventEdit"\)/, "debe reutilizar el formulario compartido, no volver a escribir el HTML");
  assert.doesNotMatch(eventSource, /if\(!.*date.*\|\|.*time.*\)return notify/, "el evento no debe exigir fecha y hora obligatoriamente, a diferencia del recordatorio");
  assert.match(eventSource, /notes:\$\("eventEditDescription"\)\.value\.trim\(\)/, "el evento sigue llamando 'notes' al campo de texto libre en el resultado, aunque el id del <textarea> ahora sea compartido");
});

console.log("record-editor: ok");
