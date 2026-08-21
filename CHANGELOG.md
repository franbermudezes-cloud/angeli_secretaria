# Changelog

## [0.18.4] - 2026-08-21

### Fixed

- Al abrir la PWA se intenta recuperar de forma silenciosa la identidad temporal necesaria para consultar las conexiones persistentes de Google. Contactos y Calendar no vuelven a solicitar sus permisos si sus autorizaciones siguen guardadas en Secret Manager.
- Los estados de Ajustes distinguen entre una conexión realmente confirmada, una sesión que se está comprobando y una identidad que necesita confirmarse; ya no afirman erróneamente que una integración está desconectada.
- Los recordatorios entienden horas como `a las 2 y 15 minutos` y `a las dos y cuarto`. Para un recordatorio sin día explícito se usa la próxima ocurrencia de esa hora; la tarjeta siempre solicita confirmación antes de crear el aviso de Calendar.
- Si Calendar no puede crear un evento o aviso, la entrada local conserva un estado de error reintentable en lugar de aparentar que quedó programada.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.18.4 · Sesiones y avisos`.

### Pending validation

- Pendiente de comprobar en Android la recuperación silenciosa tras cerrar y abrir la PWA, y la programación confirmada de un aviso en Google Calendar.

Este archivo registra los cambios funcionales relevantes de Angeli Secretaria. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

## [0.20.8] - 2026-08-21

### Fixed

- Las fotos y archivos dejan de crearse con la cuenta de servicio de Cloud Run, que Google no permite usar como propietaria de archivos en Mi unidad por no tener cuota. Drive se vincula ahora, de forma independiente y persistente, con el Gmail que posee las carpetas.
- La vinculación de Drive solicita únicamente `drive.file`: Angeli puede crear, leer y borrar los adjuntos que ella misma genera, sin acceder al resto de Mi unidad.

### Changed

- Drive deja de considerarse listo solo por tener IDs de carpetas; requiere tanto las rutas fijas como la autorización OAuth persistente de Drive.
- Identificación visible y caché PWA actualizadas a `V0.20.8 · Drive`.

## [0.20.7] - 2026-08-21

### Added

- La animación de Angeli se reutiliza durante todos los estados de trabajo: interpretar, guardar, subir adjuntos y consultar Google. El texto inferior cambia según la operación en curso; las confirmaciones y resultados conservan sus tarjetas sin animación ni bloqueo.

### Fixed

- La pantalla inicial crítica usa el mismo fondo oscuro que la bienvenida y precarga el GIF, evitando el destello blanco entre la apertura de la PWA y la animación.

### Changed

- Identificación visible, fondo nativo y caché PWA actualizados a `V0.20.7 · Animación`.

## [0.20.6] - 2026-08-21

### Added

- Pantalla de bienvenida a pantalla completa con la animación original de Angeli. Se mantiene un mínimo de 2,6 segundos mientras la PWA inicializa sesión y datos, y se retira automáticamente para no bloquear la aplicación si hay un problema de red.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.6 · Bienvenida`.

## [0.20.5] - 2026-08-21

### Fixed

- La PWA apunta explícitamente a la base Cloud Firestore real `angelifirebase`, en lugar de a `(default)`. Las entradas de móvil y escritorio pasan a leer y escribir el mismo registro remoto.
- El estado de sincronización espera la confirmación de las escrituras pendientes de Firestore antes de declarar que los datos están sincronizados.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.5 · Sincronización`.

### Pending validation

- Pendiente de comprobar una entrada de texto creada desde Android y vista en Mac, y otra creada desde Mac y vista en Android, con la misma cuenta Angeli.

## [0.20.4] - 2026-08-21

### Fixed

- Las subidas de fotos y archivos renuevan específicamente el token de Firebase antes de iniciarse, sin alterar Calendar, Contactos o IA.
- El backend diferencia una sesión de Angeli no autorizada de un rechazo de Drive en carga, lectura o borrado de adjuntos; los diagnósticos de Cloud Run ya no atribuyen ambos errores a la carpeta.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.4 · Adjuntos`.

### Pending validation

- Pendiente de desplegar Cloud Run y comprobar desde Android y Mac: una foto, un archivo y la aparición de esa misma entrada en el otro dispositivo.

## [0.20.3] - 2026-08-21

### Fixed

- La confirmación de Firestore ya no mantiene bloqueada la tarjeta de progreso. La sincronización continúa en segundo plano y expone su estado en Ajustes, mientras que la persona puede continuar con la propuesta de Calendar, Contactos o cualquier otra acción.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.3 · Flujo libre`.

## [0.20.2] - 2026-08-21

### Fixed

- Cada envío muestra de inmediato una tarjeta de progreso y bloquea las dos flechas hasta que Angeli termina, evitando pulsaciones repetidas durante la comunicación con el servidor.
- Un adjunto que Drive no puede subir se elimina de la petición fallida para que no bloquee órdenes posteriores de IA, Calendar o Contactos.
- Si un medio ya llegó a Drive pero después falla la interpretación o el guardado remoto, Angeli intenta retirarlo para evitar adjuntos huérfanos.
- Los errores de acceso de medios indican que Drive no puede acceder a la carpeta configurada y dejan un diagnóstico técnico seguro en Cloud Run.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.2 · Flujo seguro`.

## [0.20.1] - 2026-08-21

### Fixed

- Al enviar una foto o archivo, Angeli bloquea ambas flechas y muestra un estado de subida hasta que termina; pulsaciones repetidas ya no pueden iniciar varias cargas.
- Los medios se dirigen a carpetas fijas compartidas con la cuenta de servicio de Cloud Run. Se elimina por completo la creación automática de carpetas raíz, de tipo, año o mes.
- Una entrada nueva espera la confirmación de Firestore antes de considerarse guardada. Si falla, el borrador y sus adjuntos preparados permanecen disponibles y el estado de sincronización muestra un diagnóstico útil.

### Changed

- Drive deja de requerir una conexión OAuth en cada dispositivo: el servidor usa la cuenta de servicio compartida en la carpeta raíz de Angeli. Quedan configurados destinos para imágenes, archivos, bandeja, notas de voz y datos, aunque por ahora solo se usan imágenes y archivos.
- Identificación visible y caché PWA actualizadas a `V0.20.1 · Datos y Drive`.

### Pending validation

- Pendiente de desplegar Cloud Run con los IDs de carpetas y comprobar una foto, un archivo y la sincronización de una entrada entre Android y Mac.

## [0.20.0] - 2026-08-21

### Added

- Google Drive como almacenamiento permanente de fotos y archivos nuevos. Cada adjunto se guarda en `Angeli Secretaria/Fotos/<año>/<mes>` o `Angeli Secretaria/Archivos/<año>/<mes>` y la entrada de Firestore conserva solamente su referencia.
- Conexión independiente de Drive mediante el alcance mínimo `drive.file`, con autorización persistente guardada únicamente en Secret Manager.
- Estado visible de sincronización de Angeli y conexión de Drive en Ajustes.

### Changed

- Cloud Firestore pasa a ser la única fuente de verdad de las entradas entre móvil y escritorio. Las notas y blobs heredados del navegador no se leen, no se migran y no se mezclan con los datos remotos.
- La limpieza de dispositivo elimina solo la caché técnica y el borrador local: no borra las entradas ni los adjuntos guardados en la nube.
- El intérprete tolera campos opcionales ajenos a la intención solicitada para evitar descartar una interpretación válida por información inofensiva de Calendar.

### Pending validation

- Pendiente de desplegar Cloud Run y validar en Android y escritorio: conexión única de Drive, foto, PDF, persistencia tras cerrar y abrir, sincronización cruzada y borrado de entrada con adjuntos.

## [0.19.0] - 2026-08-21

### Added

- Firebase Auth como sesión persistente de Angeli y Cloud Firestore como fuente de verdad compartida para las entradas entre móvil y escritorio.
- Migración segura e idempotente de entradas existentes desde `localStorage`: no elimina la copia local ni los medios IndexedDB mientras no se confirme su sincronización.
- Reglas de Firestore que restringen cada entrada a su usuario autenticado.

### Changed

- Cloud Run valida tokens de Firebase del correo propietario autorizado mediante `ALLOWED_FIREBASE_EMAILS`; ya no depende del token efímero de Google Identity Services para interpretar una orden o consultar el estado de las conexiones.
- Ajustes separa la sesión persistente de **Cuenta Angeli** de las conexiones independientes de Contactos y Calendar.

### Pending validation

- Pendiente de desplegar reglas de Firestore y backend, y de validar en Android/escritorio la sesión persistente, la migración y la sincronización en tiempo real.

## [0.18.3] - 2026-08-21

### Fixed

- Se evita leer dos veces el cuerpo de una autorización OAuth de Contactos o Calendar, que causaba el error `JSON de entrada no válido` tras conectar IA.

## [0.18.2] - 2026-08-21

### Fixed

- Se valida el retorno OAuth contra la lista de orígenes permitidos en lugar de compararlo directamente con un encabezado del navegador; corrige el `400` que impedía vincular Contactos y Calendar.
- La primera vinculación de Contactos o Calendar solicita consentimiento y selección de cuenta, necesarios para conservar la autorización segura en Secret Manager.

## [0.18.1] - 2026-08-21

### Fixed

- Se corrige un error de sintaxis en el módulo de conexiones Google que impedía iniciar el JavaScript de la PWA y dejaba los controles sin responder.

## [0.18.0] - 2026-08-21

### Changed

- Las autorizaciones de Google se preparan para persistir de forma segura en Cloud Run y Secret Manager, separadas para Contactos y Calendar; los refresh tokens no se guardan en el teléfono ni en GitHub.
- La conexión de IA usa el flujo OAuth de código con selector explícito de cuenta, evitando depender exclusivamente de One Tap en Android.

### Pending validation

- Pendiente de validación real en Android tras desplegar Cloud Run: conexión inicial de IA, Contactos y Calendar con cuentas distintas, y persistencia después de cerrar y reabrir la PWA.

## [0.17.0] - 2026-08-21

### Added

- Las acciones futuras usan un modelo local `schedule`: fecha/hora, zona horaria, acción prevista, estado, entrega y referencia de Calendar. Una llamada futura se conserva como acción de llamada pendiente y no abre el marcador al crearla.
- La tarjeta operativa permite confirmar, reintentar, abrir y cancelar un aviso programado sin perder la entrada original.
- Al confirmar, Angeli crea un evento privado y transparente de Google Calendar con aviso emergente a la hora indicada; el identificador y enlace se guardan junto a la acción para evitar duplicados.

### Changed

- El intérprete de IA y el fallback local distinguen una llamada inmediata de una llamada con fecha y hora. Por ejemplo, «Llama a Miguel Ibiza mañana a las nueve» se propone como recordatorio programado; «Llama a Miguel Ibiza» sigue siendo una llamada inmediata.
- La PWA se identifica como `V0.17 · Acciones programadas` y renueva todos los recursos de caché.

### Pending validation

- Pendiente de validación manual en Android: creación, aviso de Calendar, persistencia, apertura y cancelación. La notificación propia de Angeli con la PWA cerrada queda pendiente de un planificador externo autenticado; no se simula como implementada.

## [0.16.6] - 2026-08-21

### Changed

- El compositor inferior usa dos columnas verticales de iconos: adjuntar/dictar a la izquierda y enviar/borrar borrador a la derecha, liberando el espacio central para el texto.
- El acceso directo `Llamar contacto` inicia el borrador con `Llama a ` y el dictado, para que el nombre pronunciado complete una orden de contacto en vez de crear una nota.

## [0.16.5] - 2026-08-21

### Changed

- La tarjeta emergente pasa a ser el espacio operativo principal: conserva el borrador de voz o texto hasta enviar y mantiene las acciones de Calendar y Contactos abiertas hasta completar o cancelar el flujo.
- El micrófono grande permanece disponible durante toda la sesión y la versión de prueba se muestra permanentemente en la cabecera.
- Al buscar un contacto, la PWA solicita la conexión a Contactos solo si hace falta y, tras volver, muestra los teléfonos encontrados dentro de la misma tarjeta para abrir el marcador con un toque.
- Calendar crea el evento después de la confirmación de la tarjeta, sin una segunda confirmación nativa.

### Added

- `styles-flow.css`, hoja acotada al flujo de dictado, tarjeta de trabajo y opciones de contacto.

## [0.16.4] - 2026-08-21

### Fixed

- Se renuevan de forma completa los identificadores de recursos y caché PWA de la interfaz V0.16 para evitar que Android conserve un módulo JavaScript anterior con error de sintaxis y muestre una pantalla sin interacción.
- Se corrige una plantilla HTML sin cerrar en `ui.js`, que impedía cargar todo el JavaScript de la PWA y dejaba la interfaz sin interacción.
- La versión se identifica como `V0.16.4 · Angeli Asistente` en cabecera y Ajustes.
- El Service Worker usa red primero para JavaScript y CSS, con caché únicamente como respaldo sin conexión.

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
