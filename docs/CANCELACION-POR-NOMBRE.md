# Cancelación por nombre — V0.21.11

## Regresión y alcance

El usuario informó que «Anula llamada a Miguel Ibiza» pedía día y hora.
Al responder «no lo sé», recibía una lista no seleccionable que solo permitía
cerrar. El coordinador reproducía la exigencia de fecha/hora al aceptar los
campos pendientes de la IA sin distinguir búsqueda y creación.

La corrección conserva el recorrido buscar → elegir → confirmar. Una orden
explícita prepara la búsqueda, no autoriza borrar automáticamente. «Llamada a»
se elimina de la consulta textual para encontrar también «Llamar a».

## Evidencia local

- 22 pruebas JavaScript y 34 Python aprobadas.
- Navegador local: al pulsar el recordatorio ficticio aparece su título y
  fecha con «¿Cancelar este recordatorio?», «Ahora no» y «Cancelar recordatorio».
- «Ahora no» retira la clase `show` del modal; no ejecuta borrado.
- Consola de esa prueba visual: ningún error JavaScript.
- P04-name amplía la puerta con creación/búsqueda/cancelación en Calendar real.
  Su resultado de CI debe consultarse en el PR #8; no equivale a probar dictado.

## Límites

No se cambian permisos, sesiones, esquema Firestore ni APIs de Google.
Se utilizan las funciones existentes para buscar y cancelar; tras éxito se
actualiza el recordatorio vinculado al ID. Los borrados realizados fuera de
Angeli siguen pendientes de reconciliación, como documenta el roadmap.
La búsqueda inicial conserva el rango vigente de Calendar (90 días sin fecha).
Si no encuentra coincidencias, explica ese límite y permite indicar otra fecha
en el mismo modal. Esta salida también permite recuperar eventos más lejanos.
La selección en esta iteración se hace pulsando; no se añade selección por voz.
