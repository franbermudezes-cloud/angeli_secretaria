# Roadmap de producto

El orden evita añadir capacidades aisladas que después haya que rehacer. Cada bloque depende del anterior y debe validarse manualmente en Android antes de considerarse estable.

## Estado actual

La base ya permite capturar texto, dictado, fotos y archivos; almacenar medios localmente; interpretar con IA; consultar Contactos; y crear, consultar, modificar o cancelar eventos de Calendar mediante confirmación.

La interfaz V0.16 está en pruebas y todavía no es una versión estable de referencia.

## Bloque 1 — Acciones programadas

**Objetivo:** distinguir acciones inmediatas de acciones futuras y ejecutar avisos fiables.

Incluye recordatorios, llamadas futuras, tareas con fecha/hora, estado de programación, reintento, cancelación y trazabilidad. Especificación: [01-scheduled-actions.md](specs/01-scheduled-actions.md).

**P05 resuelto en V0.21.26:** una sola orden puede crear un evento y un aviso
anterior vinculados, con confirmación conjunta y escritura atómica en Calendar.

## Bloque 2 — Conocimiento de empresa

**Objetivo:** permitir consultas útiles sobre la información real de la empresa —clientes, presupuestos, proyectos, marketing y procedimientos— sin copiar indiscriminadamente datos privados a la PWA.

Primero se inventariarán las fuentes reales y sus permisos. Después se diseñará una capa de consulta de solo lectura, con respuestas mínimas y trazables. La PWA formulará preguntas; un backend autenticado consultará únicamente la fuente necesaria. Este bloque precede a cualquier automatización de escritura sobre esos sistemas.

## Bloque 3 — Agenda y contactos operativos

### Pendiente conocido — Cambios externos de Calendar (26/08/2026)

Confirmado por el usuario en producción V0.21.7: al borrar eventos de prueba
directamente mediante Google Calendar API, desaparecen de Calendar pero las
entradas vinculadas de Angeli siguen pendientes y aparecen al consultar los
recordatorios de Miguel. Las modificaciones externas tampoco se reconcilian.
Firestore guarda esas entradas compartidas; borrar caché local no lo resuelve.
La sincronización móvil/ordenador no implica sincronización inversa de Calendar.

**Resuelto para borrados en V0.21.21.** Al consultar recordatorios, Angeli
comprueba en Calendar cada aviso vinculado por `calendarEventId`. Si Google
confirma que ya no existe o está cancelado, la entrada deja de figurar como
pendiente y ese estado se sincroniza por Firestore. Un fallo de red,
autorización o API conserva el recordatorio y se informa como comprobación no
disponible; nunca se interpreta como borrado. La reconciliación de cambios
externos de fecha, hora o título permanece como mejora posterior independiente.

**Objetivo:** completar la gestión bidireccional de Calendar y convertir Contactos en acciones completas.

- Consultar agenda por periodos naturales.
- Crear, cambiar, cancelar y abrir un evento desde la tarjeta operativa.
- Buscar contacto, seleccionar entre coincidencias y asociar una llamada futura a ese contacto sin guardar la agenda completa.

Depende del modelo de acciones programadas para no confundir una llamada ahora con una llamada más tarde.

## Bloque 4 — Drive y archivos reales

**Objetivo:** llevar fotos y archivos a Google Drive de forma segura y trazable.

- Subida confirmada, ID y URL de Drive.
- Carpetas por tipo/proyecto cuando exista una regla aprobada.
- Estado de subida, reintentos y referencia en la entrada y Sheets.

Antes de implementar se comparará PWA directa, backend autenticado y n8n según tamaño, permisos y mantenimiento.

## Bloque 5 — Bandeja de trabajo y seguimiento

**Objetivo:** convertir las entradas en trabajo gestionable.

- Prioridades, estados, fechas límite y agrupaciones.
- Seguimientos: «si no contesta en dos días…».
- Consultas y resúmenes naturales de pendientes, agenda y próximos compromisos.

## Bloque 6 — Automatizaciones de negocio

**Objetivo:** conectar procesos externos sin convertir n8n en el núcleo de la aplicación.

- Reintentos, seguimiento diferido, correo y flujos multicanal.
- Sincronizaciones controladas con Sheets, Drive u otros sistemas.
- Auditoría de cada automatización: entrada, efecto, error y reintento.

## Criterio para abrir un bloque

Un bloque solo pasa a implementación cuando su especificación responde: intención de usuario, datos, interfaz, confirmaciones, integración, errores, privacidad, pruebas y comportamiento offline.
