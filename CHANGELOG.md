# Changelog

Este archivo registra los cambios funcionales relevantes de Angeli Secretaria. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

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
