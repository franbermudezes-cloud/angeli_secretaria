# Changelog

## V0.21.36 · Accesos directos operativos

- Los seis accesos incluidos conservan la intención elegida aunque la IA devuelva otra clasificación.
- Los accesos antiguos del dispositivo se enriquecen automáticamente, sin obligar a recrearlos.
- Recordatorio, evento y cancelación preparan una orden explícita antes del dictado.
- Hoy, Próxima semana y Llamar contacto ejecutan directamente la consulta necesaria sin una tarjeta intermedia.
- Las pruebas recorren los seis accesos, la migración heredada y la ejecución directa de Calendar y Contactos.

## V0.21.35 · Ciclo completo de notas

- Las consultas muestran acciones para editar, completar o reabrir y borrar cada nota.
- «Notas pendientes», «notas hechas» y «todas las notas» consultan el estado solicitado sin crear otra entrada.
- Editar vuelve al mismo listado; completar o reabrir actualiza Firestore y refresca los resultados.
- Borrar exige confirmación, elimina la nota compartida y retira sus adjuntos de Drive cuando existen.
- Una prueba recorre creación, edición, finalización, consulta de hechas, reapertura y borrado.

## V0.21.34 · Categorías inteligentes

- La IA recibe las categorías y tipos de relación configurados por la cuenta antes de interpretar una nota.
- «Anota en Bodas…» asigna la categoría personalizada `Bodas` y no la duplica como relación.
- «Relaciona esta nota con…» conserva su significado de relación; ambas expresiones tienen pruebas de regresión independientes.
- El contrato del intérprete admite identificadores personalizados validados sin volver a limitarse a las opciones originales.

## V0.21.33 · Ajustes de notas

- Ajustes incorpora una sección propia para administrar categorías y tipos de relación.
- Las opciones pueden crearse, renombrarse y eliminarse; si están usadas, Angeli avisa y reasigna las notas afectadas de forma explícita.
- La ficha de una nota usa inmediatamente la configuración personalizada.
- La configuración pertenece a la cuenta y se sincroniza mediante `users/{uid}/settings/notes` en la base `angelifirebase`.

## V0.21.32 · Confirmación real de notas

- Una nota nueva permanece como borrador y no llega a Firestore ni a Google Sheets hasta pulsar `Guardar nota`.
- La ficha previa muestra título, contenido, categoría, relación, motivo y etiquetas.
- `Modificar` permite corregir todos esos campos y regresar a la ficha antes de confirmar.
- Cancelar descarta el borrador y limpia sus posibles adjuntos remotos, sin dejar una entrada oculta.

## V0.21.31 · Notas clasificadas y consultables

- Las notas conservan un título útil, ámbito, relación opcional, motivo y hasta cinco etiquetas sin exigir datos para poder guardarlas.
- Angeli consulta las notas por asunto, texto, persona, cliente, proyecto, evento o etiqueta, sin crear una nota nueva con la propia pregunta.
- Firestore sincroniza la clasificación entre dispositivos y Google Sheets sigue recibiendo cada nota mediante el contrato ya existente, sin cambiar esa integración.
- El modal y las tarjetas muestran la clasificación; las pruebas automáticas cubren creación, serialización, filtros y consultas naturales.

## V0.21.30 · Cambios externos de avisos

- Al consultar recordatorios, Calendar vuelve a ser la referencia efectiva de título, descripción, fecha y hora.
- Los cambios realizados directamente en Google Calendar se guardan en Firestore y se reflejan en móvil y escritorio.
- `P03-external-update` modifica un aviso real fuera de Angeli y comprueba la reconciliación completa antes de limpiar la prueba.

## V0.21.29 · Avisos naturales con hora pendiente

- Reconoce «avísame» y «tienes que avisarme» como variantes de un aviso vinculado.
- Si el evento tiene día pero no hora, conserva toda la operación y pregunta solamente la hora.
- La respuesta horaria completa el evento y el aviso sin perder título, ubicación, tarea ni antelación.
- P05 real reproduce la orden de discomóvil en el Complejo San Marcos de Gandía.

## V0.21.28 · Cancelación conjunta de evento y aviso

- Al cancelar un evento creado con aviso vinculado, Angeli elimina también ese aviso de Calendar.
- Las búsquedas de modificación o cancelación no muestran el aviso vinculado como otro evento principal.
- P05 real comprueba la relación, la cancelación de ambos recursos y la ausencia del aviso residual.

## V0.21.27 · Ubicación y contexto del aviso vinculado

- Corrige el evento con aviso vinculado para separar siempre el recinto del título.
- El aviso anterior incluye el evento y la ubicación para ser comprensible fuera de Angeli.
- La confirmación muestra la ubicación aunque falte y permite añadirla o cambiarla por voz o texto.
- Amplía P05 con la frase real del Complejo San Marcos de Gandía y validación en Calendar.

## V0.21.26 · Evento con aviso vinculado

- P05 entiende en una sola frase un evento principal y «recuérdame N días
  antes…», conservando título, fecha, hora y ubicación del evento junto al
  título y momento del aviso anterior.
- El modal enseña ambos elementos y los confirma con una sola acción. Calendar
  crea los dos relacionados; si el aviso falla, Angeli retira el evento para
  no dejar una operación a medias.
- La edición del título o descripción actúa sobre el evento principal y
  «Cambiar aviso» actúa solo sobre la tarea anterior. Las acciones del aviso no
  se confunden con órdenes de modificar el evento y se respetan horas de mañana
  indicadas expresamente.
- Si Calendar crea el evento pero también falla su retirada compensatoria,
  Angeli conserva su ID y muestra el estado parcial para que pueda recuperarse.
- El vínculo queda registrado en las propiedades privadas del aviso y en la
  entrada sincronizada de Firestore. Las consultas de recordatorios incluyen
  también estos avisos vinculados.
- `P05-linked` crea y lee los dos elementos en Calendar real aislado, comprueba
  su relación y los elimina al terminar. Cada ejecución usa IDs nuevos para
  que Calendar no rechace una repetición tras haber borrado la prueba anterior.

## V0.21.25 · Objetivo semántico al modificar

- «Cámbiame la hora con María» busca por `María`, no por la expresión literal
  `hora con María`, y puede localizar eventos como «Quedada con María».
- La PWA separa de forma general el campo que se modifica —hora, fecha, día,
  ubicación, lugar o título— del identificador estable del evento.
- La misma normalización se aplica al objetivo de Gemini, al respaldo local y
  en la frontera de búsqueda de Calendar para que un error de formulación no
  vuelva a producir una consulta vacía.
- P11 reproduce la frase real contra Calendar aislado, encuentra el evento, lo
  modifica y lo elimina automáticamente al terminar.

## V0.21.24 · Cancelación por persona

- «Anula cita con Miguel» encuentra también eventos titulados «Quedada con
  Miguel»: la búsqueda usa la persona y no exige que Calendar conozca los
  sinónimos de Angeli.
- La normalización cubre cita, quedada, reunión, llamada, cena, comida, evento,
  aviso y recordatorio sin perder la confirmación previa al borrado.
- La IA vuelve a mandar sobre el objetivo semántico: las protecciones locales
  conservan cancelar/modificar y su confirmación, pero ya no sustituyen
  `Miguel` por la frase literal dictada.
- `P04-name` reproduce el caso contra Calendar real y elimina todos sus eventos
  aislados al terminar; `P11` hace lo mismo con «cámbiame la hora de Miguel».

## V0.21.23 · Descripciones sincronizadas

- Firestore conserva `calendarDescription`; ya no desaparece entre la edición
  del modal y la creación del evento en Google Calendar.
- La misma prueba de ida y vuelta confirma que la descripción de los
  recordatorios permanece dentro de su programación.
- La serialización compartida pasa a un módulo puro con prueba automática para
  impedir que una futura lista de campos vuelva a descartar estas descripciones.

## V0.21.22 · Ficha completa de Calendar

- Eventos y recordatorios enseñan antes de guardar el título exacto, la fecha y
  hora, la ubicación separada y la descripción que recibirá Calendar.
- Si los datos dictados ya están completos, el camino normal sigue necesitando
  únicamente confirmar «Añadir» o «Programar».
- El mismo modal permite cambiar el título o añadir/cambiar una descripción por
  voz o texto, sin abandonar la operación activa.
- Los avisos programados guardan también ubicación y dejan de usar la frase
  original como descripción oculta.
- Se automatiza la igualdad entre la ficha confirmada y el payload real de
  Calendar para eventos y recordatorios.

## V0.21.21 · Calendar reconciliado

- Las consultas de recordatorios comprueban en Google Calendar si sus avisos
  vinculados siguen existiendo antes de mostrarlos como pendientes.
- Un evento borrado directamente desde Calendar deja de aparecer activo en
  Angeli y el cambio se replica entre dispositivos mediante Firestore.
- Los fallos técnicos no se confunden con borrados: se conserva el aviso y se
  informa de que Calendar no pudo comprobarse.
- Se añaden pruebas PWA, backend y `P03-external` contra Calendar aislado.

## [0.21.20] - 2026-08-27

- «Cámbiame la hora de llamar a Miguel» tiene prioridad como modificación de
  un recordatorio existente y nunca abre el flujo de llamada inmediata.
- Se amplían las variantes flexionadas con pronombre: cámbiame, modifícame,
  pásame, muéveme, retrásame, adelántame y reprográmame.
- La instrucción del intérprete Gemini explicita que «llamar» puede describir
  el evento objetivo y no debe ocultar la orden principal de cambio.
- Protección local adicional: una clasificación errónea de la IA como
  `contact.call` se corrige antes de presentar cualquier acción.

## [0.21.19] - 2026-08-26

- Las órdenes para pasar, cambiar, mover, retrasar, adelantar o reprogramar
  recordatorios existentes aceptan frases naturales y separan el objetivo de
  la nueva fecha u hora.
- Si falta el nuevo momento, la conversación permanece abierta y una respuesta
  breve como «a las once» completa la misma modificación.
- Angeli busca automáticamente las coincidencias en Calendar, permite elegir
  cuando hay varias y, después de modificar la seleccionada, actualiza también
  la fecha y hora del recordatorio guardado en Angeli.
- Pruebas automáticas del lenguaje flexible, continuidad conversacional,
  búsqueda normalizada y sincronización del recordatorio seleccionado.

## [0.21.18] - 2026-08-26

- Los borradores y preguntas conversacionales incluyen un micrófono propio en
  el modal; no es necesario recurrir al micrófono del teclado del teléfono.
- El teclado deja de abrirse automáticamente y el modal se adapta al viewport
  visible para mantenerse por encima del teclado o del panel de dictado.
- El botón del modal muestra cuándo Angeli está escuchando. Prueba automática
  del control de voz, ausencia de autofoco y contrato visual móvil.

## [0.21.17] - 2026-08-26

- «Ya he llamado a Miguel» vuelve a encontrar recordatorios programados aunque
  su conversación de creación ya esté cerrada.
- Completar un recordatorio retira primero su aviso de Google Calendar y solo
  después lo marca como hecho en Angeli. Si Google falla, ambos quedan pendientes.
- P03 comprueba el orden de la operación localmente y elimina un aviso real en
  el Calendar aislado del arnés.

## [0.21.16] - 2026-08-26

- Las consultas de agenda recorren todas las páginas devueltas por Calendar; dejan de quedar cortadas en 20 eventos.
- Un límite defensivo convierte una paginación anómala en error visible, nunca en un falso listado completo.
- P10 fuerza dos páginas reales en Calendar de pruebas; el modal de 40 eventos conserva scroll, Ver, Anular y Cerrar.

## [0.21.15] - 2026-08-26

- «Llamar a Miguel» sin tiempo explícito deja de convertirse por defecto en recordatorio aunque la IA pida una fecha.
- La tarjeta permite Llamar ahora, Crear recordatorio o Agendar llamada. Solo las dos últimas piden fecha/hora, reutilizando la misma entrada.
- Pruebas de interpretación IA/fallback, llamadas futuras y continuidad al elegir programar. Sin cambios en conexiones ni APIs.

## [0.21.14] - 2026-08-26

- Cada resultado de una consulta permite Ver y Anular el evento elegido.
- El detalle vuelve a la misma agenda. Anular conserva la confirmación existente; solo tras éxito se consulta de nuevo y se actualiza el recordatorio asociado.
- Doble pulsación bloqueada durante la cancelación. Rechazar o fallar no marca el evento como cancelado.
- Pruebas automáticas de botones/ID, detalle/vuelta, cancelación/refresco y rechazo/error. No cambia OAuth, Calendar API ni Firestore.

## [0.21.13] - 2026-08-26

- Los listados largos se desplazan dentro del emergente sin sacar el cierre
  de la pantalla. No cambia las acciones ni las búsquedas de agenda.
- Fixture visual de 40 eventos y prueba automática del contrato de estilos.

## [0.21.12] - 2026-08-26

- Revisión del mismo PR de cancelación: si no hay coincidencias en los próximos
  90 días, se informa del límite y se permite buscar otra fecha dentro del modal.
  No se exige fecha al inicio ni se presenta el rango vacío como ausencia global.

## [0.21.11] - 2026-08-26

- Cancelar por nombre busca directamente en Calendar sin exigir fecha ni hora.
- «No lo sé» mantiene una cancelación activa; no la convierte en una lista de consulta sin acciones.
- Las consultas de recordatorios permiten elegir uno y confirmar su cancelación.
- El borrado confirmado desde Angeli marca cancelado el recordatorio enlazado;
  no implementa aún reconciliación de borrados externos.
- Regresión automática del coordinador y selección/confirmación visual; P04-name
  crea tres llamadas en Calendar real, busca por nombre y cancela solo una.
- Sin cambios en OAuth, permisos, Firestore ni las integraciones existentes.

## [0.21.10] - 2026-08-26

- Se acepta la hora Gemini HH:MM:00 normalizándola a HH:MM, sin alterar su
  valor. Segundos no nulos y horas imposibles siguen rechazándose.
- Evidencia completa y muestra de regresión documentadas para BUG 4.
- Test del endpoint (503 antes / 200 después) y P05-model-time con Calendar
  real, además de pruebas negativas y límites de hora.

## [0.21.9] - 2026-08-26

- `Pasado mañana` suma dos días, antes de reconocer `mañana`. La expresión
  `de la mañana` no impone por sí sola un día futuro.
- Las fechas relativas explícitas de recordatorios se contrastan con la
  referencia actual, incluso si la IA propone incorrectamente el día siguiente.
- Pruebas fijas de días, límites de mes/año y P05-relative en Calendar real.
- Evidencia del formato de hora de Gemini documentada antes de corregirlo,
  en `docs/BUGS-2026-08-26.md`; su arreglo irá en un PR separado.

## [0.21.8] - 2026-08-26

### Corregido

- Las llamadas programadas recuperan el nombre del título interpretado o del
  dictado cuando falta `contactName`; modal y Calendar comparten el título.
- Calendar conserva también la instrucción original en la descripción.
- Regresión P05-summary: constructor PWA con transcripción y respuesta IA
  parcial controladas, creación y lectura en Calendar real de pruebas.
- Documentada la falta de reconciliación con cambios externos de Calendar;
  no se modifica la sincronización en esta versión.

## [0.21.7] - 2026-08-26

### Corregido

- `¿Qué recordatorios tengo de Miguel?` consulta los recordatorios pendientes
  guardados en Angeli y muestra el que sigue activo después de completar otro.
- La consulta no crea una nota, no incluye recordatorios terminados y no se
  desvía hacia Google Calendar.
- Un recordatorio programado sigue pendiente aunque su conversación esté cerrada.

### Pruebas

- Añadida una regresión posterior a P03 con dos recordatorios de Miguel: uno
  completado y otro pendiente, verificando que solo se recupera el pendiente.
- Cobertura de consulta general, coincidencia por persona, estados cerrados y
  respaldo de solo lectura cuando falla la IA (proveedor simulado).

## [0.21.6] - 2026-08-24

### Añadido

- `Ya he llamado a Miguel` completa el pendiente existente y no crea una nota
  ni una tarea duplicada.
- Si hay varios pendientes coincidentes, Angeli muestra las opciones y exige
  elegir uno; si no encuentra ninguno, lo indica sin alterar los datos.

### Pruebas

- P03 queda cubierto en la puerta automática para coincidencia única,
  ambigüedad, exclusión de entradas terminadas y ausencia de coincidencias.

## [0.21.5] - 2026-08-24

### Corregido

- Una llamada con una referencia temporal parcial ya no abre el marcador de
  inmediato: `llama a Miguel mañana` pregunta la hora y `llama a Miguel a las
  siete` programa la próxima ocurrencia.
- La llamada sin fecha ni hora conserva el comportamiento inmediato.

### Pruebas

- La puerta automática incorpora pruebas del coordinador conversacional para
  P01/P02, recordatorios completos, cierre de interacciones y llamadas futuras.
- Recorrido P01/P02 comprobado también en la PWA publicada con la IA real,
  sin errores de consola y sin ejecutar la acción externa de prueba.

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

### Added

- Arnés de integración real aislado para Calendar y Drive. Usa secretos de prueba independientes (`angeli-test-google-*-grant`), la cuenta de pruebas y datos con prefijo borrable; no accede a las autorizaciones de producción.
- Separación estricta del cliente OAuth del arnés: las rutas y el runner de pruebas exigen `ANGELI_TEST_GOOGLE_WEB_CLIENT_ID` y no reutilizan el Client ID de producción.
- Página de autorización exclusiva de pruebas y rutas de Cloud Run desactivadas por defecto. Solo al habilitarlas expresamente pueden guardar los tres grants de prueba; las sesiones personales de Contactos, Calendar y Drive no se consultan ni se modifican.
- Puerta automática de integración para Pull Requests: autentica GitHub Actions mediante Workload Identity Federation, ejecuta el arnés real y conserva su informe como artefacto. Los PR de ramas `codex/*` se fusionan automáticamente solo después de superar el check obligatorio.

### Changed

- La documentación y las reglas de proyecto exigen comprobar de extremo a extremo los recursos externos y ejecutar el arnés aislado cuando esté configurado antes de declarar validado un cambio funcional de integración.

### Verified

- Ejecución real aislada en la cuenta de pruebas: P04 (cancelación), P10 (consulta), P11 (modificación de hora) de Calendar y P06 (subida/eliminación en Drive). Los recursos generados usan el prefijo `ANGELI-TEST-*` y se eliminan al finalizar.

## [0.21.4] - 2026-08-24

### Fixed

- Una conversación pendiente ya no intercepta órdenes nuevas escritas o dictadas en el compositor principal. Por ejemplo, una confirmación antigua sobre Pepe no puede convertir «¿Qué tengo mañana?» ni «Llama a Montse» en una respuesta a esa operación.
- Solo el campo `Continuar` del popup asociado a una pregunta puede completar esa misma interacción.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.21.4 · Flujo aislado`.

## [0.21.3] - 2026-08-24

### Fixed

- Las preguntas de rango a Calendar, como `¿Qué tengo mañana?`, ya no envían la frase completa como filtro textual de título. Se consultan únicamente por el intervalo solicitado.
- Las búsquedas de modificación o cancelación limpian el verbo de orden y los datos temporales del texto antes de enviarlo como coincidencia de Calendar.
- Un fallo de autorización o de API de Calendar se informa como error de integración, no como si la agenda estuviera vacía.

### Changed

- Creación, consulta, modificación y borrado confirman explícitamente el mismo calendario efectivo: `primary`.
- Identificación visible y caché PWA actualizadas a `V0.21.3 · Calendar fiable`.

## [0.21.2] - 2026-08-24

### Fixed

- Las confirmaciones finales de éxito se muestran brevemente y se cierran solas; ya no se exige un toque adicional para cerrar una acción de Calendar, un aviso programado o un guardado simple.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.21.2 · Flujo directo`.

## [0.21.1] - 2026-08-24

### Fixed

- Cuando Angeli necesita un dato, la misma tarjeta de conversación conserva la pregunta, el campo de respuesta, el micrófono, `Continuar` y `Cancelar`; ya no obliga a cerrar una ventana y abrir otra para responder.
- La tarjeta no se cierra al tocar accidentalmente el fondo durante una interacción activa.
- Los mensajes y tarjetas dejan de exponer detalles técnicos de interpretación local o IA; Angeli explica únicamente cuándo necesita confirmar un dato antes de actuar.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.21.1 · Conversación fluida`.

## [0.21.0] - 2026-08-24

### Added

- Conversación persistente para completar una misma instrucción en varios turnos: Angeli conserva intención, datos recogidos y la pregunta pendiente dentro de la entrada sincronizada.
- Nuevo módulo `js/conversation.js`, dedicado a resolver, cancelar o completar interacciones sin mezclar esta lógica con la interfaz o las integraciones.

### Changed

- La IA recibe el contexto limitado de la interacción activa. Respuestas como una hora o una confirmación completan la misma operación en lugar de crear una nota independiente.
- Los accesos directos, texto y dictado entran por el mismo coordinador de conversación.
- Las acciones externas completadas o canceladas cierran su interacción activa para no bloquear la siguiente petición.
- Identificación visible y caché PWA actualizadas a `V0.21 · Conversación`.

### Fixed

- Los fallos de IA, JSON inválido o baja confianza dejan un aviso claro de respaldo local; ya no se presentan silenciosamente como una interpretación correcta de IA.

### Pending validation

- Requiere desplegar el backend Cloud Run y comprobar en Android/móvil-escritorio una instrucción incompleta, su respuesta posterior, confirmación, cancelación y el respaldo visible cuando falle IA.

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
