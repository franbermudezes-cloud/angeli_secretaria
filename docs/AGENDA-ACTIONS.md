# Acciones de la agenda · V0.21.14

PR de propósito único, posterior al scroll de V0.21.13.

## Verificado el 26/08/2026

- 25 pruebas JavaScript y 34 Python: PASS local.
- `tests/agenda-long.html`, datos ficticios, navegador a 390 × 844:
  40 filas con Ver / Anular; detalle del primero y del último, vuelta al listado.
- Modal entre y=24 e y=820; cierre entre y=760 e y=804.
  Contenido de 4277 px desplazable en 619 px. Sin errores JavaScript.
- Tests del coordinador: ID seleccionado, refresco tras éxito, ausencia de
  mutaciones ante rechazo/error, bloqueo de doble clic.

## Contrato con la integración existente

`deleteCalendarEvent` pide confirmación y solo invalida `getCalendarResult`
tras un DELETE correcto. El coordinador usa esa invalidación para refrescar
la consulta; no usa el `actionStatus` de una operación anterior como éxito.
No cambia credenciales, rangos, calendarId, permisos ni almacenamiento.
El arnés real aislado de CI sigue comprobando consulta/cancelación selectiva.

La sesión personal y el dictado no se usaron en la fixture. Prueba manual:
preguntar qué hay mañana, Ver un evento y volver; Anular uno de prueba,
rechazar primero y confirmar después; verificar que solo desaparece el elegido.
Los títulos genéricos ya guardados no se renombran en este cambio.
