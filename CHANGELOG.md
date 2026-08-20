# Changelog

Este archivo registra los cambios funcionales relevantes de Angeli Secretaria. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

## [0.16.0] - 2026-08-21

### Changed

- La interfaz móvil pasa de una bandeja de formularios a una conversación con Angeli Asistente: cabecera fija, zona central desplazable y compositor fijo inferior.
- El dictado conserva el texto en el borrador hasta que la persona pulsa explícitamente `Enviar`; tras enviar, la propuesta se muestra en una tarjeta emergente antes de ejecutar acciones externas.
- Búsqueda, filtros, conexiones y mantenimiento dejan de ocupar la pantalla principal de forma permanente; se muestran bajo demanda desde búsqueda y Ajustes.
- Se adopta la identidad visual basada en el icono de Angeli y se actualizan manifest, recursos y caché PWA a `V0.16 · Angeli Asistente`.

### Added

- Accesos directos locales para consultas y órdenes recurrentes, con creación manual o por dictado y gestión desde Ajustes.
- `Limpiar vista`, que oculta temporalmente el historial visible sin borrar entradas ni medios guardados.

### Pending validation

- Pendiente de validación manual en Android: dictado interrumpido/continuado, envío explícito, tarjeta emergente, Calendar, Contacts, cámara, fotos, archivos, accesos directos, búsqueda, Ajustes y actualización PWA.

## [0.15.6] - 2026-08-21

### Changed

- Una modificación de Calendar busca el evento existente por el objetivo original, no por la nueva fecha u hora indicada en `changes`.
- Las consultas de agenda pueden conservar un intervalo explícito mediante `rangeStart` y `rangeEnd`; se añade soporte para «esta semana» y «la semana que viene».
- La instrucción estructurada de Gemini refuerza la separación entre título, ubicación, evento objetivo y cambios solicitados.
- Se actualiza la identificación y la caché PWA a `V0.15.6 · Calendario contextual`.

### Pending validation

- Pendiente de validación manual en Android: mover un evento existente a otra fecha, consultar la semana siguiente y crear un evento con recinto/ubicación.

## [0.15.5] - 2026-08-21

### Changed

- Los eventos de Calendar creados desde IA usan el título estructurado devuelto por la interpretación, en lugar de reutilizar todo el texto dictado.
- La instrucción del intérprete distingue explícitamente el título breve del evento de su ubicación física.
- La ubicación se conserva en la entrada y se envía al campo `location` de Google Calendar, que puede mostrarla como enlace de Maps.
- Las entradas existentes con una intención IA guardada recuperan su título estructurado al abrir la aplicación.
- Se añade `calendar.query`: consulta limitada de eventos del calendario principal sin conservarlos localmente.
- Las propuestas de cancelar o modificar buscan eventos coincidentes y muestran cada coincidencia antes de ejecutar la acción.
- Las operaciones de cancelar y modificar solicitan una confirmación final con el título y hora concretos del evento.
- Al cancelar un evento creado por Angeli, su entrada asociada queda marcada como cancelada; al modificarlo, se actualizan sus datos locales conocidos.
- Se actualiza la identificación y la caché PWA a `V0.15.5 · Calendario bidireccional`.

### Pending validation

- Pendiente de validación manual en Android: creación con título/ubicación, consulta, selección de coincidencias, modificación y cancelación real.

## [0.15.3] - 2026-08-20

### Changed

- Una interpretación remota de IA válida pasa a ser la fuente de intención, tipo y datos de la entrada; no se reinterpreta con reglas locales.
- La clasificación local se usa exclusivamente cuando la IA no está conectada, no responde, falla o devuelve una respuesta que no supera la validación estructural.
- Las respuestas parciales pero seguras del modelo se normalizan en el intérprete antes de llegar a la PWA, para evitar perder una orden válida por campos opcionales ausentes.
- La interfaz distingue una propuesta de IA de una clasificación local de respaldo.
- Se actualiza la identificación y la caché PWA a `V0.15.3 · IA prioritaria`.

### Security

- La PWA mantiene una lista cerrada de intenciones, valida los datos recibidos y conserva la confirmación humana antes de cualquier acción sensible. La IA no ejecuta acciones externas directamente.

### Pending validation

- Pendiente de validación manual en Android: creación, modificación y cancelación propuestas por IA; confirmación de acciones sensibles; y mensaje claro cuando se use el respaldo local.

## [0.15.2] - 2026-08-20

### Added

- Conexión opcional y separada de Google para la capa IA, limitada a una credencial de identidad temporal de la sesión.
- Proveedor remoto en `ai.js` que envía únicamente el texto y contexto temporal al intérprete seguro de Cloud Run.

### Security

- La credencial de identidad solo permanece en memoria; no se guarda en `localStorage`, IndexedDB ni GitHub.
- El intérprete remoto valida la identidad y una lista privada de cuentas autorizadas antes de usar Gemini. Si no hay conexión, la identidad caduca o el servicio falla, la PWA usa la clasificación local existente.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.15.2 · IA real`.

### Pending validation

- Pendiente de validación manual en Android: conexión IA con la cuenta autorizada, interpretación de órdenes naturales, fallback sin conexión y conservación de Contactos, Calendar, medios, dictado y Sheets.

## [0.15.1] - 2026-08-20

### Added

- Las propuestas y confirmaciones de creación de eventos muestran la ubicación detectada cuando existe.
- Las entradas de Calendario guardan la ubicación y recuperan la de las entradas V0.15 que solo la tenían dentro de su intención IA.

### Changed

- La creación de eventos de Google Calendar envía el texto detectado al campo oficial `location`, sin geocodificación ni permisos adicionales.
- El extractor local conserva ubicaciones con comas y números, como restaurantes y direcciones.
- Se actualiza la identificación y la caché PWA a `V0.15.1 · Ubicaciones`.

### Pending validation

- Pendiente de validación manual en Android: visualización de ubicación en la confirmación, creación de evento con población/restaurante/dirección y persistencia tras recargar.

## [0.15] - 2026-08-20

### Added

- Capa de interpretación estructurada con proveedor simulado intercambiable, validación de esquema, lista cerrada de intenciones y fallback local.
- Propuestas visibles para crear, modificar o cancelar eventos, llamar, crear tareas y preparar recordatorios.

### Security

- Las intenciones sensibles requieren confirmación y no ejecutan código ni integraciones desde una respuesta del proveedor.
- No se añade ninguna clave, secreto ni llamada a una API de IA.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.15 · IA estructurada`.

### Pending validation

- Pendiente de validación manual en Android con el proveedor simulado; las operaciones reales de actualizar/cancelar Calendar siguen pendientes.

## [0.14.1] - 2026-08-20

### Added

- Detección de fechas naturales: mañana, días de semana y fechas como `28 de agosto`.
- Detección de horas naturales: franja mañana/tarde/noche, medias y cuartos.

### Changed

- La clasificación prioriza recordatorio, tarea y contacto; las entradas restantes con fecha y hora pasan a Calendario.
- Las notas existentes se recalifican únicamente cuando ahora cumplen inequívocamente la regla de Calendario.
- Los títulos de los nuevos eventos eliminan las expresiones temporales detectadas.
- Se actualiza la identificación y la caché PWA a `V0.14.1 · Temporal inteligente`.

### Pending validation

- Pendiente de validación manual en Android con órdenes naturales y creación real de eventos.

## [0.14] - 2026-08-20

### Changed

- Refactor interno a módulos ES: interfaz, almacenamiento, clasificación, temporal, Google, Sheets y coordinación se separan en archivos independientes.
- `index.html` queda como estructura y carga del punto de entrada modular.
- Se actualiza la identificación y la caché PWA a `V0.14 · Arquitectura modular` y se precarga el grafo de módulos en el Service Worker.

### Pending validation

- Pendiente de regresión manual completa en Android; no se añade funcionalidad nueva.

## [0.13.1] - 2026-08-20

### Added

- Controles separados para conectar, cambiar cuenta y desconectar Contactos y Calendar dentro de la sesión actual.

### Changed

- El estado visible ya no mezcla ambas integraciones de Google.
- Una búsqueda de contacto sin conexión muestra una explicación persistente en la entrada.
- Se actualiza la identificación y la caché PWA a `V0.13.1 · Cuentas Google`.

### Security

- Desconectar elimina únicamente los tokens temporales y los resultados de Contactos de la sesión; no revoca permisos concedidos en Google.

### Pending validation

- Pendiente de validación manual en Android con cuentas distintas para Contactos y Calendar.

## [0.13] - 2026-08-20

### Added

- Creación confirmada de eventos de una hora en el calendario principal de Google para entradas clasificadas como Calendario que tengan fecha y hora detectadas.
- Estado local de calendario (`pending`, `synced`, `error`), identificador del evento y enlace de apertura cuando Google lo proporciona.

### Security

- Se solicita de forma incremental únicamente el alcance `calendar.events` al confirmar la creación del evento.
- El token de Calendar permanece solo en memoria y no se persiste en la aplicación.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.13 · Google Calendar`.

### Pending validation

- Pendiente de validación manual en Android con autorización de Google: creación real, ausencia de duplicados y recuperación ante error.

## [0.12.3] - 2026-08-20

### Added

- Hoja de estilos externa `styles.css`, incluida en el precaché de la PWA.

### Changed

- Renovación visual SaaS de cabecera, formularios, filtros, tarjetas, chips, acciones y controles de mantenimiento.
- Se actualiza la identificación y la caché PWA a `V0.12.3 · SaaS UI`.

### Pending validation

- Pendiente de validación visual manual en Android y escritorio.

## [0.12.2] - 2026-08-20

### Added

- Conexión opcional a Google mediante OAuth para buscar por nombre en Google Contacts.
- Búsqueda limitada a nombre y teléfonos mediante People API, con selección explícita cuando hay varias coincidencias o números.

### Security

- Se solicita exclusivamente el alcance `contacts.readonly` al pulsar `Conectar Google`.
- Los tokens de acceso y los resultados de contactos se mantienen solo en memoria; no se persisten en la aplicación ni se envían al endpoint público de Sheets.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.12.2 · Contactos Google`.

### Pending validation

- Pendiente de validación manual en Android con la cuenta autorizada de Google.

## [0.12.1] - 2026-08-20

### Changed

- Se amplía la clasificación de intenciones de llamada y el reconocimiento de teléfonos españoles dictados.

### Validated

- V0.12.1 validada manualmente en Android: teléfono escrito o dictado, clasificación Contacto y apertura del marcador mediante `tel:`.

## [0.12] - 2026-08-20

### Added

- Acciones contextuales para calendario, contactos, tareas y recordatorios.
- Extracción local básica de teléfonos, fecha y hora para preparar acciones futuras.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.12 · Acciones`.

## [0.11] - 2026-08-20

### Added

- Clasificación local automática de las entradas y filtro por tipo.
- Opción de mantenimiento para eliminar explícitamente todos los datos locales de prueba.

### Changed

- Se añade el campo `type` a nuevas entradas y se clasifica/persiste automáticamente en las existentes al abrir la aplicación.
- Se actualiza la identificación y la caché PWA a `V0.11 · Clasificación`.

### Validated

- V0.11 validada manualmente en Android: clasificación de tarea, recordatorio, calendario, contacto, foto y archivo, prioridad de texto sobre adjuntos y persistencia de textos y medios.

## [0.10] - 2026-08-20

### Changed

- V0.10 · IndexedDB validada manualmente en Android.
- Se alinea la identificación visible y la caché PWA en `V0.10 · IndexedDB`.
- Las fotos e imágenes se guardan como blobs en IndexedDB en lugar de Data URLs en `localStorage`.
- Los archivos adjuntos se conservan localmente como blobs y se pueden abrir desde la entrada.
- Las imágenes Data URL existentes se migran de forma segura a IndexedDB al iniciar.

### Validated

- Dictado/texto, cámara, selección de fotos, archivos, persistencia tras actualizar/reabrir, visualización de medios y envío a Google Sheets.

## [0.9] - 2026-08-20

### Added

- Bandeja de entrada de notas con creación, búsqueda, filtros de estado, marcado como hecha/reapertura y borrado.
- Persistencia local de entradas mediante `localStorage`.
- Dictado en español compatible con `SpeechRecognition` y `webkitSpeechRecognition`.
- Captura/selección de imágenes y selección de archivos; previsualización de imágenes y metadatos de archivo en la entrada.
- Envío de los datos de entrada a Google Apps Script/Google Sheets.
- Configuración PWA con manifest, iconos y Service Worker para caché offline.
- Página independiente de prueba de micrófono.

### Known limitations

- El envío a Google se realiza en modo `no-cors`, por lo que el cliente no puede confirmar la respuesta del servidor.
- Imágenes y entradas dependen de la cuota de `localStorage`; los archivos adjuntos no se suben actualmente.
- Las versiones visibles y de caché no están completamente alineadas: la interfaz muestra `V0.9` y manifest/Service Worker usan `0.8.1`.
