# Memoria del proyecto — Angeli Secretaria

## 2026-09-20 — Un móvil de contacto en formato no reconocido se daba por no encontrado V0.22.10

Quinto hallazgo de prioridad media de la auditoría completa que se corrige.

**Causa raíz**: `whatsappPhone` (`js/whatsapp.js`) valida un número en tres pasos: si empieza por "+" o "00", limpia y comprueba que quede un número de 8-15 cifras; si no, solo lo acepta cuando encaja exactamente en el patrón español de móvil de 9 cifras (`/^[6789]\d{8}$/`), anteponiéndole "34"; en cualquier otro caso devuelve `null`. Esto es correcto para el caso más común (un móvil español guardado sin prefijo), pero descarta sin distinción cualquier otro número real y válido que no lleve "+"/"00" explícito — por ejemplo un contacto extranjero guardado tal cual desde el móvil, o un fijo con un formato distinto. En `showEntryAction` (`js/ui.js`), la pantalla de "¿Abrimos WhatsApp?" filtra los teléfonos del contacto con `whatsappChoices(...).filter(item=>whatsappPhone(item.phone))` — si ninguno pasaba el filtro, se mostraba "No encuentro un móvil", dando a entender que Contactos no tenía ningún número, cuando en realidad sí lo tenía, solo que en un formato que la validación estricta no reconocía.

**Corrección**: `showEntryAction` ahora calcula también `rawChoices` (los teléfonos del contacto que NO pasan `whatsappPhone`). Si hay teléfonos válidos (`choices`), el flujo no cambia. Si no hay ninguno válido pero sí hay alguno en `rawChoices`, ya no se dice "No encuentro un móvil": se muestra "Revisa el número" con el número real como botón, explicando que le falta el prefijo internacional. Tocar ese botón (acción `edit-whatsapp-phone` con `data-phone` con el número real) abre el editor de número ya con ese valor escrito — antes siempre se abría en blanco (`note.phone||""`, y `note.phone` es `null` en este escenario, porque el número viene de Contactos, no de la nota) — así que solo hace falta añadir el prefijo y confirmar, en vez de teclear el número entero de memoria. Solo cuando el contacto de verdad no tiene ningún teléfono (`!choices.length && !rawChoices.length`) se sigue mostrando "No encuentro un móvil".

**Cobertura de test**: `tests/conversation.test.mjs` ampliado — comprueba que un número sin "+"/"00" y que no encaja en el patrón español (p. ej. uno alemán) sigue siendo rechazado por `whatsappPhone`, que la pantalla distingue `choices` de `rawChoices`, que solo dice "No encuentro un móvil" cuando ambos están vacíos, que muestra "Revisa el número" cuando hay algo en `rawChoices`, y que tocarlo prellena el editor con ese número real.

## 2026-09-20 — Reprogramar un evento perdía otros cambios de la misma orden V0.22.9

Cuarto hallazgo de prioridad media de la auditoría completa que se corrige.

**Causa raíz**: `protectCalendarInterpretation` (`js/ai.js`) combina dos interpretaciones de una orden de "modificar evento": la local (`localCalendarUpdate`, basada en expresiones regulares, sin red) y la remota (la IA). Para el campo `changes`, usaba `local.changes || remote.changes || null`. El problema es que `localCalendarUpdate` SOLO sabe detectar fecha y hora explícitas — nunca ubicación, título ni descripción, porque no tiene esa lógica. En cuanto una orden mencionaba una fecha/hora (p. ej. "muévela a las nueve de la noche y ponla en el restaurante Cala Blava"), `local.changes` pasaba a ser `{time:'21:00'}` — un objeto con contenido — y el operador `||` descartaba entero `remote.changes`, aunque la IA remota sí hubiera entendido correctamente el resto de la orden (el restaurante). El cambio de hora se aplicaba bien; el cambio de ubicación se perdía en silencio, sin ningún aviso ni error visible.

**Corrección**: `changes` ahora se calcula como una fusión real de objetos — `{...(remote.changes||{}), ...(local.changes||{})}` — cuando al menos uno de los dos tiene contenido, y `null` si ninguno lo tiene. Local sigue teniendo prioridad en los campos que sí sabe detectar (fecha/hora, más fiable por no depender de la IA), pero ya no borra lo que remote haya entendido en cualquier otro campo.

**Cobertura de test**: `tests/conversation.test.mjs` ampliado — nueva prueba que combina un cambio de hora (detectado localmente) con un cambio de ubicación (solo detectable por la IA remota) en la misma orden, y comprueba que `changes` conserva ambos.

## 2026-09-20 — Editar una nota desde su biblioteca dejaba sin confirmación al guardar V0.22.8

Tercer hallazgo de prioridad media de la auditoría completa que se corrige.

**Causa raíz**: `editNoteFromLibrary(entry,onCancel)` tiene dos puntos de entrada — desde la ficha de una nota (`openNoteLibraryDetail`'s `onEdit`) y desde la propia lista de notas (`$("noteLibraryList")`'s acción "edit"). Ambos cierran la pantalla de origen ANTES de abrir el editor (`ui.closeNoteLibrary()`/similar), y ambos pasan un `onCancel` distinto y correcto para volver atrás si se cancela. Pero al GUARDAR con éxito, la función siempre hacía lo mismo sin importar desde dónde se había llamado: `ui.closeLayers();refreshNoteLibrary()` — `refreshNoteLibrary()` solo repinta el HTML interno de `#noteLibrary`, que en ese momento sigue oculto (se cerró antes de abrir el editor). Resultado: guardar los cambios de una nota siempre dejaba a la persona mirando la pantalla de inicio, sin ninguna nota, ficha ni lista visible que confirmara que el cambio se había aplicado.

**Corrección**: `editNoteFromLibrary` gana un tercer parámetro, `onSaved(updated)`, que cada punto de entrada decide según su propio contexto — mismo patrón ya usado para `onCancel`. Desde la ficha de una nota: `onSaved:updated=>{entry=updated;ui.closeLayers();show()}` (vuelve a la misma ficha, ya con los datos nuevos, reutilizando la variable `entry` capturada en el cierre de `openNoteLibraryDetail`, igual que ya hace `onToggle` un poco más abajo en la misma función). Desde la lista de notas: se define `backToLibrary` una vez y se usa tanto para `onCancel` como para `onSaved` (cancelar o guardar llevan al mismo sitio: la lista, ya refrescada con `noteLibraryItems()`, que relee `notes` en vivo). Si no se pasa `onSaved` (nadie más llama a esta función hoy, pero se mantiene por compatibilidad), cae al comportamiento antiguo.

**Cobertura de test**: `tests/note-library.test.mjs` ampliado — comprueba que `editNoteFromLibrary` acepta el tercer parámetro y lo usa cuando existe, y que los dos puntos de entrada reales pasan el `onSaved` correcto para su contexto.

## 2026-09-20 — Subida parcial de varios adjuntos dejaba huérfanos en Drive V0.22.7

Segundo hallazgo de prioridad media de la auditoría completa que se corrige.

**Causa raíz**: en `add()` (`js/app.js`), la subida de varios adjuntos a la vez itera `pendingImages`/`pendingFiles` subiendo uno a uno a Drive (`for(const file of pendingImages){images.push(await media.upload(...))}`). Si el segundo o tercer archivo fallaba (red, tamaño, cuota de Drive), el `catch` general solo entraba en la rama `if(hasMedia&&!mediaUploaded){clearPendingMedia();...}` — esta rama limpiaba el estado LOCAL (los archivos pendientes en memoria), pero nunca tocaba Drive: el primer archivo, que sí se había subido con éxito antes del fallo, se quedaba huérfano ahí para siempre, sin que ninguna entrada de Angeli lo referenciara. La rama hermana (`if(mediaUploaded)...`, para fallos DESPUÉS de que la subida completa hubiera terminado bien) sí hacía la limpieza correcta con `Promise.allSettled` — pero esa rama nunca se ejecutaba en este escenario, porque `mediaUploaded` solo se pone a `true` cuando TODA la subida termina sin errores. `uploadNoteAttachments` (la función equivalente usada al editar una nota) ya tenía el patrón correcto desde el principio; `add()` (usada para crear/editar cualquier otra entrada) nunca lo replicó.

**Corrección**: la rama `hasMedia&&!mediaUploaded` ahora también deshace lo ya subido (`Promise.allSettled([...images,...files].map(item=>media.remove(...)))`) antes de limpiar el estado local — mismo patrón ya usado en `uploadNoteAttachments` y en la rama hermana de más abajo.

**Cobertura de test**: `tests/media-context.test.mjs` ampliado — comprueba que esa rama del `catch` borra de Drive lo ya subido antes de limpiar el estado local.

## 2026-09-20 — Reclasificar un adjunto tipo nota escribía en el campo equivocado V0.22.6

Primer hallazgo de prioridad media de la auditoría completa que se corrige (los de prioridad alta ya están todos cerrados — ver la entrada de V0.22.1 para el contexto de la auditoría).

**Causa raíz**: `mediaLibraryItems()` (`js/media-library.js`) incluye adjuntos de TODOS los tipos de entrada, incluidas las notas (una nota puede llevar fotos/archivos adjuntos). Al abrir una de esas entradas desde "Fotos y archivos" y tocar "Clasificar ahora"/"Modificar clasificación", `openLibraryEntry`'s `onEdit` (`js/app.js`) siempre hacía `{...entry, mediaContext: normalizeMediaContext(values, noteSettings)}` — pero la categoría/relación real de una nota vive en `noteClassification`, no en `mediaContext`. Esto creaba una segunda clasificación divergente sobre la misma entrada: la pantalla de Notas seguía leyendo `noteClassification` de siempre, mientras que Fotos/archivos (`mediaLibraryItems()`) pasaba a preferir el `mediaContext` recién escrito — la misma nota mostraba una categoría distinta según desde dónde se mirase.

**Corrección**: en vez de intentar redirigir ese botón a la vía correcta de edición de notas (que habría duplicado lógica ya existente en `showNoteEditor`/`editNoteFromLibrary`), se quita el botón por completo para entradas de tipo nota — "Abrir nota" ya lleva a la ficha completa de la nota, con su categoría/relación real editable ahí. `showMediaEntryDetail` (`js/ui.js`) ahora distingue `isNote=entry.type==="note"` y omite el botón de clasificar (y las tarjetas de contexto pensadas solo para adjuntos sueltos) cuando la entrada es una nota.

**Verificado en el navegador sandbox**: `ui.showMediaEntryDetail` con una entrada `type:"note"` muestra solo "Volver"/"Abrir nota"; con una entrada `type:"photo"` sigue mostrando "Volver"/"Clasificar ahora"/"Añadir nota" exactamente como antes.

**Cobertura de test**: `tests/media-context.test.mjs` ampliado — comprueba que `showMediaEntryDetail` distingue explícitamente las notas y omite el botón de clasificar para ellas.

## 2026-09-20 — Auditoría completa del código: micrófonos huérfanos V0.22.5

Sexto y último hallazgo de prioridad alta de la auditoría completa (ver la entrada de V0.22.1 para el contexto de la auditoría en sí).

**Causa raíz**: `start()` (`js/app.js`) se autoapaga como un interruptor: si ya está `listening`, tocarlo de nuevo llama a `stop()` en vez de arrancar una sesión nueva — comportamiento correcto para "tocar el mismo micro dos veces". El problema es que ningún otro punto de la app garantizaba que `stop()` se hubiera llamado antes de que ese `listening` quedara huérfano: cancelar el modal "Te escucho" (`openDraft`'s `onCancel`), cancelar la pregunta de aclaración de una interacción activa (`continueConversation`'s `onCancel`), cancelar o guardar los editores de campo de Calendar/WhatsApp (`showCalendarFieldEditor`, `showCalendarDateTimeEditor`, `showWhatsAppEditor`, `showWhatsAppPhoneEditor`), y el propio `clearComposer()` tras un envío con éxito — ninguno de estos puntos paraba el reconocedor si seguía escuchando en ese momento. El reconocedor se quedaba vivo en segundo plano, y el PRIMER toque en cualquier OTRO micrófono de la app (un campo distinto, o el micro rápido "🛒" de la lista de la compra) entraba en `start()`'s guardia de autoapagado y solo apagaba ese fantasma — sin llegar a arrancar nada — obligando a un segundo toque para dictar de verdad. Es la misma familia de conflicto de `SpeechRecognition` ya diagnosticada y corregida una vez para el modal de "solo me falta un dato" (V0.21.95), pero recurrente en más sitios porque el arreglo de entonces fue puntual, no sistémico.

**Corrección**: una única función, `stopStrayDictation()` (`if(listening)stop()`), llamada desde cada uno de los puntos identificados arriba: `openDraft`'s `onCancel`, `continueConversation`'s `onCancel`, el `onCancel` y el `onSave` de los 4 editores de campo, `clearComposer()` (con lo que `openConversationModeReal()` queda cubierto de forma transitiva, ya que siempre llama a `clearComposer()` al entrar), y `shoppingQuickMic()` antes de arrancar su propio reconocedor.

**Verificado en el navegador sandbox** con un `SpeechRecognition` simulado que cuenta instancias activas: tocar el micro central, cancelar con "Ahora no", y comprobar que el número de reconocedores activos baja a 0 (antes de este arreglo se habría quedado en 1); tocar a continuación el micro rápido de la compra arranca al primer toque (antes habría hecho falta un segundo).

**Cobertura de test**: `tests/dictation.test.mjs` ampliado — comprueba que `stopStrayDictation()` existe y que se llama desde los 4 editores de campo (comparten el mismo patrón `onCancel`) más `openDraft`, `continueConversation`, `clearComposer` y `shoppingQuickMic`.

## 2026-09-20 — Auditoría completa del código: dos falsos positivos del intérprete V0.22.4

Hallazgos 4 y 5 de prioridad alta de la auditoría completa (ver la entrada de V0.22.1 para el contexto de la auditoría en sí). Los dos viven en `js/ai.js` y se arreglaron juntos por estar en el mismo archivo.

**Hallazgo 4 — `localCalendarUpdate` secuestraba frases cotidianas sin relación con Calendar**: a diferencia de `localCalendarCancellation` (la función justo encima, en el mismo archivo), que exige que la frase contenga una palabra de calendario (llamada/recordatorio/evento/cita...) antes de aceptar el borrado, `localCalendarUpdate` solo exigía un verbo cotidiano de "cambiar algo" (pasa/cambia/mueve/modifica/retrasa/adelanta/reprograma). Frases completamente normales como "Cámbiame el turno del trabajo, ponlo de tarde" o "Mueve la caja del salón al trastero" coincidían igual, y `protectCalendarInterpretation` sustituía la clasificación remota correcta (nota o tarea) por un falso "modificar evento" con un título inventado a partir de la propia frase.

**Corrección**: se añade una exigencia de contexto real, pero cuidando no romper frases legítimas ya cubiertas por los tests existentes como "Cámbiame la hora de Miguel" o "Pasa lo de Miguel al viernes a las once" (ninguna de las dos menciona una palabra de calendario explícita — solo el nombre de una persona). La condición final acepta la frase si trae CUALQUIERA de estas tres señales: una palabra de calendario (llamada/recordatorio/evento/cita/reunión/calendario), uno de los campos que de hecho se pueden cambiar (hora/fecha/día/ubicación/lugar/título — ya usados en la propia extracción del objetivo un poco más abajo en la misma función), o una fecha/hora real detectada por `temporalData` (el caso de "al viernes a las once"). Las frases sin ninguna de las tres señales (como los dos ejemplos de arriba) ya no se aceptan.

**Hallazgo 5 — "Recuérdame que revise los recordatorios del banco" se perdía como una consulta vacía**: `localReminderQuery`/`localNoteQuery` reconocen una consulta explícita buscando la palabra "que" seguida, en algún punto posterior de la frase, de "recordatorios"/"notas" (`/\b(?:que|...)\b.*\brecordatorios?\b/i`). "Recuérdame que revise los recordatorios del banco el viernes" es una orden normal para CREAR un recordatorio nuevo, pero "que" es una de las palabras más comunes del español, y si el propio contenido del recordatorio menciona "recordatorios" o "notas", el patrón de consulta coincide igual — `protectReadQuery` sustituye entonces la creación por una consulta (vacía, porque no hay ningún recordatorio real que buscar), y la orden original se pierde sin dejar rastro. Es la misma familia de falso positivo que ya se corrigió para `localImmediateCall` ("recuérdame llamar a X" no debe iniciar una llamada ahora mismo) — el guard nunca se generalizó a las dos funciones de consulta.

**Corrección**: se añade a `localReminderQuery` y `localNoteQuery` el mismo guard ya usado en `localImmediateCall` — si la frase contiene "recuérdame"/"recuérdamelo"/"recuérdala"/"recuérdalas", "recuerda" o "acuérdate", ninguna de las dos funciones de consulta la reconoce como tal, sin importar qué palabras traiga después.

**Cobertura de test**: `tests/conversation.test.mjs` ampliado con dos pruebas — una que comprueba que tres frases cotidianas con verbos de "cambiar" pero sin nada de calendario (los ejemplos exactos de arriba) devuelven `null`, y otra que comprueba que "recuérdame que..." nunca se confunde con una consulta aunque mencione "recordatorios"/"notas" en su contenido, verificando también que las consultas reales (sin "recuérdame") siguen funcionando igual que antes. Las pruebas existentes que sí dependían de reconocer "Cámbiame la hora de Miguel"/"Pasa lo de Miguel al viernes a las once" sin ninguna palabra de calendario explícita se usaron como guía para no estrechar la detección más de la cuenta.

## 2026-09-20 — Auditoría completa del código: aviso atascado si el evento de Calendar ya no existe V0.22.3

Tercer hallazgo de prioridad alta de la auditoría completa (ver la entrada de V0.22.1 para el contexto de la auditoría en sí). Este arreglo lo implementó un agente en un worktree aislado en paralelo mientras se trabajaba en otros hallazgos — la sesión principal revisó su diff, lo aplicó sobre el `main` actualizado (renumerando la versión, que el agente había calculado sobre una base ya adelantada por otros arreglos en paralelo) y lo verificó antes de enviarlo.

**Causa raíz**: `completeScheduledReminder`, `cancelScheduledReminder` y `deleteCalendarTracesFor` (`js/google.js`) comparten la misma ruta de backend — `persistent_google_action`'s rama `action=="delete"` (`backend/app.py`) — para borrar un evento de Calendar. Si ese evento ya no existe (el propietario lo borró a mano en Calendar, o ya se había borrado en un intento anterior), la API de Google devuelve 404/410, que `GoogleSessions.api()` convierte en `GoogleResourceNotFound`. Esa excepción no se capturaba en la rama de borrado — se propagaba como un fallo real hasta `finishPending` (`js/app.js`), que mostraba el mensaje "El aviso sigue activo en Calendar. Inténtalo de nuevo" (falso: el evento no existe, no está "activo") y nunca marcaba la entrada como hecha. Cada reintento repetía exactamente el mismo 404, así que el aviso quedaba atascado para siempre sin ninguna salida desde la interfaz. La rama de CONSULTA ("get") del mismo evento, justo al lado en el mismo archivo, ya tenía el patrón correcto (`except GoogleResourceNotFound: return {...,"exists":False}`) — el borrado nunca lo replicó.

**Corrección**: la rama `action=="delete"` de `persistent_google_action` ahora captura `GoogleResourceNotFound` y devuelve éxito (`{"alreadyDeleted": True}`) en vez de dejar que la excepción se propague — un borrado que ya no encuentra el recurso ES un éxito, porque el estado deseado (evento fuera de Calendar) ya se cumple. Al vivir los tres métodos de `js/google.js` en la misma ruta de backend, arreglarlo ahí los corrige a los tres de una vez sin tocar el frontend.

**Cobertura de test**: `backend/test_app.py::test_calendar_delete_of_already_gone_event_succeeds` — comprueba que borrar un evento inexistente devuelve 200 con `alreadyDeleted:true`, y que borrar uno que sí existe sigue funcionando igual que antes (sin ese campo). 45/45 tests de `backend/test_app.py` en verde.

## 2026-09-20 — Auditoría completa del código: badge "en vivo" mal oculto V0.22.2

Segundo hallazgo de prioridad alta de la auditoría completa (ver la entrada de V0.22.1 para el contexto de la auditoría en sí).

**Causa raíz**: `#shoppingLiveBadge` (`.live-badge{display:flex}`), `#shoppingFallbackAdd` (`.shopping-fallback-add{display:block}`) y `#shoppingSuggestions` (`.shopping-suggestions{display:flex}`) se ocultan y muestran alternando el atributo `hidden` (`ui.js`: `hideShoppingSuggestions`, `showShoppingSuggestionsMessage`, `renderShoppingSuggestions`, `setShoppingFallback`). Pero la regla `[hidden]{display:none}` del navegador y la regla de la propia clase (`display:flex`/`display:block`) tienen exactamente la misma especificidad (0,1,0) — cuando empatan, gana la que aparece más tarde en la cascada, y las reglas de clase de `styles.css` están después. Resultado: poner `hidden=true` en estos tres elementos NO los ocultaba de verdad. Es el mismo patrón exacto ya documentado y corregido dos veces antes en este proyecto (para `#dietarioLibrary`/`#shoppingLibrary` frente a `.action-modal`, y para `#shoppingOverview`/`#shoppingDetail`) — pero se coló de nuevo porque estos tres elementos se añadieron después de esas correcciones, y no hay ningún sitio único donde comprobar "¿todo elemento oculto con `hidden` tiene su override?" (la propia auditoría señaló esto como un problema de fondo: sería mejor un único bloque de reglas `[hidden]` consolidado en vez de ir parcheando uno a uno según se descubren).

**Corrección**: una línea más en `styles.css`, `#shoppingLiveBadge[hidden],#shoppingFallbackAdd[hidden],#shoppingSuggestions[hidden]{display:none}`, junto a las reglas ya existentes para `#shoppingOverview`/`#shoppingDetail`.

**Verificado en el navegador sandbox**: con `hidden=true`, `getComputedStyle` de los tres confirma `display:none`; quitando `hidden`, cada uno recupera su `display` real (`flex`/`block`/`flex`).

**Cobertura de test**: `tests/shopping.test.mjs` ampliado con una prueba que comprueba que las tres reglas `[hidden]` existen en `styles.css`.

## 2026-09-20 — Auditoría completa del código: cerrar sesión estaba roto V0.22.1

El propietario pidió una auditoría de punta a punta de toda la aplicación ("revisa la aplicación... encontrar fallos, errores... como si empezaras de cero"), dado que el proyecto arrancó con código ya escrito por otra IA y ha crecido desde entonces a base de parches puntuales. Se lanzaron 6 agentes en paralelo, cada uno cubriendo una parte de la app (lista de la compra/carrito, notas/adjuntos, recordatorios/calendario/contactos/WhatsApp, dietario/accesos directos/pantalla principal/modo conversación, sincronización/ajustes/notificaciones, y el backend de interpretación IA), con instrucciones de leer el código completo de su área, contrastarlo con el historial ya documentado aquí, y reportar bugs reales, fricción de UX y calidad de código — sin tocar nada. Se compiló un informe único con ~50 hallazgos, priorizados con el propietario antes de arreglar nada.

Este es el primero de los 6 hallazgos de prioridad alta, y el más grave de toda la auditoría: **cerrar sesión no funcionaba de verdad**, un fallo que llevaba ahí desde siempre y que nadie había detectado porque su síntoma (la app "pegada" en estado conectado) no genera ningún error visible inmediato.

**Causa raíz** (`js/firebase.js`, dentro de `onAuthStateChanged`): `if (nextUser?.email?.toLowerCase() !== OWNER_EMAIL) { if (nextUser) {...expulsar...}; return; }`. El encadenamiento opcional (`?.`) hace que, cuando `nextUser` es `null` (cerrar sesión, o abrir la app sin sesión previa), `nextUser?.email?.toLowerCase()` se evalúe como `undefined` — y `undefined !== OWNER_EMAIL` es `true`. Así que ESTE caso, el más común de todos (no hay ninguna cuenta), entraba en la rama pensada para "hay una cuenta pero no es la correcta". Como el `if (nextUser)` interno es falso, no expulsa a nadie — pero el `return` sí se ejecuta, saliendo de la función ANTES de llegar a `user = nextUser || null`, `stopListening()` (que desuscribe los 5 oyentes de Firestore: entradas, ajustes de notas, notificaciones, lista de la compra, accesos directos) y `callbacks.onAuthChange?.(session())` (que actualiza toda la interfaz). Resultado: pulsar "Cerrar sesión" en Ajustes no cerraba nada por dentro — la variable `user` seguía apuntando a la cuenta antigua, los 5 listeners seguían activos intentando leer con un token ya revocado, y la interfaz seguía mostrando el estado de sesión iniciada indefinidamente, hasta que esos listeners empezaban a fallar con `permission-denied` (mostrando entonces "Firestore no autoriza esta cuenta" — un mensaje que sonaba a fallo de permisos, no a que la sesión llevaba rato mal cerrada). Lo mismo afectaba al primer arranque de la app sin ninguna sesión guardada: `onSyncStatus` nunca llegaba a recibir `"signed-out"`, así que el indicador se quedaba en "Datos: conectando…" para siempre hasta iniciar sesión a mano.

**Corrección**: cambiar la condición a `if (nextUser && nextUser.email?.toLowerCase() !== OWNER_EMAIL)` — ahora solo se entra en la rama de "expulsar" cuando de verdad existe una cuenta y no es la correcta; un `nextUser` nulo (cerrar sesión o sin sesión previa) cae directo al flujo normal de abajo, que limpia todo como debía.

**Por qué nadie lo había visto**: el propietario usa la cuenta principal casi siempre conectada; "Cerrar sesión" es un botón que rara vez se pulsa a propósito fuera de pruebas, y el síntoma (todo parece seguir funcionando un rato, hasta que Firestore empieza a rechazar peticiones) no señala de vuelta a "cerrar sesión no cerró nada" de forma obvia.

**Cobertura de test**: `tests/firebase-auth.test.mjs` nuevo — comprobación de código fuente de que la condición de "cuenta equivocada" exige `nextUser` truthy antes de comparar el email, y de que la versión vieja (sin esa comprobación) ya no aparece en el archivo. No hay test funcional real (requeriría mockear el SDK completo de Firebase Auth, que se importa en vivo desde el CDN de Google) — mismo patrón que el resto de código acoplado a Firebase en este proyecto, verificado por lectura cuidadosa en vez de por ejecución.

## 2026-09-20 — Una foto clasificada ya no se queda huérfana sin forma de enviarse V0.22.0

Justo después de la V0.21.99, el propietario probó de nuevo: hizo una foto, la clasificó (categoría + relación) sin problema, pero al ir a "Galería" no aparecía — ni en "Archivos". Mandó una captura real: la miniatura de la foto se veía fija justo encima de los iconos del footer (Cámara/Fotos/Evento/Archivo), y explicó "si está ahí y la pincho, tampoco puedo abrirla. O sea, no hace nada." También pidió, con buen criterio, que "cuando está guardada debe desaparecer de ahí."

**Diagnóstico confirmado con logs reales de Cloud Run**: cero peticiones a `/media/upload` en la última hora, pese a que el propietario había completado el flujo de clasificación. Esto confirmó que la entrada nunca llegó a construirse ni a intentar subirse — no era un fallo de red ni de Drive, era que `add()` (la función que sube el adjunto y guarda la entrada) nunca se llegaba a llamar.

**Causa raíz**: `askMediaContext()` (`js/app.js`) abre `ui.showMediaContextEditor` (el modal "Organizar adjunto"). Al pulsar "Continuar", el `onSave` guardaba `pendingMediaContext`, cerraba ese modal (`ui.closeLayers()`) y mostraba un aviso ("Adjunto clasificado. Puedes añadir una instrucción o enviarlo.") — pero **ningún paso volvía a abrir el compositor**. Antes del rediseño de la pantalla principal (V0.21.87), el compositor con su textarea y su botón "➤ Enviar" estaba siempre visible al pie de la pantalla, así que terminar ahí no era un problema: se veía y se podía pulsar Enviar directamente. Desde que ese compositor pasa a estar oculto por defecto (`.composer[hidden]`), cerrar el modal de clasificación dejaba a la persona sin NINGÚN control visible para completar el envío — la miniatura en `#preview` (que sí queda visible, por estar fuera de `.composer`) se quedaba ahí para siempre, sin ninguna función de clic asociada (`ui.showImagePreview` nunca la tuvo: solo pinta `<img>` planas), y el aviso "puedes... enviarlo" prometía una acción que no existía en pantalla.

**Corrección**: se añade `openDraft()` justo después de `ui.closeLayers()` en el `onSave` de `askMediaContext()`. Esto abre el modal `showDraft` de siempre ("Te escucho", con micrófono y "➤ Enviar"), permitiendo terminar de completar la entrada con una instrucción dictada/escrita o enviarla tal cual, sin texto. Al pulsar Enviar, `add()` sube el adjunto de verdad y `clearComposer()` vacía `#preview` — la miniatura desaparece del footer exactamente como pedía el propietario, porque ahora sí hay un camino real para llegar a ese punto.

**Verificado en el navegador sandbox**, disparando un `change` real sobre `#photoInput` con un archivo simulado: se abre "Organizar adjunto"; al pulsar "Continuar" se cierra y se abre automáticamente "Te escucho" con el borrador (`#activeDraft`) listo, mientras la miniatura sigue en `#preview` a la espera de enviarse.

**Cobertura de test**: `tests/media-context.test.mjs` ampliado con una comprobación de código fuente de que `askMediaContext()` llama a `openDraft()` tras clasificar.

## 2026-09-20 — Fotos de cámara+galería mezcladas ya no se pierden; nuevo tipo de relación al vuelo V0.21.99

El propietario reportó que subir fotos "de cámara, como de fotos, no funciona bien": hizo una foto, la clasificó, y al ir a Multimedia no estaba; repitió la prueba combinando cámara y galería, con el mismo resultado.

**Diagnóstico con logs reales de Cloud Run** (`gcloud logging read` sobre `angeli-ai-interpreter`, backend por el que pasa toda subida a Drive vía `/media/upload`): en las últimas 6 horas solo aparecía UNA subida completada, pese a que el propietario describía varios intentos recientes con múltiples fotos. Eso descartaba un problema de Drive/red — las fotos "perdidas" ni siquiera llegaban a intentarse subir.

**Causa raíz encontrada en el código**: `prepareMedia(files,kind,message)` en `js/app.js` hacía `pendingImages=files` — una asignación directa, no una suma. Cada vez que se elige una foto (cámara → `readImages` → `prepareMedia`, o galería → lo mismo), esa línea SUSTITUÍA por completo lo que ya hubiera pendiente. Hacer una foto con la cámara y luego añadir también fotos de la galería descartaba en silencio la foto de la cámara — sin ningún aviso, sin ningún error, simplemente desaparecía del array antes de llegar siquiera a `media.upload()`. Coincide exactamente con lo reportado: "tanto de cámara como de fotos, no funciona bien" (mezclar las dos fuentes es justo lo que dispara el bug; usar solo una repetidamente, dentro del límite `multiple` de un único selector, no lo activa).

**Corrección**: `pendingImages=[...pendingImages,...files]` y lo mismo para `pendingFiles` — cada nueva selección se SUMA a la anterior en vez de reemplazarla.

**Segundo pedido en el mismo mensaje**: poder crear un tipo de relación nuevo (dio el ejemplo "Familia") en el momento de clasificar un adjunto, sin tener que ir antes a "Ajustes → Ajustes de notas" a crearlo primero — "no tener que ajustes para ponerla para luego ponerla aquí. En el momento que la estoy subiendo." El selector `mediaContextRelationType` de `showMediaContextEditor` (`js/ui.js`) ganó una opción `+ Nuevo tipo…`, que revela un campo de texto para el nombre del tipo nuevo. En `askMediaContext()` (`js/app.js`), si se elige esa opción, se llama a `addNoteSetting(noteSettings,"relationTypes",...)` y se persiste de verdad con `saveNoteSettings()` (la misma función pura y el mismo guardado ya usados desde la pantalla de Ajustes) ANTES de construir el `mediaContext` del adjunto — el nuevo tipo queda disponible para futuras clasificaciones exactamente igual que si se hubiera creado desde Ajustes.

**Cobertura de test**: `tests/media-context.test.mjs` ampliado con dos pruebas — que `prepareMedia` suma en vez de sustituir, y que el flujo de "+ Nuevo tipo…" crea y persiste el tipo de verdad. Verificado también en el navegador sandbox llamando a `ui.showMediaContextEditor` directamente: elegir "+ Nuevo tipo…" revela el campo, y el `onSave` recibe `{relationType:"__new__", newRelationType:"Familia", ...}` tal como espera `askMediaContext()`.

## 2026-09-20 — Modo conversación: el micrófono se abre solo V0.21.98

El propietario señaló otro "doble clic" innecesario, mismo espíritu que el de la búsqueda automática de contacto: "cuando yo clico para conversacional tengo que ir luego al micrófono, abrir el micrófono... si ya sabemos que quiero hablar. Por lo tanto, cuando abre ya directamente el micrófono abierto."

**Causa raíz**: `openConversationModeReal()` (`js/app.js`) ponía `conversationOn=true` y abría la pantalla (`ui.openConversationMode()`), pero nunca llamaba a `startConversationRecognizer()` — el micrófono se quedaba parado hasta que la persona tocaba el botón del micrófono dentro de la pantalla (`toggleConversationMic`). Entrar en modo conversación ya es, en sí mismo, la señal de que se quiere hablar — no hacía falta un segundo toque para confirmarlo.

**Corrección**: una línea, `startConversationRecognizer();` justo después de abrir la pantalla. El resto del ciclo de vida (parar al tocar el micrófono, reanudar tras cerrar un modal, parar al cerrar el modo conversación) no cambia — solo el arranque inicial deja de depender de un toque extra.

**Verificado en el navegador sandbox** con un `SpeechRecognition` simulado: tocar "modo conversación" deja el micrófono ya escuchando (`.listening` en `#conversationModeMic`, estado "Escuchándote…") sin ninguna otra acción.

**Cobertura de test**: `tests/conversation-mode.test.mjs` ampliado con una comprobación de código fuente de que `openConversationModeReal` llama a `startConversationRecognizer()` tras abrir la pantalla.

## 2026-09-20 — Llamar y WhatsApp buscan el contacto solos, sin un clic de más V0.21.97

El propietario probó "enviar WhatsApp a Ana" y notó que, una vez detectado el destinatario, tenía que tocar "Buscar contacto" y LUEGO elegir el contacto — dos toques donde debería bastar uno: "¿por qué no lo busca ya directamente?... menos es más. Y lo que queremos es que sea funcional." Después aclaró que el mismo patrón (un clic de más para que Angeli busque algo) le molestaba en general: "en WhatsApp, en teléfono, en muchas cosas que tiene que buscar... no tengo el por qué de hacer yo clic para que haga la búsqueda."

**Causa raíz**: en `add()` (`js/app.js`), justo antes de `ui.showEntryAction(entry,google)`, ya existía una búsqueda automática de contacto — pero con una condición demasiado estrecha: `if(shortcutContext?.direct&&interpretation.intent==="contact.call")`. Solo se cumplía cuando la orden venía EXACTAMENTE del acceso directo "📞 Llamar contacto" (el único shortcut con `action:"contact.call"` y `direct:true`). Cualquier otra forma de pedir una llamada (hablando o escribiendo la orden normal, sin pasar por ese acceso concreto) y CUALQUIER WhatsApp (ni siquiera tenía una rama para `whatsapp.compose`) se quedaban sin la búsqueda automática, mostrando primero una tarjeta con un botón "Buscar contacto" que había que tocar antes de ver el número.

**Corrección**: la condición pasa a `if((interpretation.intent==="contact.call"||interpretation.intent==="whatsapp.compose")&&!entry.phone)` — se busca sola para las dos intenciones, sin importar cómo llegó la orden, salvo que el número ya se conociera de antes (entonces no hay nada que buscar). `google.searchContact(note)` ya se autoprotegía para esto (`js/google.js`): sin `contactQuery` avisa y no hace nada; sin Contactos conectado, deja un error que `showEntryAction` ya sabía mostrar — no hizo falta tocar esa función.

**Cobertura de test**: `tests/shortcuts.test.mjs` actualizado — la prueba antigua que exigía literalmente `shortcutContext?.direct&&interpretation.intent==="contact.call"` se sustituyó por una que comprueba justo lo contrario (que YA NO depende de venir de un acceso directo) y que la nueva condición cubre ambas intenciones.

## 2026-09-20 — Cursor listo para escribir en todos los modales con su propio cuadro de texto V0.21.96

Tras la corrección de la V0.21.95 (el modal de "solo me falta un dato" no dejaba terminar la instrucción), el propietario avisó: "este error vamos a tenerlo en todas las modales" — su preocupación era que el mismo patrón de fallo pudiera repetirse en cualquier otro modal parecido.

**Auditoría realizada**: se repasaron los dos aspectos del fallo original por separado en cada modal de la app con su propio cuadro de texto o campo de dictado:

1. **Conflicto de micrófono** (dos `SpeechRecognition` compitiendo): solo ocurría porque `conversationModalKind()` clasificaba el modal de `showInteractionQuestion` como un caso especial ("question", detectado por buscar literalmente el id `#conversationDraft` en el DOM) que SÍ reanudaba el micrófono de fondo del modo conversación de forma inmediata. El resto de modales con su propio micrófono (`showCalendarFieldEditor`, `showWhatsAppEditor`) caen en la rama genérica "manual" de `conversationHandleOutcome`, que YA esperaba correctamente a que el modal se cerrase antes de reanudar — no tenían este problema. Confirmado leyendo el código de cada uno, sin necesidad de más cambios ahí.

2. **Cuadro de texto sin el cursor puesto** (pedido explícito de que "si vamos a tener que escribir ahí, no tiene por qué salirse [el foco]"): este sí afectaba a TODOS los modales con su propio campo, no solo al de la pregunta de aclaración. Se añadió `.focus()` justo después de `openModal()` en cada uno: `showDraft` (el borrador general, "Te escucho"), `showCalendarFieldEditor` (título/ubicación/descripción de un evento), `showCalendarDateTimeEditor` (fecha y hora — se enfoca el campo de fecha), `showWhatsAppEditor` (mensaje de WhatsApp) y `showWhatsAppPhoneEditor` (número de teléfono). `showInteractionQuestion` ya lo tenía desde la V0.21.95.

**Deliberadamente fuera de este cambio**: los editores de formulario más largos y menos ligados al flujo de dictado por voz (`showNoteEditor`, `showReminderEditor`, con varios campos cada uno) no se tocaron — no comparten el patrón de "un solo campo de dictado con micrófono propio" que motivó el reporte original, y forzar el foco en el primero de varios campos de un formulario largo no es claramente deseable (podría hacer saltar el teclado antes de que la persona haya visto el resto del formulario).

**Regresión encontrada al actualizar los tests**: `tests/conversation.test.mjs` ya tenía una prueba que afirmaba explícitamente `assert.equal(draft.focusCount,0)` tras abrir `showDraft` — alguien había dejado constancia deliberada de que ese modal NO se enfocaba antes. Actualizada a `focusCount,1` con un comentario explicando que es un cambio de comportamiento intencional de esta versión, no un descuido.

**Cobertura de test**: `tests/conversation-mode.test.mjs` ampliado con un bucle que comprueba los cinco modales (`showDraft`, `showCalendarFieldEditor`, `showCalendarDateTimeEditor`, `showWhatsAppEditor`, `showWhatsAppPhoneEditor`) enfocan su campo correspondiente. Verificado también en el navegador sandbox llamando a `ui.showWhatsAppPhoneEditor` directamente: el `<input type="tel">` queda como `document.activeElement` nada más abrirse.

## 2026-09-20 — Modo conversación: arreglado el modal de "solo me falta un dato" V0.21.95

El propietario reportó que, en modo conversación, cuando Angeli necesitaba un dato más para completar una orden (el modal "Solo me falta un dato" / `showInteractionQuestion`), no podía terminar la instrucción de ninguna manera: "si toco cualquier cosa, ya no puedo escribir nada... y al mismo tiempo también me da acceso para abrir el micrófono del modal. Y al final da error."

**Causa raíz**: `conversationHandleOutcome()` distingue varios tipos de modal según lo que Angeli necesita del usuario. El tipo `"manual"` (elegir una opción tocando la pantalla) ya esperaba correctamente a que el modal se cerrase antes de reanudar el micrófono de fondo del modo conversación (`watchForModalClose`). Pero el tipo `"question"` — el modal de `showInteractionQuestion`, que trae su PROPIO cuadro de texto y su PROPIO botón "🎙️ Hablar" — llamaba a `resumeConversationListening()` inmediatamente, reanudando el micrófono de fondo del modo conversación MIENTRAS ese modal seguía abierto con su propio micrófono disponible. Con dos `SpeechRecognition` compitiendo por el mismo micrófono, tocar el botón del modal intentaba arrancar un reconocedor nuevo mientras el de fondo ya lo tenía ocupado — el navegador lo rechaza (falla `rec.start()`), así que hablar no escribía nada en el cuadro y la instrucción se quedaba sin poder completarse nunca, sin ningún aviso claro de qué había pasado.

**Corrección**: la rama `"question"` ahora se comporta igual que `"manual"` — habla la pregunta, y espera a que el modal se cierre (`watchForModalClose`) antes de reanudar la escucha de fondo. Mientras el modal está abierto, su propio micrófono es la única vía de voz disponible, sin competencia.

**Segundo fallo relacionado, mismo mensaje**: "hay un espacio donde hay un texto para poner... no está puesto ahí para poner... aunque yo diga algo, no pone nada" — el cuadro de texto (`#conversationDraft`) se creaba y añadía al modal sin nunca enfocarlo (`draft.focus()` no existía), así que ni el cursor quedaba listo para escribir a mano ni, en apariencia, se notaba que dictar por voz sí escribía ahí (vía `ui.updateDraft`, que si funciona correctamente una vez arreglado el conflicto de micrófonos de arriba). Corregido añadiendo `draft.focus()` justo tras abrir el modal.

**Cobertura de test**: `tests/conversation-mode.test.mjs` ampliado — comprobación de código fuente de que la rama `"question"` ya no reanuda el micrófono de fondo directamente y sí usa `watchForModalClose`, y de que `showInteractionQuestion` enfoca el cuadro de texto al abrirse. Verificado también llamando a `ui.showInteractionQuestion` en el navegador sandbox: el cuadro queda con el foco (`document.activeElement`) nada más abrirse.

## 2026-09-20 — Ocultar del todo los accesos directos, y elegirlos ya preparados V0.21.94

Justo después de enviar "Gestionar accesos directos" (V0.21.93), el propietario aclaró que no era exactamente lo que pedía: "por eso te había dicho ocultar los accesos directos, esos. En pantalla. Ocultarlo... que no salga nada. Ni accesos directos ni el más ni nada. Se queda limpio." Es decir: quería un interruptor para dejar la pantalla principal sin nada en esa zona, no (solo) un modal para borrar accesos uno a uno.

**Por qué no bastaba con vaciar la lista**: `renderShortcuts()` siempre añade un botón "＋" al final del HTML generado, aparte de los accesos guardados — si `shortcuts` estuviera vacío igualmente seguiría viéndose el "＋". La única forma de dejar "limpio" de verdad es ocultar la sección entera (`#shortcutsSection`), no solo su contenido.

**Diseño elegido**: un booleano `shortcutsHidden` que viaja EN EL MISMO documento de Firestore que los propios accesos (`users/{uid}/settings/shortcuts`, ahora `{items, hidden}` en vez de solo el array) — se sincroniza entre dispositivos junto con ellos, con el mismo razonamiento que llevó a sincronizar los accesos en la V0.21.90: si se oculta en un sitio, debe quedar oculto en el otro. `cloud.saveShortcuts(items, hidden=false)` ahora acepta el segundo parámetro; el snapshot de `onShortcuts` pasa el documento completo (antes solo `snapshot.data().items`) para que `app.js` pueda leer también `.hidden`. Se cachea también en `localStorage` (`readShortcutsHidden`/`writeShortcutsHidden` en `js/storage.js`) para pintar sin esperar a la nube al abrir la app, igual que ya se hace con los propios accesos.

**Segundo pedido en el mismo mensaje**: "como había antes, que pudiera elegir ya accesos directos con su icono y todo ya puesto... crear accesos directos que ya estén ahí." Se sustituyó el botón "＋ Crear acceso manual" (que abría directamente el viejo flujo con dos `prompt()`, uno para el texto y otro para el nombre) por "＋ Elegir acceso directo", que abre un catálogo (`SHORTCUT_PRESETS` en `js/shortcuts.js`): los mismos `DEFAULT_SHORTCUTS` de siempre (por si se borró alguno y se quiere recuperar tal cual, con su icono ya puesto) más cuatro nuevos para funciones que ya existían en la app pero no tenían un acceso propio — Nueva nota, Añadir a la compra, Mañana, Esta semana. Tocar uno lo añade sin escribir nada; el picker excluye los que ya están en la pantalla principal (no tendría sentido ofrecer añadir uno que ya está). "✎ Crear uno personalizado" al final sigue dando salida al viejo flujo con `prompt()`, para lo que no encaje en el catálogo. El "＋" de la propia fila de accesos (en la pantalla principal) se enganchó al mismo `pickShortcutPreset()`, no solo el de Ajustes.

**Verificado en el navegador sandbox**: activar "🙈 Ocultar accesos directos" hace desaparecer la fila entera y el "＋", capturado en captura de pantalla; desactivarlo la devuelve; el catálogo de accesos excluye correctamente los 7 ya presentes y ofrece los 4 nuevos; elegir "📝 Nueva nota" la añade al instante a la fila sin pedir ningún texto.

**Cobertura de test**: `tests/shortcuts.test.mjs` ampliado — que ocultar afecta a `#shortcutsSection` entero (no solo vacía la lista), que el ajuste se sincroniza junto con los accesos, y que el catálogo de presets existe y se usa tanto desde Ajustes como desde el "＋" de la propia fila.

## 2026-09-20 — Gestionar accesos directos, dos accesos rápidos más y el micro ya no corta el dictado V0.21.93

Tres pedidos del propietario en el mismo mensaje, más un cuarto reportado aparte sobre el dictado.

**1. Quitar accesos directos de verdad, desde Ajustes**: pidió "poder quitarlos, o sea, que no ocultarlos". Ya existía `editShortcuts()` (wired a "✎ Editar accesos" en el menú), pero dependía de `prompt()` del navegador con una lista numerada — funcional pero muy pobre para el resto del nivel de esta app. Sustituido por `manageShortcuts()`: un modal real (`ui.openModal`) con un botón "🗑️ <nombre>" por cada acceso — tocarlo lo borra y refresca el propio modal (llamada recursiva a sí mismo) para seguir gestionando sin cerrar y reabrir. **Encontrado en la propia verificación en el navegador**: el botón de Ajustes abría el modal SIN cerrar antes `#settingsMenu` (a diferencia de "Ajustes de notas", que sí llama a `ui.closeLayers()` primero) — como `.settings-menu` tiene z-index:7 y `.action-modal` z-index:6, el modal quedaba tapado detrás del propio menú de Ajustes. Corregido igualando el wiring al de "Ajustes de notas".

**Efecto secundario necesario**: `.modal-actions` (la fila de botones de cualquier modal) usaba `display:flex` sin `flex-wrap`, pensado para los 2-3 botones habituales de confirmar/cancelar. Con hasta 9 botones (7 accesos + crear + cerrar) se habrían aplastado en una sola fila ilegible. Se añadió `flex-wrap:wrap` y `min-width:110px` a `.modal-actions button` — con 2-3 botones no cambia nada (siguen cabiendo en una fila), pero listas más largas envuelven en varias filas legibles. Beneficia de paso a cualquier otro modal con muchas acciones de este proyecto (p. ej. `showShoppingListChoice` con muchas listas), no solo a este.

**2. Dos accesos rápidos nuevos**: "Llamar" y "WhatsApp" junto a Notas/Recordatorios/Calendario (mismo `.quicknav-btn` del rediseño de home, V0.21.87). Reutilizan literalmente `DEFAULT_SHORTCUTS[2]`/`DEFAULT_SHORTCUTS[3]` (ya usados por la fila de accesos directos de siempre) en vez de redefinir el mismo objeto dos veces. `.quicknav` pasa de `display:flex` a `flex-wrap:wrap` (con `.quicknav-btn{flex:1 1 28%}`) para que los 5 botones queden en dos filas (3+2) en vez de aplastarse en una.

**3. El micro general cortaba el dictado a los 1-3 segundos** (reportado aparte, no por pausa del propio usuario): causa raíz, `rec.continuous=false` en `start()` (la función de dictado general reutilizada por "Toca para hablar", el compositor, los campos de Calendar, etc.) — con `continuous:false`, el reconocedor de voz da la sesión por terminada nada más entregar su primer resultado "final", no solo tras una pausa real. Corregido a `continuous:true` **solo en `start()`**: el modo conversación (`conversationRec`) y el micro rápido de la lista de la compra (`shoppingQuickMic`) siguen con `continuous:false` a propósito, ya documentado en el propio código — ahí cada sesión de reconocimiento es intencionalmente una sola orden completa, no una instrucción larga que pueda necesitar pensar a mitad de frase.

**Cobertura de test**: `tests/shortcuts.test.mjs` ampliado (gestión real de accesos sin `prompt()`, que cierra Ajustes antes de abrir el modal, los dos accesos rápidos nuevos reutilizando `DEFAULT_SHORTCUTS`); `tests/dictation.test.mjs` nuevo, comprobando `rec.continuous=true` en `start()` sin tocar `conversationRec`/el micro rápido de la compra. Verificado a mano en el navegador sandbox: el modal de gestión aparece por delante de Ajustes, borrar un acceso lo quita al instante de la lista y de la fila de la pantalla principal, y los 5 accesos rápidos caben en dos filas a 375px sin desbordar.

## 2026-09-20 — Acceso directo al carrito y detalle de precios en el historial V0.21.92

Nada más probar el carrito recién enviado (V0.21.91), el propietario pidió dos retoques puntuales:

1. **"Ver carrito" tenía que ser un acceso directo**, no algo escondido detrás del "⋮" — "que no tenga que ir a los tres puntitos para verlo". Se movió el botón a la misma fila que "Quitar comprados"/"Vaciar lista" (`.library-filters` dentro de `#shoppingDetail`), y se quitó del menú "⋮" para no duplicarlo (el historial de compras se queda ahí, ya que ese sí es un acceso secundario).
2. **El historial solo enseñaba los nombres de los artículos** ("cerveza especial San Miguel, tal") — el propietario quería poder pulsar una compra y ver el detalle con precios: "que sea más, con más información". Se añadió `ui.showPurchaseDetail(purchase)`, un modal con cada artículo (cantidad, precio unitario si hay más de una unidad, precio de esa línea) y el total de la compra abajo — reutilizando `purchase.items[].product.price`, el mismo precio que ya se guarda al vincular un artículo a un producto real de Mercadona. Cada tarjeta del historial (`shoppingPurchaseMarkup`) pasó de `<div>` a `<button>` con `data-shopping-purchase-id`, y ahora también enseña el total de un vistazo en la propia tarjeta, no solo dentro de la ficha.

**Cobertura de test**: 3 pruebas nuevas en `tests/shopping.test.mjs`, comprobación de código fuente (mismo patrón que el resto de regresiones de UI de este proyecto) de que "Ver carrito" está en la fila correcta y de que pulsar una compra llama a `showPurchaseDetail`.

## 2026-09-20 — Carrito de la compra e historial de compras V0.21.91

El propietario pidió esta función explicando cómo la usa en la app real de Mercadona: la lista habitual (lo que sueles comprar, ~20 artículos) es distinta de la compra concreta de un día (unos pocos de esos, con la cantidad de esa vez). Primero se publicó un boceto con pestañas dentro de la propia lista (mismo patrón que las listas y el rediseño anteriores), pero el propietario lo corrigió de inmediato: **"la lista se queda exactamente como estaba... no quites nada de ahí, solamente tienes que poner agregar al carrito"** — el boceto cambiaba visualmente la lista (pestañas, botones por artículo) y eso no era lo pedido.

**La corrección exacta, en sus palabras**: "ahora marcamos en la lista tú lo das por comprado ahora, ahora no, la función cuando yo lo marco en la lista es para añadirlo al carrito y sigue estando en la lista pero ya vacío, ya no marcado". Es decir: el check de la lista NO cambia de aspecto ni de mecánica — sigue siendo el mismo `.shopping-check`/`toggleShoppingItem` de siempre, con el mismo tachado visual al marcarlo. Lo único que cambia es su **uso**: en vez de dejarlo marcado como "ya comprado" indefinidamente, ahora se marca para seleccionar qué llevar hoy, se pulsa el botón nuevo "🛒 Añadir al carrito", y ese marcado se "consume": los artículos pasan al carrito y vuelven a quedar sin marcar en la lista — pero sin borrarse de ella. `checkShoppingItems`/`clearShoppingList({onlyChecked:true})`/"Quitar comprados" siguen exactamente igual que antes, sin tocar una sola línea — el propietario puede seguir usándolos como hasta ahora si quiere borrar algo de verdad.

**Modelo de datos**: cada lista (`js/shopping.js`) gana dos campos nuevos, `cart` y `purchases`, con normalización hacia atrás en `normalizeShoppingState` para listas guardadas antes de esta versión (arrays vacíos por defecto, igual que se hizo con `lists`/`items` en su momento). Funciones nuevas, todas en el mismo estilo que el resto del archivo (reciben `state`+`listId`, devuelven `state` nuevo): `addCheckedToCart` (copia lo marcado de `items` a `cart`, sumando cantidad si el artículo ya estaba en el carrito sin comprar, y desmarca en `items` sin quitarlo), `toggleCartItem`/`setCartItemQuantity`/`removeCartItem` (operan solo sobre `cart`, la lista no se entera), y `finalizePurchase` (archiva en `purchases` con la fecha de hoy solo lo marcado como comprado DENTRO del carrito — un `checked` distinto e independiente del de la lista — y deja el resto en `cart` tal cual: **"lo que haya en el carrito que no se haya comprado seguirá estando ahí"**, tal como pidió).

**Entrada a las pantallas nuevas**: en vez de tocar la cabecera o el buscador de la lista (que debían quedar intactos), "🛒 Ver carrito" y "🧾 Historial de compras" se añadieron como dos opciones más en el mismo menú "⋮" que ya existía para "Cambiar nombre"/"Eliminar lista" (`openShoppingListQuickActions`) — cero cambios visibles en la lista en sí. Carrito y Compras son dos `<div>` nuevos dentro de `#shoppingLibrary` (mismo patrón que `#shoppingOverview`/`#shoppingDetail`, alternando con `hidden`), reutilizando la misma cabecera compartida (título/subtítulo/botón volver) — `shoppingView` ahora acepta `"cart"`/`"purchases"` además de `"overview"`/`"detail"`, y "volver" desde ahí lleva a la lista de origen, no a "Mis listas" (están conceptualmente dentro de esa lista).

**Verificado end-to-end en el navegador sandbox** (importando `js/ui.js`/`js/shopping.js` reales, sin necesitar sesión de Firebase): añadir dos artículos al carrito desde la lista deja la lista intacta visualmente (misma captura de pantalla que antes de este cambio) y con los artículos sin marcar; marcar uno como "ya en el carro" y finalizar compra archiva solo ese con la fecha de hoy en el historial, dejando el otro artículo en el carrito para la próxima — exactamente el flujo descrito.

**Cobertura de test**: 9 pruebas nuevas en `tests/shopping.test.mjs` para toda la lógica pura del carrito y las compras (incluida la suma de cantidades al añadir el mismo artículo dos veces, y que nada del carrito afecta a la lista ni viceversa), más una prueba explícita de regresión (comprobación de código fuente) de que ninguno de los elementos existentes de la lista — buscador, "Quitar comprados", "Vaciar lista" — se tocó.

## 2026-09-20 — Accesos directos sincronizados entre dispositivos V0.21.90

El propietario reportó que el móvil tenía 7 accesos directos y el ordenador (PVA/PWA) solo 3, y que además quería que editar en un sitio (añadir o eliminar) se reflejara en el otro — "si yo elimino en un sitio, se quitan los dos sitios; y si agrego en un sitio, se agrega en el otro".

**Causa raíz**: `readShortcuts()`/`writeShortcuts()` (`js/storage.js`) solo leen y escriben `localStorage`, con clave `angeli_secretaria_shortcuts_v1`. A diferencia de la lista de la compra (`users/{uid}/settings/shopping`) o los ajustes de notas/avisos (`users/{uid}/settings/notes` y `.../notifications`), los accesos directos nunca se subían a Firestore — cada dispositivo llevaba su propia copia local, sin ninguna relación entre sí. El "7 vs 3" no era un fallo de sincronización fallando: es que nunca hubo sincronización en absoluto.

**Arreglo con el mismo patrón ya usado para el resto de ajustes**: nuevo documento `users/{uid}/settings/shortcuts` (`{items:[...]}`, ya autorizado por `firestore.rules` sin necesidad de desplegar nada — la regla existente cubre cualquier documento bajo `settings`), con `saveShortcuts(items)` y una suscripción `onSnapshot` igual que `noteSettingsDocument`/`shoppingListDocument`. `localStorage` se mantiene como caché de arranque (para pintar los accesos antes de que la sesión de Firestore esté lista), pero deja de ser la fuente de verdad.

**Migración transparente al primer login de cada cuenta**: si el snapshot remoto no existe todavía (`onShortcuts` recibe `null`), se sube lo que ya hubiera en este dispositivo (`cloud.saveShortcuts(shortcuts)`) en vez de sobrescribirlo con la lista vacía por defecto — mismo patrón que `normalizeShoppingState` uso para migrar el formato antiguo de la lista de la compra. Si el remoto SÍ existe (aunque sea con menos accesos que los locales), gana el remoto: es la fuente compartida. **Limitación aceptada conscientemente**: si dos dispositivos hacen este primer login "en paralelo" (los dos con la nube vacía a la vez), cada uno sube su propia copia local y gana el último en escribir — no hay resolución de conflicto de por medio, igual que ningún otro punto de sincronización de este proyecto la tiene; caso límite raro (solo ocurre una vez, en el primer login de una cuenta nueva) frente a la complejidad de resolverlo.

**Segundo problema en el mismo reporte, ya resuelto de una vez**: con más accesos ahora sincronizados y visibles, la fila `.shortcuts` con `overflow-x:auto` (desplazamiento horizontal) escondía la mayoría fuera de la pantalla — "que se vean todos, no haya que desplazarse". Cambiado a `flex-wrap:wrap` para que la fila crezca hacia abajo en vez de hacia los lados; verificado en el navegador sandbox a 375px de ancho que los 8 botones (7 accesos + "＋") caben en varias líneas sin desbordar.

**Cobertura de test**: `tests/shortcuts.test.mjs` ampliado — comprobación de código fuente (mismo patrón que el resto de regresiones de este proyecto) de que `saveShortcuts()` en `js/app.js` sube a `cloud.saveShortcuts`, que la migración solo sube si la nube viene vacía, y que `.shortcuts` ya no usa `overflow-x:auto`. La lógica de sincronización en sí (el snapshot de Firestore, la migración en el primer login real) no tiene test automatizado — vive en `js/firebase.js`, acoplado al SDK de Firestore, mismo patrón que el resto de sincronización de este proyecto, que nunca ha tenido test automatizado por esa misma razón.

## 2026-09-20 — Dietario: rango "Pendientes/Anteriores" y botón "+" para añadir V0.21.89

El propietario pidió dos cosas para el Dietario en el mismo mensaje: (1) un rango "pendientes o anteriores" además de Hoy/Esta semana/Todo, y (2) un "+" con desplegable dentro del propio Dietario para añadir sin salir a buscar el acceso.

**Causa raíz encontrada al mirar `groupDietarioByDay`**: los tres rangos existentes (`today`/`week`/`all`) comparten la misma condición base, `item.dateKey >= todayKey`, y solo cambian el límite superior — ninguno mira nunca hacia atrás. Esto significa que cualquier entrada activa (un aviso que nunca se canceló ni se completó, un evento que no se marcó) con fecha ya pasada **desaparecía del Dietario sin que ningún filtro la mostrara**, ni siquiera "Todo" — el propio nombre "Todo" era engañoso, porque en realidad significaba "todo lo futuro". El nuevo rango `pending` invierte la condición (`dateKey < todayKey`) y ordena de más reciente a más antiguo (lo contrario de los demás rangos, que van de más próximo a más lejano), para que lo más urgente de resolver aparezca primero. La sección "sin fecha" (que ya se enseña en todos los rangos existentes) se mantiene también aquí, porque una nota o tarea sin fecha también encaja en "pendiente".

**El botón "+" reutiliza literalmente las mismas funciones que el resto de accesos rápidos** de la V0.21.87/.88 (`openNewEventDraft()`, `prepareShortcut()` con los mismos objetos de acción para aviso/nota, y un simple `.click()` sobre los inputs de archivo ya ocultos en el footer para imagen/adjunto) — cero plumbing nuevo, tal como pidió explícitamente el propietario en el rediseño anterior ("las funciones siguen siendo las mismas, la diferencia son los accesos"). El modal se abre con `ui.openModal()` sin cerrar antes `#dietarioLibrary`, igual que `openDietarioQuickActions` — funciona sin ningún ajuste de z-index adicional porque `#dietarioLibrary` ya se bajó a z-index:4 en una corrección anterior, justo para este mismo patrón.

**Dos botones en la cabecera del Dietario, no uno**: al añadir el "+" junto al de cerrar, se encontró (verificado en el navegador, midiendo posiciones reales) que `.library-header` usa `justify-content:space-between` — con tres hijos (el título, "+" y "×"), el navegador los reparte a partes iguales por todo el ancho en vez de agruparlos, dejando el "+" flotando en mitad de la pantalla en vez de al lado de "×". Corregido metiendo ambos botones en un contenedor `.library-header-actions{display:flex;gap:6px}`, mismo patrón que `.header-actions` de la cabecera principal.

**Refresco automático**: como `render()` (la función que se llama tras cualquier guardado) no actualizaba el Dietario si estaba abierto detrás de un modal — patrón que sí existía para la lista de la compra pero no para el Dietario — se añadió la misma comprobación (`if($("dietarioLibrary").classList.contains("show"))refreshDietario()`) para que al añadir algo desde el nuevo "+", la lista de detrás se actualice sola en vez de quedar desactualizada hasta cerrar y reabrir el Dietario.

**Cobertura de test**: la lógica pura de `groupDietarioByDay` para el rango `pending` tiene test nuevo en `tests/dietario.test.mjs` (orden descendente, que no repite lo que ya enseñan los demás rangos, que la sección sin fecha se mantiene). La reutilización de las mismas funciones en el nuevo botón "+" y el contenedor `.library-header-actions` también tienen test (comprobación de código fuente, mismo patrón que el resto de regresiones de este archivo). El refresco automático del Dietario al guardar es DOM/wiring puro — verificado a mano en el navegador sandbox, sin test automatizado, mismo patrón que el resto de wiring de este proyecto.

## 2026-09-20 — Cuatro correcciones sobre el rediseño de la pantalla principal V0.21.88

Tras enviar el rediseño de la pantalla principal (V0.21.87), `chatgpt-codex-connector` (bot de revisión automática que sigue activo en GitHub pese a que el propietario dijo antes en el proyecto haberlo desconectado) dejó tres comentarios en la PR bloqueando el merge por `required_conversation_resolution: true`, y el propietario reportó por su cuenta, probando la app ya en real, un cuarto fallo real en las listas de la compra.

**Fallo 1 (bot) — sin voz, `start()` dejaba sin forma de escribir**: con el compositor de texto fijo ya oculto por el rediseño, `start()` salía inmediatamente si `SpeechRecognition` no existía en el navegador, sin abrir antes el modal de borrador — quien usa un navegador sin reconocimiento de voz se quedaba sin ninguna vía para escribir una instrucción a mano. Corregido llamando siempre a `openDraft()` primero (si no está en modo conversación) y omitiendo solo el arranque del dictado cuando no hay `SpeechRecognition`.

**Fallo 2 (bot) — un aviso push de recordatorio abría la app sin enseñar nada**: `focusPendingReminder()` hacía scroll hasta la entrada dentro de `#list`, que el rediseño oculta para siempre (ver la decisión de V0.21.87 de ocultar en vez de borrar). Corregido para que enseñe la misma ficha (`ui.showEntryAction`) que ya usa el resto de la app para ver una entrada existente.

**Fallo 3 (bot) — el modal de "¿a qué lista lo añado?" no se cerraba antes de añadir**: `ui.showShoppingListChoice` invocaba `onChoose(list.id)` sin llamar antes a `closeLayers()`, dejando la puerta abierta a un toque accidental de más que añadiera el artículo dos veces. Corregido cerrando el modal en cada opción antes de invocar el callback.

**Fallo 4 (propietario, real) — el menú "⋮" de una lista de la compra salía oculto detrás de la propia pantalla**: al tocar "⋮" en una tarjeta de lista para cambiar el nombre o eliminarla, "parece que no ha salido nada" hasta cerrar la lista, momento en el que aparece el modal. Causa raíz idéntica a un problema ya resuelto antes para el Dietario: `openShoppingListQuickActions` abre `ui.openModal()` (`.action-modal`, z-index:6) sin cerrar antes `#shoppingLibrary`, que comparte la clase `.media-library` (z-index:8) — el panel de fondo queda por delante del modal en vez de detrás. Corregido con la misma técnica que `#dietarioLibrary`: una regla por id, más específica, que baja `#shoppingLibrary` a z-index:4 solo para este panel, sin tocar el resto de pantallas que sí cierran su modal antes de abrir otro.

**Cobertura de test**: los fallos 1-3 son DOM/wiring en `js/app.js`/`js/ui.js`, acoplados a `SpeechRecognition`/notificaciones push/interacción real — sin test automatizado, mismo patrón que el resto de funciones de UI de este proyecto; verificados a mano en el navegador sandbox (mockeando la ausencia de `SpeechRecognition` y comprobando que el modal de borrador se abre igualmente). El fallo 4 sí tiene test nuevo, por ser una comprobación de CSS estática: `tests/shopping.test.mjs` ahora comprueba que `#shoppingLibrary` queda por detrás de `.action-modal` en `styles.css`, calcado del test ya existente para `#dietarioLibrary` en `tests/dietario.test.mjs`.

## 2026-09-20 — Rediseño de la pantalla principal V0.21.87

El propietario pidió un rediseño concreto de la pantalla principal, con un boceto visual publicado y aprobado antes de tocar código (mismo patrón que las listas de la compra): mic central sin cambios, dos botones redondos laterales nuevos, quitar el feed de conversación de la vista, accesos rápidos a Notas/Recordatorios/Calendario, y un footer solo con adjuntos + un botón de evento.

**Decisión de riesgo tomada explícitamente**: en vez de borrar el feed de conversación (`#list`), el compositor de texto (`.composer`) y el panel de búsqueda, se han dejado en el DOM pero ocultos con `hidden` (con una regla CSS explícita `.composer[hidden]{display:none}` etc., porque una clase propia con `display:flex`/`grid` empataría en especificidad con la regla `[hidden]` del navegador y no bastaría por sí sola para ocultarlos). Razón: decenas de sitios en `js/app.js` siguen escribiendo en `$("list").innerHTML`, dictando hacia `$("text")`, etc. — borrar esos elementos habría exigido revisar y adaptar toda esa lógica con mucho riesgo de romper algo que sigue funcionando por dentro (guardado de entradas, dictado del compositor interno que usan `openDraft()`/`showDraft()`, etc.). Ocultarlos consigue exactamente lo pedido ("aquí a la vista no es necesaria, pero se sigue guardando por dentro") sin tocar ese código.

**Mic de "añadir rápido" a la lista de la compra** (`shoppingQuickMic` en `js/app.js`): usa su propio `SpeechRecognition` independiente del compositor general — no pasa por `interpret()` ni por `classify()`, porque no es una instrucción cualquiera, siempre significa "añade esto a la lista de la compra". El resultado se pasa directo a `showShoppingAddConfirm(addition, listId)`, la misma función ya usada para "agrega X a la lista de Y" por voz/texto normal — se generalizó su parámetro `listId` para aceptar `null` (antes siempre exigía saber la lista de antemano): con `null`, si solo hay una lista se añade ahí sin preguntar, y si hay varias se abre un modal nuevo (`ui.showShoppingListChoice`) para elegir antes de guardar, tal como se pidió explícitamente ("si hay varias, pregunta a cuál; si solo hay una, la agrega y punto").

**Notas/Recordatorios/Calendario como accesos rápidos**: reutilizan `prepareShortcut()` con los mismos objetos de acción ya usados por los atajos existentes (`reminder.create`→"Recuérdame ", `calendar.create`→"Añade al calendario "), más uno nuevo para notas (`action:"note"`, sin prefijo) que no necesitó ninguna plumbing adicional — "note" ya es un intent válido de primera clase en todo el pipeline (`VALID_INTENTS`, `entryTypeForIntent`), así que forzarlo vía `routeShortcutIntent` funciona igual que cualquier otro atajo sin tocar nada más. El botón "Evento" del footer y "Calendario" de los accesos rápidos son deliberadamente la misma acción (`openNewEventDraft()`), tal como describió el propietario.

**Verificado en el navegador antes de enviar**: los tres accesos rápidos abren el modal de dictado con el prefijo correcto; el mic de añadir rápido no rompe nada aunque el permiso de micrófono esté bloqueado (aviso claro, sin excepción sin capturar); `ui.showShoppingListChoice` con datos de prueba genera un botón por lista y dispara el callback con el id correcto; comprobado a ancho de móvil real (375px) que caben los 7 iconos de la cabecera, los tres círculos, la fila de accesos rápidos y las 4 acciones del footer sin desbordar — el problema de espacio que motivó parte de este rediseño.

**Cobertura de test**: sin test automatizado nuevo — todo lo tocado es DOM/wiring en `js/app.js`/`index.html`/`styles.css`, mismo patrón que el resto de funciones de UI de este proyecto. Verificado a mano en el navegador (capturas, clics reales en cada botón nuevo) antes de enviar.

## 2026-09-20 — Dictado sin disparar búsqueda + acentos en el buscador de Mercadona V0.21.86

El propietario probó en real el dictado dentro del buscador de una lista (V0.21.85): tocó el micrófono, dijo "café", y no salió ningún resultado. Investigado el código de `start()` (`js/app.js`): la función `paint(value)` que actualiza el campo mientras se dicta hace `target.value=value` directamente — una asignación de `.value` desde JavaScript **nunca dispara un evento `input` nativo** en el DOM. El buscador de la compra depende justo de ese evento (`$("shoppingInput").oninput=scheduleShoppingSearch`) para lanzar la búsqueda en vivo, así que dictar nunca la activaba — solo escribir a mano, que sí genera eventos `input` reales del navegador. Corregido despachando `target.dispatchEvent(new Event("input",{bubbles:true}))` dentro de `paint()`: como `start()` es genérico y se reutiliza para dictar en cualquier campo (el compositor principal, el editor de campos de Calendar, la lista de la compra...), este fallo llevaba ahí desde siempre para cualquier campo con su propio `oninput` — no es exclusivo de la lista de la compra, solo que nadie lo había necesitado hasta ahora.

Mientras se investigaba esto, el propietario aportó el dato que resolvió la causa real de por qué "café" en concreto no encontraba nada: lo había escrito **sin tilde** ("cafe"). La búsqueda de `backend/mercadona_catalog.py` no ignoraba acentos, así que "cafe" nunca casaba con "Café" en el catálogo — un problema real e independiente del bug de dictado de arriba (ambos se descubrieron casi a la vez, pero son dos causas distintas). Corregido normalizando acentos (NFD + quitar marcas combinantes) tanto en los términos de búsqueda como en los nombres del catálogo antes de comparar, para que dé igual el acento en cualquiera de los dos lados — relevante sobre todo dictando, donde es fácil que la tilde no quede como se esperaba.

Justo después apareció un tercer caso real, mismo día: "café cápsula" (singular) no encontraba "Café en cápsulas" (plural) — la coincidencia por palabra completa (`\bpalabra\b`) que ya evitaba el falso positivo de subcadena ("entera" dentro de "enteras") también impedía que un singular casara con el plural del catálogo. Corregido reemplazando el emparejado por regex de palabra completa por una comparación por "raíces": cada palabra del nombre del producto y cada término de búsqueda generan un pequeño conjunto de candidatas (la palabra tal cual, y sin su "s"/"es" final si termina así) — mismo enfoque que `sameItemName` en `js/shopping.js` para los artículos de la lista. **Compromiso aceptado conscientemente, documentado en el test**: esto reintroduce que "entera" vuelva a casar con "enteras" (son la misma palabra en singular/plural, no hay forma de distinguirlo de "cápsula"/"cápsulas" sin un diccionario) — se prioriza el caso real reportado por el propietario (mucho más común: cualquier nombre de producto en plural) frente a un falso positivo teórico que nadie ha reportado como molesto en el uso real.

**Cobertura de test**: acentos y singular/plural tienen test nuevo en `backend/test_shopping_mercadona.py` (`test_search_ignores_accents_in_both_directions`, `test_matches_singular_against_a_plural_in_the_catalog_and_viceversa`), además de un test de subcadena renovado (`test_word_boundary_avoids_substring_false_positives`, ahora con "leche"/"lechera" en vez de "entera"/"enteras", que ya no aplica). El fallo de `paint()`/eventos `input` no tiene test automatizado — vive en `js/app.js`, acoplado al DOM y a la Web Speech API, mismo patrón que el resto de funciones de dictado de este proyecto, que nunca han tenido test automatizado.

## 2026-09-20 — Listas de la compra con nombre propio, buscador como primer paso V0.21.85

El propietario mandó una captura real de la app de Mercadona ("Listas": tarjetas por lista con miniaturas, "Crear nueva lista", barra de total abajo) y pidió que Angeli hiciera lo mismo. Antes de tocar código se publicó un boceto visual (artifact HTML con los tokens de color/tipografía reales de Angeli, navegable) y se esperó su aprobación explícita ("Está perfecto. Ahora sí.") — señal explícita del propietario de que quería ver el resultado antes de que se implementara, tras la experiencia previa de rondas de fallos encontrados solo al probar en real.

Mientras se preparaba el boceto, el propietario añadió dos matices por su cuenta que cambiaron el diseño antes de aprobarlo:
1. "Antes de agregar leche, que me salga el buscador con las listas de Mercadona, y ya añadiría desde ahí — es más realista." → el buscador pasa de ser una función más a ser el **primer paso** de añadir, no un botón aparte.
2. "Ese buscador podría salir en modal. Agregar lista de la compra X, saldría el buscador ya puesto." → pedir un solo artículo por voz/texto ("agrega leche a la lista de Fran") abre un modal de confirmación con la búsqueda ya lanzada, en vez de vincular el producto en silencio por detrás como hacía antes `linkMercadonaMatches`.

**Decisión de arquitectura tomada sin desplegar nada nuevo**: varias listas con nombre podrían vivir en una colección nueva de Firestore, pero el fallo real de sincronización de la V0.21.80 fue justo por guardar en una colección ("lists") que `firestore.rules` no autoriza. Para no repetir ese error ni necesitar otro despliegue de reglas, todas las listas siguen viviendo en un único documento (`users/{uid}/settings/shopping`, la misma ruta de siempre, ya autorizada), con forma `{lists:[{id,name,items}], activeListId}` en vez de `{items}`. La migración del formato antiguo a este nuevo es automática y silenciosa (`normalizeShoppingState` en `js/shopping.js`): si el documento no tiene `lists`, sus `items` sueltos se envuelven en una lista llamada "Mi lista".

**Reconocimiento de listas por nombre en comandos de voz/texto**: `parseShoppingCommand` (`js/shopping.js`) ahora recibe los nombres reales de las listas del usuario y construye el patrón de "disparador" dinámicamente — "lista de Fran" gana sobre las frases genéricas ("lista de la compra") si el nombre coincide. Encontrado y corregido durante las pruebas: `\b` (límite de palabra) en JavaScript es ASCII-only y **nunca casa justo después de una vocal con tilde** ("Mamá\b" no encuentra límite tras la "á", porque esa "á" ya cuenta como "no-palabra" para \b, igual que lo que la sigue) — un fallo que habría hecho que nombres de lista con tilde (Mamá, Papá, José...) nunca se reconocieran por voz. Corregido con una comprobación manual de que no continúa con otra letra/dígito en vez de `\b`.

**El modal de confirmación es solo para un artículo a la vez**: con varios artículos en la misma orden ("añade leche, pan y huevos..."), o si la tienda es Consum (sin catálogo de búsqueda), se añaden directos como antes — mostrar un modal en cadena por cada artículo se descartó por complejidad de estado frente al beneficio, ya que el caso principal pedido explícitamente era de un solo artículo.

**Verificado en real en el navegador antes de dar por bueno** (no solo con los tests unitarios): construcción del modal de confirmación y de las tarjetas de lista con datos de prueba inyectados directamente contra `ui.js` real (importado en la página), comprobando que los callbacks `onInput`/`onPick`/`onFallback` disparan con los valores correctos. Se encontró y corrigió así mismo un fallo real: el enlace de "añadir tal cual" y elegir un resultado de búsqueda no pasaban por la comprobación de sesión iniciada (`runShoppingCommand` sí la tenía, pero eran caminos distintos) — sin sesión decían "Añadido a la lista" con un toast, aunque no se guardara nada; movido el aviso a `persistShoppingState`, el único punto por el que pasa cualquier cambio real a una lista, que ahora devuelve si el guardado se intentó de verdad para que el resto del código no muestre un mensaje de éxito encima.

**Cobertura de test**: `tests/shopping.test.mjs` ampliado a 38 pruebas — gestión de varias listas (crear, renombrar, borrar sin dejar nunca el estado sin ninguna lista, cambiar la activa, migración del formato antiguo), y el reconocimiento del nombre real de una lista en cada acción (añadir/quitar/marcar/vaciar/abrir/buscar), incluido el caso de la tilde que causó el fallo de \b.

## 2026-09-20 — Pendiente anotado (sin arreglar todavía): el Dietario no refleja el Calendar real

El propietario lo detectó comparando dos caminos que deberían decir lo mismo y no coinciden: el acceso "Calendario" de la cabecera (`agendaOpen`, atajo "Muéstrame mi agenda" → `calendar.query`) sí le mostró sus eventos reales de Google Calendar ("comprar mostaza", "disco duro portable"), pero el Dietario → filtro "Eventos" no mostró ninguno de esos — solo una entrada suelta para marzo de 2027 que había creado él mismo alguna vez a través de Angeli.

**Causa raíz, confirmada leyendo el código**: `js/dietario.js` (`dietarioEntries`, `groupDietarioByDay`) es una vista puramente local — filtra y agrupa lo que ya hay en `notes` (Firestore), nunca llama a Google Calendar. Una entrada solo aparece en el Dietario si Angeli la creó y la guardó como entrada propia (`type==="calendar"`, de un `calendar.create`). Los eventos que existen de verdad en el Google Calendar del propietario pero que no pasaron por Angeli (creados directamente en la app de Calendar, o de antes de usar Angeli) no están en `notes` y por tanto nunca aparecen en el Dietario. En cambio, `calendar.query` (el acceso de la cabecera, y los atajos "Hoy"/"Próxima semana") sí golpea la API real de Calendar vía `google.searchCalendar`.

**Lo que pidió el propietario, textualmente**: que el Dietario, al elegir "Eventos" (y por extensión "Avisos"/"Notas"), vaya a mirar de verdad qué hay — y que si hace un cambio en el Calendar real, se refleje ahí. Es decir: quiere que el Dietario sea una vista en vivo, no un registro de lo que Angeli recuerda haber hecho.

**Por qué no se ha arreglado en el momento** (pidió explícitamente "anótatelo" y siguió con otra cosa, así que se documenta para abordarlo aparte): es un cambio de arquitectura, no un bug de una línea. Haría falta decidir: (a) cuándo disparar la consulta real a Calendar (¿al abrir el Dietario? ¿al elegir el filtro "Eventos"? ¿cachear cuánto tiempo?), (b) cómo fusionar eventos reales de Calendar (que no tienen `id` de Angeli) con las entradas locales que sí llevan aviso/nota asociada sin duplicar ni perder la relación con su entrada original, y (c) el coste de llamadas a la API de Calendar cada vez que se abre una pantalla que hasta ahora era gratis (sin red). Encaja con el patrón ya usado en `calendarQueryRange`/`google.searchCalendar`, así que la pieza base ya existe — el trabajo real es la fusión y el momento de disparo, no inventar el acceso a Calendar desde cero.

**Relacionado**: la limpieza de `calendar.query` en el Dietario (V0.21.76, `entryActive` excluye `aiIntent.intent==="calendar.query"`) resolvió un síntoma parecido pero distinto — que las CONSULTAS en sí no se acumularan como entradas fantasma — no toca este problema de fondo (el Dietario nunca consulta Calendar para las entradas de verdad).

## 2026-09-20 — Cabecera: quitado el icono de Calendario (se salía de la pantalla en el móvil) V0.21.84

Reportado por el propietario: en el móvil, tras añadir el icono 🛒 de la lista de la compra, la cabecera ya no le cabía — el icono de Ajustes (☰) quedaba fuera de la pantalla, inalcanzable. Pidió quitar directamente el icono de Calendario (🗓️, `agendaOpen`) de la cabecera porque ya tiene el mismo acceso abajo, en los accesos directos ("🗓️ Hoy" / "🗓️ Próxima semana", ya existentes en `DEFAULT_SHORTCUTS` desde antes de esta sesión) — confirmado que son funcionalmente idénticos (mismo `command`/`action:"calendar.query"`/`direct:true`). Quitado el botón de `index.html` y su `onclick` en `js/app.js`; `prepareShortcut()` sigue usándose para los accesos directos normales.

**Pendiente de la propia petición del propietario, no resuelto aquí**: dijo explícitamente "vamos a cambiar el aspecto de la aplicación, el frontend" como tema — este cambio es solo el ajuste puntual de la cabecera que pidió de forma concreta, no el rediseño visual más amplio que insinuó (dijo "tenemos cosas repetidas" sin más detalle todavía). Queda a la espera de que concrete qué quiere cambiar del aspecto general antes de tocar nada más de la interfaz.

## 2026-09-20 — Lista de la compra: botón de búsqueda explícito V0.21.83

Reportado por el propietario probando en el móvil, tras la ronda anterior (V0.21.82) donde ya había verificado el catálogo/cantidades en el navegador de escritorio: "no hay ningún botón para poder buscar... lo único que me deja es a la derecha el micro y un más". La búsqueda en vivo al escribir (V0.21.82) funcionaba, pero era invisible como funcionalidad — nada en la interfaz decía que escribir ya buscaba, así que en el móvil, donde además el usuario probó pulsar "+" esperando que buscara, el "+" simplemente añadía el texto tal cual.

Segundo fallo real encontrado con la frase exacta que el usuario probó: "busca leche en la lista de la compra" (sin decir "Mercadona") no coincidía con `SEARCH_TRIGGER` (que exigía mencionar `mercadona|consum` explícitamente) y cae en el flujo de "add" genérico — "busca leche" se guardó literalmente como nombre de artículo, justo lo que el usuario reportó ver.

Corregido:
- Botón "🔍" explícito (`#shoppingSearchBtn`) que llama a `runShoppingSearch` al momento (sin el debounce de 350ms de la búsqueda en vivo, innecesario en una acción explícita), y estados visibles "Buscando en Mercadona…" / "Sin resultados en Mercadona" en vez de una lista vacía silenciosa. Antes, `renderShoppingSuggestions([])` llamaba a `hideShoppingSuggestions()`, así que un resultado vacío y "no ha empezado a buscar todavía" se veían exactamente igual — indistinguibles para quien está probando.
- Nuevo patrón `SEARCH_TRIGGER_GENERIC` en `js/shopping.js`: "busca/mira/enséñame/dime X en la lista de la compra|del súper" (sin nombrar tienda) se entiende como búsqueda en Mercadona — el único catálogo con búsqueda real ([[shopping-list-mercadona-api]] documenta por qué solo Mercadona). Se comprueba después de `SEARCH_TRIGGER` (que sigue ganando si se nombra la tienda explícitamente) y antes de caer al flujo genérico de "add".
- Pista visible bajo el campo ("🔍 busca en Mercadona · ＋ añade el texto tal cual") — la lección de esta ronda es que una función que solo se descubre escribiendo y esperando no cuenta como descubrible; hace falta decirlo.

**Metodología**: igual que la ronda anterior, verificado contra la sesión real del propietario vía Claude en Chrome antes de darlo por bueno, no solo con los tests unitarios.

**Cobertura de test**: `tests/shopping.test.mjs` ampliado a 25 pruebas (la frase exacta reportada, "busca leche en la lista de la compra" → `{action:'search', store:'mercadona'}`).

## 2026-09-20 — Lista de la compra: catálogo fiable, cantidades +/-, búsqueda ampliada V0.21.82

El propietario pidió explícitamente esta vez que las pruebas las hiciera yo mismo en su aplicación real (producción, con su sesión ya iniciada en Chrome), en vez de ir probando él a mano y reportando una cosa cada vez. Usé las herramientas de Claude en Chrome para operar su pestaña real de `franbermudezes-cloud.github.io/angeli_secretaria` (nunca su micrófono/voz — eso no lo puedo simular — pero sí el mismo camino de texto que usa `add()` para cualquier orden). Encontré así, antes de que él tuviera que reportarlos, varios fallos reales:

1. **Catálogo de Mercadona con categorías enteras desaparecidas**. Al buscar "leche" en la app real no salía ninguna leche de verdad, solo "café con leche", "chocolate con leche", etc. Confirmado con una consulta directa a la API real de Mercadona (fuera de Angeli) que "Leche semidesnatada Hacendado" y variantes sí existen en el catálogo público. La causa estaba en `backend/mercadona_catalog.py`: la construcción del catálogo lanza ~150 peticiones concurrentes (una por subcategoría) y, si cualquiera fallaba (razonable con esa concurrencia contra un servidor de terceros), se descartaba sin reintento — sus productos desaparecían del catálogo cacheado durante las 12h completas de TTL, sin ningún aviso. Corregido con reintento (hasta 3 intentos por categoría) y un umbral mínimo de tamaño (`CATALOG_MIN_PRODUCTS=1500`, el catálogo completo real tiene ~4600 productos, confirmado recorriéndolo entero sin fallos con 8 workers): si una construcción sale muy por debajo, se usa igualmente si no hay nada mejor pero se reintenta a los 5 minutos, y nunca se pierde un catálogo previo más completo por uno peor construido después.
2. **Falso positivo por subcadena**: "leche entera" (para pedir la leche entera, no cualquier "leche") encontraba "Chocolate con leche Hacendado almendras enteras" porque "entera" es subcadena literal de "enteras". La comparación `all(term in name for term in terms)` no distinguía palabras completas. Corregido con `\bpalabra\b` por cada término.
3. **Solo 6 resultados en el buscador manual** — el propietario pidió expresamente poder explorar más ("cuántas marcas de cerveza habrá... salen 20 y solo veo 6"). Se distinguió el límite por defecto (6, para el emparejado automático por voz que solo necesita el mejor candidato) del límite de la búsqueda interactiva (ahora pide 20; el backend admite hasta 30 vía el nuevo campo `limit` en el payload de `/shopping/mercadona/search`).
4. **"leche" y "2 leches" no se sumaban, creaban dos filas** — comparación de nombres por igualdad exacta, sin tener en cuenta singular/plural español. Sin diccionario no se puede saber con certeza si el plural de una palabra se forma con "+s" (leche→leches) o "+es" (yogur→yogures), así que `sameItemName()` (`js/shopping.js`) prueba ambas reducciones como candidatas de "raíz" y considera el mismo artículo si alguna coincide entre los dos nombres. Aplica a añadir, quitar y marcar como comprado.
5. **Sin forma de ajustar la cantidad de un artículo ya en la lista** — el propietario fue explícito: un "+" y un "−" en la misma línea, nada de campo de texto ni scroll. Añadido `setShoppingItemQuantity` (clamp 1-99) y un stepper compacto en cada fila (`js/ui.js`, `shoppingItemMarkup`).
6. **"busca leche en la lista de mercadona" se enviaba como nota** — el propietario dijo exactamente esa frase; no contiene "lista de la compra" así que `parseShoppingCommand` no la reconocía en absoluto y caía en el intérprete normal. Añadido `SEARCH_TRIGGER`, un patrón independiente para "busca/mira/enséñame/dime X en/de mercadona|consum" que abre la lista y lanza la búsqueda directamente — para Consum, que no tiene catálogo de productos ([[shopping-list-mercadona-api]] tiene el porqué), se avisa de la limitación en vez de intentar una búsqueda que nunca daría nada.

**Metodología de esta ronda**: el propietario pidió priorizar dejar "buscador, agregar artículos, lista" perfectamente pulidos ANTES de tocar la integración con el asistente de voz — así que esta entrega es deliberadamente frontend+backend de la lista de la compra en sí, sin tocar `js/ai.js`'s `interpret()` ni el prompt de Gemini. Verificado en real contra su propia sesión y sus propios datos (llegó a ver "leche" (1) y "2× leches" como filas separadas de un fallo previo — confirma exactamente el bug del punto 4).

**Cobertura de test**: `tests/shopping.test.mjs` ampliado a 24 pruebas. `backend/test_shopping_mercadona.py` ampliado con `MercadonaCatalogBuildTests` (reintento tras fallo transitorio, catálogo muy pequeño se usa pero se reintenta pronto, un catálogo previo mejor nunca se pierde) — todo contra árboles de categorías simulados en memoria, nunca contra tienda.mercadona.es real en los tests.

## 2026-09-20 — Lista de la compra: 4 fallos reales tras la primera prueba V0.21.81

El propietario probó la V0.21.80 nada más desplegarse y encontró cuatro problemas reales, todos por uso real (no simulables sin sesión firmada, así que se investigaron leyendo el código y se verificaron a mano en el navegador donde fue posible).

1. **Sincronización entre dispositivos rota** — root cause encontrado en `firestore.rules`: solo autoriza `users/{userId}/entries/{entryId}` y `users/{userId}/settings/{settingId}`. La lista de la compra se había guardado en `users/{uid}/lists/shopping` (colección nueva, "lists", no contemplada en las reglas), así que Firestore denegaba la escritura y la lectura en el servidor sin que hubiera ningún error ruidoso — el dispositivo que la creó la veía igual porque `persistShoppingList()` actualiza el estado local antes de esperar la confirmación del servidor (igual que `saveConfirmed` con las notas), pero el guardado real fallaba en silencio (solo un toast fácil de no ver) y ningún otro dispositivo la recibía nunca. Corregido cambiando el documento a `users/{uid}/settings/shopping` (`js/firebase.js`, `shoppingListDocument()`) — reaprovecha una colección ya autorizada, así que no hizo falta tocar `firestore.rules` ni desplegar nada.
2. **Modal de dictado fijo en pantalla** — al dictar "añade patatas a la lista de la compra" desde el botón de dictado normal (no modo conversación), `start()` llama a `openDraft()` ANTES de que el texto llegue a `add()`. El atajo de la lista de la compra en `add()` hacía `clearComposer()` y volvía, pero nunca llamaba a `ui.closeLayers()` — a diferencia del resto de instrucciones, que sustituyen el contenido del modal por la confirmación (`ui.showEntryAction`) en vez de dejarlo abierto con contenido obsoleto. Corregido añadiendo `ui.closeLayers()` en ese mismo punto.
3. **Un comando de la lista se coló como respuesta a una nota pendiente sin relación**, solo reproducible desde modo conversación. Causa encontrada leyendo `conversationActiveQuestionEntry()`: busca en *todas* las `notes` cualquier entrada con `interaction.status==="awaiting_input"`, sin ninguna relación con la instrucción que se acaba de decir — un fallo pre-existente y más general de la app (cualquier instrucción nueva mientras haya una pregunta pendiente de OTRA cosa se trata como si fuera su respuesta), no específico de esta función. El atajo de la lista de la compra empeoraba esto porque exigía `!active` para dispararse, así que en cuanto había cualquier interacción pendiente en cualquier parte, dejaba de reconocer comandos de la lista por completo. Corregido solo en el alcance de esta función: quitado el requisito `!active` del atajo — un comando inequívoco ("...lista de la compra") se reconoce siempre, tenga o no una interacción pendiente de otra cosa. El problema de fondo (cualquier interacción pendiente antigua secuestra la siguiente frase, sea cual sea) queda **sin corregir, documentado aquí como conocido**: arreglarlo de raíz tocaría el flujo general de continuación de conversación (`resolveConversationTurn`/`conversationActiveQuestionEntry`), con más riesgo de romper flujos ya probados en producción — fuera del alcance de esta corrección.
4. **Buscador de Mercadona sin resultados que elegir, y sin micrófono en la pantalla de la lista** — el diseño original (V0.21.80) solo buscaba en Mercadona *después* de guardar un artículo con "de mercadona" explícito, en segundo plano y sin mostrar nada al usuario hasta que ya estaba vinculado. No había ninguna forma de ver coincidencias antes de decidir, ni de dictar directamente en esa pantalla. Añadido: búsqueda en vivo mientras se escribe en el campo de texto (debounce de 350ms, mínimo 2 caracteres, con un número de secuencia para descartar respuestas obsoletas si se seguía escribiendo), mostrando hasta 6 coincidencias con precio; tocar una la añade ya vinculada al producto exacto. Añadido también un botón de micrófono (`#shoppingMic`) que reutiliza `start({inConversation:true,draftId:"shoppingInput"})`, el mismo mecanismo de dictado dirigido a un campo concreto que ya usaba el editor de campos de Calendar.

**Extra pedido de paso** (cantidad de artículos, "quiero uno, quiero dos"): añadido soporte de cantidad en `js/shopping.js` (`extractQuantity`, dígitos o palabras hasta diez) — "añade 2 leches" guarda `quantity:2`; si el artículo ya estaba pendiente, las cantidades se suman en vez de duplicar la fila. Deliberadamente solapa con el artículo indefinido ("una leche" se interpreta igual que "leche", cantidad 1) para no crear ambigüedad.

**Cobertura de test**: `tests/shopping.test.mjs` ampliado de 15 a 19 pruebas (cantidades en dígitos/palabras, el caso "una leche", `describeShoppingItems` con cantidad). Los cuatro fallos originales se verificaron a mano en el navegador local (sin sesión real, así que solo hasta el punto donde el guard de "inicia sesión" corta el flujo) inspeccionando directamente el DOM antes/después de cada acción — confirmado que el modal se cierra y que el atajo de la lista se reconoce sin más before condiciones. La sincronización entre dispositivos y el secuestro de conversación real solo los puede confirmar del todo el propietario con su sesión real en dos dispositivos.

## 2026-09-20 — Nueva función: Lista de la compra + catálogo de Mercadona V0.21.80

El propietario pidió una lista de la compra ("anota la lista de la compra: esto, lo otro") y, específicamente, que se pudiera consultar el catálogo real de Mercadona y Consum para decir "la leche de Mercadona" y que Angeli supiera identificar el artículo. Pidió montarlo todo de principio a fin sin preguntar nada a mitad de camino, así que las decisiones de diseño quedan documentadas aquí en vez de haberse confirmado antes con él.

**Por qué es una función propia y no otra nota.** Una lista de la compra se usa marcando artículos uno a uno mientras se va por el súper — necesita checklist, no otra burbuja de conversación. Se montó como pantalla dedicada (botón 🛒), con su propio documento en Firestore (`users/{uid}/lists/shopping`, mismo patrón que los ajustes de notas/notificaciones: un documento, no una colección de entradas), completamente al margen de `notes`.

**Por qué el reconocimiento de voz es local y no pasa por Gemini.** El sistema ya tiene un patrón probado para esto: intents que se resuelven de forma determinista antes de tocar la IA (`localReminderQuery`, `localImmediateCall`, `protectCalendarInterpretation`...). "Añade leche a la lista de la compra" es una orden estructurada simple (verbo + artículos + tienda opcional), así que se reconoce igual (`js/shopping.js`, `parseShoppingCommand`) y se intercepta al principio mismo de `add()` en `js/app.js`, antes de `interpret()`. Ventajas: (1) nunca hay que tocar el SYSTEM_INSTRUCTION de 48.500 caracteres del backend ni arriesgar una regresión ahí ("no romper nada" fue instrucción explícita del propietario en la sesión de conversación por voz); (2) funciona sin conexión a la IA; (3) un fallo de parseo simplemente no reconoce el comando y la orden sigue su camino normal (nota/recordatorio), nunca puede corromper una interpretación real.

**Investigación de APIs de supermercado — el pedido explícito de "puedes acceder a la API" del propietario.**
- **Mercadona**: confirmado con pruebas reales (`curl` contra `tienda.mercadona.es/api/`) que no hay API oficial de terceros, pero sí endpoints públicos que usa la propia web para cualquier visitante anónimo: `/api/categories/` (árbol de 26 secciones / 151 subcategorías) y `/api/categories/<id>/` (productos de una subcategoría: nombre, precio, foto, enlace). Nada de esto pasa por Akamai ni necesita sesión. La alternativa habría sido reproducir la búsqueda real del sitio, que usa Algolia con credenciales (`app-id`/`api-key`) que rotan sin aviso y se extraen del bundle JS — se investigó (repos `ivorpad/mercadona-cli`, `datania/mercadona-catalog`) y se descartó explícitamente por frágil: se rompería solo con el tiempo sin que Angeli hiciera nada mal. En su lugar, `backend/mercadona_catalog.py` recorre las subcategorías en paralelo (`ThreadPoolExecutor`, patrón ya usado en `app.py`), cachea el catálogo aplanado 12h en memoria (mismo estilo que la caché de contexto de Vertex AI), y hace el emparejado por substring sobre el nombre. Nueva ruta `/shopping/mercadona/search` en `backend/app.py`, autenticada igual que el resto (requiere sesión de Angeli), separada de `/interpret` igual que `/chat/aside`.
- **Consum**: investigado (`tienda.consum.es`) y confirmado que es una SPA de Angular sobre una plataforma blanca de terceros ("Aktios TOL", dominio `cdn-consum.aktiosdigitalservices.com`), sin ningún endpoint JSON público encontrado en la carga inicial. Reproducirlo exigiría ingeniería inversa mucho más profunda (probablemente sesión/tienda seleccionada incluso para listar productos) con menos garantía de estabilidad que Mercadona. Se decidió NO implementarlo esta vez: un artículo "de consum" se guarda en la lista igualmente (para saber dónde comprarlo) pero sin búsqueda de producto. Queda anotado como ampliación futura si se decide que compensa el mantenimiento.
- **Escribir en la cesta real de Mercadona del propietario (pidió explícitamente "que se me haga la lista directamente en la app de Mercadona, que ahí estoy logueado")**: decisión consciente de NO implementarlo. Hacerlo exigiría que Angeli reutilizara la sesión autenticada real del propietario en Mercadona (cookies o credenciales), algo fuera de los límites de lo que este asistente debe manejar — no es una limitación técnica sino de seguridad: Angeli no entra en cuentas de terceros ni maneja credenciales/sesiones ajenas a su propio backend. Lo que sí se hizo: cuando hay un producto emparejado, el artículo lleva un enlace directo a su ficha en `tienda.mercadona.es` para que el propietario lo añada él mismo a su cesta con un toque.

**Cobertura de test**: `tests/shopping.test.mjs` (15 pruebas, todo lo de `js/shopping.js`: parseo de comandos con distintos órdenes de palabras/preposiciones, gestión de la lista) y `backend/test_shopping_mercadona.py` (emparejado del catálogo sobre datos simulados + la ruta HTTP con la búsqueda inyectada) — ningún test toca la red real de Mercadona. Verificado además a mano en el navegador: la app carga sin errores de JS, el botón 🛒 abre la lista, añadir un artículo por teclado y por el compositor principal intercepta correctamente antes de la IA (sin sesión, muestra el aviso de "inicia sesión" sin nunca mostrar el modal de "Procesando" que sí aparece para una nota/recordatorio normal) — confirma el aislamiento del resto del pipeline.

**Deploy**: nueva ruta en Cloud Run (`backend/app.py` + `backend/mercadona_catalog.py`) — desplegado como parte de esta entrega, ya que el propietario pidió explícitamente que quedara "ya funcionando" de principio a fin.

## 2026-09-18 — Corrección: tocar un aviso push ahora lleva a la entrada V0.21.79

El propietario reportó dos cosas juntas sobre los avisos push: (1) al tocar la notificación, la app se abre pero no lleva a lo que la provocó; (2) pidió comprobar que, con la app completamente cerrada, el aviso llega igual tanto en el ordenador como en el móvil.

**Punto 1, investigado y corregido.** `backend/push_notifications.py` (`_send`, `deliver`) ya mandaba `url: "./?reminder=<entryId>"` en cada mensaje FCM, y `sw.js`'s `notificationclick` ya navegaba a esa URL al tocar la notificación. El eslabón que faltaba estaba en el frontend: nada en `js/app.js` leía nunca el parámetro `?reminder=` al arrancar. Corregido añadiendo `pendingReminderFocus` (leído una vez de `location.search` al cargar el módulo) y `focusPendingReminder()`, enganchada al final de `render()` — se ejecuta en cada render hasta que la entrada aparece en `notes` (puede tardar, porque Firestore aún no ha sincronizado en el primer render tras abrir la app desde frío). Cuando la encuentra: resetea filtros/búsqueda si estaban ocultándola, hace scroll con `scrollIntoView` y la resalta 2,4s con la clase `.entry-highlight` (`styles.css`), y limpia la URL con `history.replaceState` para no repetir el resaltado si se recarga la página.

**Punto 2, verificado por código, no por prueba real.** El mecanismo para recibir avisos con la app cerrada ya existe y es correcto sobre el papel: `sw.js` registra `firebase.messaging().onBackgroundMessage(...)`, que Firebase invoca cuando llega un push de datos y ninguna pestaña de la PWA está en primer plano — funciona con la pestaña/ventana cerrada siempre que el navegador siga vivo en segundo plano. El envío ya usa `webpush:{headers:{Urgency:"high"}}` (añadido en una versión anterior, comentado en `push_notifications.py`) precisamente para que Android lo entregue aunque el móvil esté en Doze. **Límite real, no arreglable con código**: si en el ordenador se cierra el navegador entero (no solo la pestaña), ningún sitio web puede recibir push — es una restricción del sistema operativo/navegador, no de Angeli; en Android con la PWA instalada sí puede llegar con la app "cerrada" (deslizada de recientes) porque el navegador base sigue en segundo plano. No se puede simular este comportamiento en el entorno de desarrollo — pendiente de que el propietario lo confirme con una prueba real en cada dispositivo (crear un aviso a 2-3 minutos vista, cerrar la app del todo, esperar).

**Cobertura de test**: sin test automático nuevo. La lógica de `focusPendingReminder` vive dentro de `render()`, acoplada al DOM (`document.querySelector`, `history.replaceState`) y al estado de notas cargadas desde Firestore — mismo motivo por el que las funciones de red real de `google.js` tampoco tienen test automatizado en este proyecto. Verificado que la suite completa sigue en verde (sin regresiones).

## 2026-09-18 — Corrección: borrar una entrada no retiraba su evento o aviso de Calendar V0.21.78

El propietario preguntó directamente: "si elimino algo del Dietario que está en Calendar, ¿también se elimina de Calendar?". Investigado el código real en vez de suponer: la respuesta era que NO.

`deleteEntry()` (`js/app.js`, usada tanto por el menú rápido "⋮" del Dietario como por el botón "Borrar" de cualquier entrada en la conversación normal — ambos comparten el mismo `handleEntryAction`) solo quitaba la entrada de `notes`/Firestore y limpiaba sus adjuntos de Drive. Nunca tocaba Calendar. Si la entrada tenía un evento sincronizado (`calendarEventId` + `calendarStatus:"synced"`, de `calendar.create`) o un aviso programado (`schedule.calendarEventId` + `schedule.status:"scheduled"`, de cualquier recordatorio con fecha/hora), ese evento o aviso se quedaba huérfano en el Calendar real del propietario — visible y sonando en su día, aunque Angeli ya no supiera nada de esa entrada. Esto llevaba ocurriendo desde que existe el botón "Borrar" (mucho antes del Dietario), así que es plausible que haya eventos/avisos huérfanos ya en el Calendar real.

Ya existía la lógica correcta para cancelar Calendar al borrar, pero solo en las rutas dedicadas: `action==="cancel-schedule"` → `google.cancelScheduledReminder(note)` (usado desde "Anular" en la ficha de un aviso) y `action==="calendar-delete"` → `google.deleteCalendarEvent(note,eventId)` (desde "Anular" en un resultado de agenda, con `confirm()` y búsqueda de avisos vinculados). El botón genérico "Borrar" nunca pasaba por ninguna de las dos.

Corregido con `deleteCalendarTracesFor(note)`, nueva función en `js/google.js` junto a `cancelScheduledReminder` (mismo estilo: sin `confirm()`, pensada para invocarse como parte de un borrado ya decidido, no como una acción a confirmar aparte). Borra el evento principal (`calendarEventId` si `calendarStatus==="synced"`) y el aviso vinculado (`schedule.calendarEventId` si `schedule.status==="scheduled"`) por separado — nunca son el mismo id en un evento con aviso vinculado, se comprobó contra `createLinkedCalendarBundle`. Nunca lanza: si Calendar falla, `deleteEntry()` borra igualmente la entrada en Angeli (ya lo había hecho) y avisa con un toast para revisarlo a mano, mismo patrón ya usado para un fallo al limpiar adjuntos de Drive.

**Límite de cobertura de test, comunicado explícitamente**: `deleteCalendarTracesFor` no tiene test automático. Ninguna función de `google.js` que hace peticiones reales a Calendar lo tiene en este proyecto — todo lo ya testeado ahí (`buildCalendarSearch`, `calendarEventsForIntent`, `reconcileReminderEntries`, `scheduledReminderEvent`...) son funciones puras sin red; las que sí llaman a Calendar (`cancelScheduledReminder`, `deleteCalendarEvent`, `createScheduledReminder`...) solo se han validado manualmente o mediante el arnés real aislado de `backend/test_harness.py`, que prueba el backend, no esta función de orquestación del frontend. Se ha escrito replicando exactamente el patrón ya probado en producción de `cancelScheduledReminder`, pero queda pendiente que el propietario lo compruebe en real (crear un recordatorio/evento de prueba, borrarlo desde el Dietario, confirmar que desaparece también de Calendar) antes de darlo por completamente verificado.

## 2026-09-18 — Seguimientos manuales: "en N días" calcula la fecha sola V0.21.77

Del bloque "bandeja de trabajo y seguimiento" del roadmap (nunca empezado): el propietario pidió "seguimientos automáticos — si no contesta en dos días, recuérdamelo". Angeli no envía mensajes ni sabe si alguien ha respondido (WhatsApp lo prepara pero lo envía el propio usuario; las llamadas las hace él), así que antes de programar nada se preguntó explícitamente qué debía significar "no contesta". Tres opciones planteadas: (1) recordatorio automático a los N días siempre que se contacte a alguien, (2) el usuario marca manualmente "sin respuesta" y ahí se crea el seguimiento, (3) detectar la respuesta real (inviable: no hay acceso a WhatsApp ni a llamadas entrantes). El propietario eligió la opción 2.

Con esa decisión, la implementación se reduce a una sola pieza que faltaba: que decir "si Ana no me contesta en dos días, recuérdamelo" (o cualquier variante con "en/dentro de N días") programe el aviso de verdad. Investigado `js/temporal.js`: `explicitRelativeDate` solo reconocía los casos fijos hoy/mañana/pasado mañana (0/1/2 días); "en N días" con cualquier otro número, en dígitos o en palabras, no tenía ningún soporte local — el cálculo de la fecha dependía por completo de que Gemini hiciera bien la aritmética, sin ninguna red de seguridad si se equivocaba (el mismo patrón de riesgo que causó el fallo de "llama a Ana" en V0.21.75).

Añadido `relativeDaysOffset()` en `js/temporal.js`: reconoce "en/dentro de N días" con dígitos (1-99) o números escritos hasta veinte, e integrado en `explicitRelativeDate` (usado por `extractDate`, compartido por eventos y recordatorios) y en `cleanTemporalText` (para que "en dos días" no quede colgando en el título). Verificado que no se confunde con un uso no temporal de "N días" sin la preposición "en"/"dentro de" delante (p. ej. "he estado dos días sin dormir" no debe interpretarse como fecha).

Con esto, "Ana no me ha contestado, recuérdamelo en 2 días" ya funciona de punta a punta a través del pipeline de `reminder.create` existente (avisos push, Calendar...), sin necesitar ningún intent ni módulo nuevo — es la misma infraestructura de recordatorios de siempre, solo que ahora puede calcular esa fecha concreta de forma determinista.

Corrección relacionada, encontrada al revisar el mismo área: "recuérdame**lo**" (con el pronombre pegado — "recuérdamelo", "recuérdamela" — construcción muy natural en español, "recuérdamelo" es literalmente el ejemplo del propio hilo con el propietario) no coincidía con `\brecuérdame\b` en `classify()` (`js/classifier.js`) ni con la exclusión de `localImmediateCall()` (`js/ai.js`, V0.21.75): el límite de palabra `\b` justo después de "recuérdame" no admite un pronombre pegado sin espacio. Ambos se corrigieron a `\brecu[eé]rdame(?:l[oa]s?)?\b`. Sin este arreglo, la propia frase de ejemplo del seguimiento ("recuérdamelo") se habría clasificado mal.

## 2026-09-18 — Limpieza del Dietario: las consultas de agenda ya no se acumulan V0.21.76

Retomando un hallazgo ya anotado hacía varias sesiones ("duplicados de ¿Qué tengo la semana que viene? cluttering el Sin fecha del Dietario"), el propietario pidió limpiarlo antes de seguir con nuevas funciones.

Causa raíz encontrada: en `add()` (`js/app.js`), `calendar.query` es el ÚNICO de los tres intents de consulta (junto a `note.query` y `reminder.query`) que NO se intercepta pronto para resolverse sin guardar nada — `note.query`/`reminder.query` devuelven pronto (líneas 160-161) y nunca tocan `notes`/Firestore. `calendar.query` en cambio recorre el camino normal de creación de entradas y se guarda como una entrada permanente de `type:"calendar"`, sin `scheduledDate` (es una pregunta, no un evento) y sin `calendarStatus` (ese campo solo lo pone `calendar.create`). Como `entryActive()` en `js/dietario.js` solo excluye por `calendarStatus==="error"` o por estado de aviso, estas entradas pasaban el filtro indefinidamente y se acumulaban en "Sin fecha" cada vez que se repetía la misma pregunta — y los accesos por defecto "Hoy"/"Próxima semana" (`js/shortcuts.js`) ejecutan exactamente esa consulta en cada toque.

Se evaluó arreglarlo de raíz (que `calendar.query` no persista nada, igual que `note.query`/`reminder.query`, o al menos reutilizar/sustituir la entrada anterior en vez de crear una nueva) pero se descartó por ahora: el id de la entrada (`id=active?.id||crypto.randomUUID()`) se calcula ANTES de conocer la intención final (se usa ya para subir adjuntos), y las acciones "Ver evento"/"Anular evento" de un resultado de `calendar.query` dependen de que esa entrada exista en el array `notes` (`handleEntryAction` hace `notes.find(id)`) — retocar esa secuencia con prisa es exactamente el tipo de riesgo que el propietario ha pedido evitar en esta app.

Corregido con el mínimo cambio seguro: `entryActive()` en `js/dietario.js` excluye explícitamente `type==="calendar" && aiIntent?.intent==="calendar.query"`. Es un cambio aislado a un módulo puro y ya bien testeado (`tests/dietario.test.mjs`), sin tocar `add()`, `google.js` ni la lógica de subida de adjuntos. Las entradas de consulta que ya existen en producción no se borran solas (siguen siendo accesibles y borrables desde la conversación normal), pero dejan de ocupar hueco en el Dietario, y las nuevas seguirán sin verse ahí tampoco.

**Explícitamente pendiente, comunicado al propietario**: esto no evita que se sigan creando entradas nuevas en Firestore cada vez que se pregunta por la agenda — solo evita que ensucien el Dietario. Resolverlo de raíz (deduplicar o dejar de persistir del todo) queda como tarea aparte que requiere tocar con cuidado la secuencia id/adjuntos de `add()`.

## 2026-09-18 — Corrección: "llama a X" podía guardarse como nota en vez de llamar V0.21.75

Reportado por el propietario en real: dijo "quiero llamar a Ana" y la app la guardó como nota; al repetir "llamar Ana" volvió a fallar. Pidió una revisión completa de todo lo relativo a llamar/agendar/notas/recordatorios, y preguntó explícitamente si el problema era el prompt que se manda a la IA o si convenía resolverlo de forma programada (determinista) en vez de depender solo del modelo.

Investigación: `classify()` (`js/classifier.js`) y el fallback local (`localInterpretation`) YA clasifican correctamente "llamar a X" como `contact.call` — no es un fallo del código local, y el propio `SYSTEM_INSTRUCTION` del backend también instruye correctamente que "contact.call se reserva exclusivamente para llamadas que deben ocurrir ahora". El fallback local solo se usa cuando la IA falla o responde con confianza `< 0.75` (`MIN_CONFIDENCE` en `js/ai.js`) — si Gemini responde con confianza alta pero un intent equivocado, su respuesta se usa tal cual, sin ninguna red de seguridad. Conclusión: fue un acierto/fallo real y puntual del modelo (más probable con frases en primera persona, "quiero llamar a X", que con el imperativo "llama a X" de los ejemplos del prompt), no un fallo de código — pero el código SÍ podía protegerse mejor, como ya se hace para otras órdenes sensibles.

El patrón ya existente para esto es `protectCalendarInterpretation(remote, local)`: una detección local determinista (`localCalendarUpdate`/`localCalendarCancellation`) que sustituye el intent de la IA cuando no coincide, ya usado en producción para "cambia/mueve" y "cancela/borra". Se replica el mismo patrón para llamadas inmediatas: `localImmediateCall(text, now)` (nueva, en `js/ai.js`) detecta "llama/llamar/telefonea/contacta + a/al + Nombre" **sin** fecha ni hora en el texto (si hay fecha/hora, sigue siendo `reminder.create`, decisión de la IA, sin cambios), y `protectContactCallInterpretation(remote, local)` fuerza `contact.call` únicamente si la IA respondió `note` o `task.create` — si la IA ya acertó (y quizá trajo el teléfono o el apellido), su respuesta no se toca.

Dos casos límite reales encontrados y corregidos durante la implementación (antes de subir el commit, no en producción):
- `"el proyecto se llama Fénix"` — "llamarse" (ser nombrado), no "llamar a alguien". Se exige que "a"/"al" vaya justo después del verbo (`llama a`, no solo `llama`), lo que ya descarta este caso porque "se llama Fénix" no lleva esa preposición ahí.
- `"recuérdame llamar a Ana"` — es un recordatorio ("recuérdame" implica más tarde), no una llamada ahora, aunque no lleve hora explícita. `classify()` ya prioriza "recuérdame/recordar" sobre "llamar" en ese mismo orden; `localImmediateCall` respeta la misma prioridad y se retira si detecta esas palabras.

`immediateCall` (en `js/app.js`, dentro de `add()`) solo se calcula si ninguna otra detección local más específica ya ha reclamado el texto (`localLinked||whatsApp||noteQuery||reminderQuery||cancellation||localUpdate||shortcutContext?.action`), igual que ya se hace para `localUpdate`/`cancellation` — así "cámbiame la hora de llamar a Miguel" sigue resolviéndose como `calendar.update` (ya cubierto y probado desde antes), nunca compite con la protección nueva.

## 2026-09-17 — Ajustes → Voz de Angeli: elegir voz, velocidad y tono V0.21.74

El propietario preguntó si la voz de Android se podía cambiar; navegando los ajustes del sistema no encontró dónde elegir voz (solo idioma y velocidad/tono genéricos del motor). Aclarado explícitamente antes de tocar código: una PWA **no puede instalar voces nuevas** en el dispositivo — eso es exclusivo del sistema operativo (Android/Google Play Services) — pero sí puede recordar cuál de las voces YA instaladas prefiere el usuario. Esa distinción se refleja también en la interfaz: si `speechSynthesis.getVoices()` devuelve pocas voces en español, la app lo explica y dirige a Ajustes del sistema, en vez de dar a entender que ella misma podría "descargar" algo.

Nueva sección "Voz de Angeli" en Ajustes: `<select>` con las voces detectadas (`speechSynthesis.getVoices()`, con reintento vía el evento `voiceschanged` porque en algunos navegadores la lista carga de forma asíncrona), y dos `<input type="range">` para velocidad y tono. La preferencia (`voiceURI`, `rate`, `pitch`) se guarda en `localStorage` bajo `angeliVoicePrefs` — deliberadamente NO en Firestore/`cloud.syncNotes`, porque es una preferencia de este dispositivo concreto (la voz instalada en un Android no tiene por qué existir en otro dispositivo), no un dato de Angeli que deba viajar entre dispositivos.

`selectedVoice()` cae a la primera voz en español si el usuario no ha elegido ninguna todavía (nunca a "la primera voz de cualquier idioma que devuelva el navegador", que en algunos casos es inglés). `speakAloud()` — ya usado por el modo conversación, las coletillas y el módulo de charla aparte — ahora aplica `utter.voice`/`utter.rate`/`utter.pitch` desde esa preferencia, así que el cambio se nota en todo lo que Angeli dice, sin tocar ninguna otra lógica.

Verificado en vivo: la vista previa del sandbox tenía 180 voces del sistema (18 en español), el selector las listó correctamente, y cambiar voz + deslizadores + "Probar voz" aplicó y persistió los tres valores tal cual se esperaba.

## 2026-09-17 — Modo conversación: petición de tocar la pantalla, específica de cada caso V0.21.73

El propietario, probando el modo conversación con distintos tipos de órdenes, notó que la rama "manual" de `conversationHandleOutcome` (crear un evento con aviso, completar una nota, elegir entre varias notas/recordatorios...) sonaba "muy aburrido": decía siempre la misma frase fija, "sin relación con las cosas que vayamos a poner" — igual para una nota que para un recordatorio que para cualquier otra cosa.

Causa encontrada leyendo el propio código: esa rama ya leía `$("modalTitle")` y `$("modalLead")` en variables (`title`, `lead`) — que SÍ son distintos para cada caso, porque cada llamada a `openModal`/`showNoteEditor`/`showEntryAction` ya trae su propio título y explicación concretos — pero nunca los usaba para hablar; solo los mostraba en el texto de la conversación, mientras que la voz decía literalmente "Necesito que elijas una opción en la pantalla para continuar." siempre, fuera cual fuera el caso.

Corregido hablando `[title, lead]` (igual que ya hacían las ramas "completion" y "question"), y añadiendo el nombre del botón principal cuando existe (`button.confirm` o `button.danger`, ej. "Revisar cambios", "📅 Crear los dos"), para que además de la explicación sepa exactamente qué tocar. Verificado en vivo reproduciendo el mismo cálculo con dos casos reales distintos (nota vs. evento con aviso): cada uno habla algo propio y con el botón correcto, en vez de la frase fija de antes.

**Lección repetida** (ya apuntada para el modo conversación en general): cuando ya existe información específica y correcta en pantalla (aquí, el título/explicación de cada modal), revisar primero si el código de voz la está leyendo de verdad antes de escribir un texto fijo nuevo — el dato específico ya estaba ahí, solo faltaba usarlo.

## 2026-09-17 — Módulo de charla aparte: coletillas generadas por IA V0.21.72

El propietario, tras probar las coletillas fijas de V0.21.71, preguntó si subir de modelo Gemini permitiría algo más conversacional de verdad — "que no sea ni tan siquiera específico para las funciones actuales... incluso otro módulo aparte". Explorado y puesto en práctica en el mismo hilo, con la condición explícita del propietario: "sin romper lo que ahora tenemos".

Decisión de diseño clave: NO se ha tocado `gemini-2.5-flash-lite` ni `SYSTEM_INSTRUCTION` del intérprete de órdenes para nada — subir de modelo ahí habría sido más caro y más lento (justo lo contrario de lo que se acababa de arreglar en V0.21.70) y arriesgaba que una "personalidad libre" se colara en la extracción de intenciones, que es exactamente lo que costó tanto ajustar. En su lugar, nuevo endpoint `/chat/aside` en `backend/app.py`, con su propia función (`vertex_chat_aside`), su propio prompt de sistema (mucho más corto, sin JSON), su propio límite de salida (20 tokens) y sin caché (no la necesita, el prompt ya es pequeño) — cero superficie compartida con `vertex_interpret`.

Garantía explícita, y la razón de que esto sea seguro de probar: `/chat/aside` nunca decide ni ejecuta ninguna acción de negocio (no crea notas, recordatorios ni eventos), así que un fallo, un timeout o una respuesta rara de este módulo no puede tocar datos reales del usuario — como mucho, Angeli dice una frase fija en vez de una generada. En el frontend, `speakConversationalAside()` (en `js/app.js`) compite la llamada a `chatAside()` (en `js/ai.js`) contra un margen de 900ms con `Promise.race`; si no ha respondido a tiempo o falla por cualquier motivo, cae a `pickConversationFiller()` (la lista fija de V0.21.71, que se queda intacta como red de seguridad).

Cubierto con tests en las tres capas, todos con dependencias simuladas (sin llamar a Vertex AI real): `backend/test_chat_aside.py` (incluye una prueba explícita de que `/chat/aside` nunca ejecuta el intérprete de órdenes, ni con dependencias compartidas), `tests/chat-aside.test.mjs` (cliente JS: forma de la petición, y que un token ausente, una respuesta no-200 o una respuesta vacía se convierten en un rechazo, nunca en una excepción sin capturar) y la ampliación de `tests/conversation-mode.test.mjs`.

**Pendiente de acción manual, igual que V0.21.70**: requiere `gcloud run deploy --source backend` para que `/chat/aside` exista en producción; fusionar en `main` no lo despliega solo.

Explícitamente fuera de alcance de este cambio, y anotado como decisión futura separada: enrutar charla genuinamente libre (preguntas no atadas a notas/recordatorios/agenda) a través de este mismo módulo. Tocar esa decisión de enrutamiento sí afecta al camino de interpretación de órdenes y merece su propio diseño cuidadoso, no colarse dentro de un cambio de "coletillas".

## 2026-09-17 — Modo conversación: coletillas siempre, no solo si tarda V0.21.71

El propietario notó que el modo conversación "iba lento": el modal de "Procesando…" aparecía en texto pero Angeli se quedaba muda hasta tener la respuesta completa de Gemini. Primera iteración: hablar una coletilla genérica solo si `add()` tardaba más de 700ms (para no parlotear en las respuestas rápidas que ya trae la caché de contexto de V0.21.70). El propietario pidió ir más allá en el mismo hilo: que conteste SIEMPRE, tarde poco o mucho, porque hablar solo a veces seguía sonando "a hablar contra una máquina" el resto de las veces — y que haya variedad real de frases (no siempre la misma) con un tono más cercano, "de compañera".

Implementado quitando el `setTimeout`/umbral: `conversationRunTurn` dice una coletilla al azar (`pickConversationFiller()`, 10 frases en `CONVERSATION_FILLERS`, tono casual) nada más capturar la frase, en paralelo con `add()` (sin esperarla). `speakAloud()` ya cancela cualquier habla en curso antes de decir el resultado real (comportamiento de V0.21.67), así que si la respuesta llega rápido, la coletilla simplemente se corta a medias en vez de solaparse — efecto secundario aceptado y esperado, no un fallo.

Verificado con un `SpeechRecognition` Y `SpeechSynthesisUtterance` simulados (interceptando el texto hablado, sin depender de audio real): cada turno dice primero una coletilla variada y después el resultado real, sin excepción.

Pendiente anotado por el propietario en el mismo hilo, explícitamente como posible módulo aparte (no para meter dentro de esto): subir de `gemini-2.5-flash-lite` a un modelo Gemini más capaz permitiría coletillas generadas dinámicamente por el modelo (no solo una lista fija) e incluso una interacción conversacional más libre, no atada a las funciones actuales de la app (notas/recordatorios/agenda). Sin decidir ni implementar todavía.

## 2026-09-17 — Corrección crítica: el modo conversación duplicaba entradas reales V0.21.70

Reportado por el propietario probando el modo conversación en real, con su cuenta real: dictó "llama a Vicente mañana", confirmó en pantalla, y al mirar el Dietario encontró DOS recordatorios idénticos de llamar a Vicente a las 18:00. Confirmado que ocurrió en producción antes del despliegue del backend de esta misma sesión (por los timestamps de los logs de Cloud Run), así que la causa es exclusivamente de frontend, sin relación con la caché de Vertex AI.

Causa raíz: `conversationRec.onresult` (en `js/app.js`, añadido en V0.21.67) marcaba `conversationTurnDispatched=true` DESPUÉS de decidir lanzar un turno, pero nunca comprobaba esa misma variable ANTES de decidir si lanzarlo. Con `continuous:false`, una frase con una pausa breve a mitad ("llama a Vicente" ‹pausa› "mañana") puede llegar como DOS resultados "finales" en eventos `onresult` separados, ambos dentro de la MISMA sesión de escucha, antes de que `onend` la cierre. El primer resultado lanzaba `conversationRunTurn` con la orden completa; el segundo, sin ningún guard, lanzaba OTRO `conversationRunTurn` en paralelo mientras el primero seguía en marcha (interpretando, guardando en Firestore) — dos llamadas a `add()` concurrentes, dos entradas guardadas.

Corregido con `if(conversationTurnDispatched)return;` al ENTRAR en `onresult`, antes de procesar nada, y parando explícitamente el reconocedor (`conversationRec.stop()`) en cuanto se lanza el primer turno, para no dejarlo escuchando de fondo mientras `add()` está en marcha.

Verificado reproduciendo el escenario exacto con un `SpeechRecognition` simulado (dos resultados finales en una sesión, sin depender del micrófono real ni de una cuenta con sesión iniciada): antes del arreglo el segundo resultado se procesaba igualmente; después, solo queda una burbuja en la conversación por sesión, aunque el reconocedor entregue un resultado final adicional. Test de regresión en `tests/conversation-mode.test.mjs`.

**Lección**: cualquier flujo que dependa de eventos asíncronos del navegador (aquí, resultados de reconocimiento de voz) necesita comprobar su propio guard de "ya en marcha" en el punto de ENTRADA del handler, no solo marcarlo como efecto secundario de la decisión — marcarlo después de decidir deja una ventana en la que un segundo evento, llegado antes de que termine el primero, no ve todavía el guard activo.

## 2026-09-17 — Caché de contexto en Vertex AI para el intérprete (backend)

Pendiente ya anotado en varias sesiones anteriores (revisión de coste del modo conversación): `SYSTEM_INSTRUCTION` en `backend/app.py` pesa ~48.500 caracteres y se manda completo en cada llamada a Gemini, idéntico siempre. El propietario reportó notar lentitud real ("desde que yo le hago la petición... hay que revisarlo") justo al usar el modo conversación, que multiplica las llamadas por minuto — motivo directo para abordarlo ahora.

Implementado con `client.caches` de Vertex AI (`google-genai`): `_cached_system_instruction()` crea la caché una vez por proceso (TTL 1h, con margen de refresco de 60s) y devuelve su nombre; `vertex_interpret` la usa vía `cached_content` en `GenerateContentConfig` en vez de reenviar `system_instruction`. Verificado con un cliente Gemini simulado (`backend/test_vertex_cache.py`, sin credenciales reales) que la segunda llamada reutiliza la misma caché sin recrearla.

Decisión de diseño explícita: la caché nunca puede ser la causa de que falle una interpretación. Si `caches.create` falla (cualquier excepción), se desactiva la caché para ese intento y se manda el prompt inline, como antes de tener caché. Si el `generate_content` con caché falla (p. ej. caducó o se borró entre la comprobación y la llamada — condición de carrera real en Cloud Run con varias instancias), se invalida la caché en memoria y se reintenta una vez en línea, sin propagar el error. Las tres ramas están cubiertas por test.

Cloud Run con múltiples instancias: cada instancia crea su propia caché en memoria de proceso (sin coordinación entre instancias) — sencillo y suficiente para el volumen de uso real de esta app; una caché por instancia sigue ahorrando tokens en todas las llamadas posteriores de esa misma instancia dentro de la TTL.

**Pendiente de acción manual**: este cambio no se despliega solo. `angeli-ai-interpreter` en Cloud Run se despliega manualmente (`gcloud run deploy --source backend`), no hay workflow de CI/CD que lo automatice — a diferencia del frontend, que publica solo vía GitHub Pages al fusionar en `main`.

## 2026-09-17 — Botón "⋮" del Dietario, tamaño táctil real V0.21.69

El PR original de este arreglo (V0.21.66, "⋮" de 26px→40px) quedó bloqueado 3 días sin fusionarse; investigando por qué, se encontró que la app `chatgpt-codex-connector` (revisor automático de PRs, instalada desde que el proyecto se llevaba con ChatGPT) había dejado un comentario señalando, con razón, que 40px seguía por debajo de los 44/48px que el propio commit citaba como mínimo — y la rama `main` exige resolver todas las conversaciones antes de fusionar. El propietario desconectó esa app (ya no se usa ChatGPT/Codex en este proyecto) y pidió retomar el PR #66.

Como main ya había avanzado con dos fusiones propias (V0.21.67 modo conversación, V0.21.68 capas del Dietario) mientras el PR #66 seguía anclado a la base antigua, en vez de reconciliar historiales se aplicó el mismo arreglo funcional (más la corrección a 44px que pedía el comentario) directamente sobre el `main` actual, evitando arrastrar conflictos de versión innecesarios. El PR #66 original se cierra sin fusionar; este es su reemplazo limpio.

## 2026-09-17 — Corrección: menú rápido del Dietario oculto detrás del propio Dietario V0.21.68

Reportado por el propietario probando el modo conversación en real: "he comprobado lo de eliminar del dietario y efectivamente sí que sale lo de eliminar, pero se queda debajo del dietario". Mismo tipo de fallo que ya se había corregido para el modo conversación en V0.21.67 (una capa a pantalla completa con más prioridad visual que `#actionModal`), pero aquí llevaba existiendo desde que se creó el menú rápido del Dietario, sin relación con el trabajo de esta sesión.

Causa: `openDietarioQuickActions` (en `js/app.js`) abre `#actionModal` mediante `ui.openModal()` sin cerrar antes `#dietarioLibrary`, a diferencia de cómo se abre el resto de fichas en la app (por ejemplo `openLibraryEntry` sí cierra `#mediaLibrary` primero). `#dietarioLibrary` comparte la clase `.media-library` (z-index:8), por delante de `.action-modal` (z-index:6), así que el menú de "Eliminar"/"Marcar como hecho" quedaba pintado detrás del propio Dietario.

Corregido con un selector por id, más específico que la clase compartida, que baja solo `#dietarioLibrary` a z-index:4 (por detrás de `.action-modal`, igual que ya se hizo con `.conversation-mode` en V0.21.67) sin tocar `.media-library` ni afectar a Galería o Notas, que sí cierran su panel antes de abrir una ficha y no tienen este problema.

Verificado visualmente forzando ambas capas abiertas a la vez (sin necesitar datos ni sesión real): el menú aparece por delante, con el Dietario visible y atenuado detrás — exactamente lo que pidió el propietario para poder eliminar sin perder el sitio en la lista.

## 2026-09-17 — Modo conversación (escucha continua + respuesta hablada) V0.21.67

El propietario pidió una experiencia conversacional real: hablar con naturalidad sin tener que pulsar entre frases, y que Angeli responda en voz para notas, recordatorios y agenda. Antes de programar nada se le mostró un mockup visual (botón + pantalla completa con guion de ejemplo fijo) para validar el diseño; solo tras su aprobación explícita ("adelante, hazlo todo... que ya sea funcional") se conectó la lógica real.

Decisión de diseño clave, explícita por la advertencia del propietario ("cuidado que no se nos estropee nada... costó horrores" que Angeli entendiera bien una orden): el modo conversación **no reimplementa ni toca** el intérprete ni el flujo de `add()` del compositor. Cada turno de voz simplemente rellena `#text` y llama al mismo `add()` que usa el dictado normal, así que toda la lógica ya ajustada (clasificación, fallback local, protección de interpretaciones de calendario, resolución de conversaciones con Gemini) queda intacta y sigue cubierta por los mismos tests.

Para decidir qué hacer con lo que `add()` deja en pantalla, se aprovechó que **todos** sus caminos de salida usan `openModal` internamente (directamente o vía `showCompletion`/`showEntryAction`/`showNoteEditor`/etc.), así que basta con clasificar el modal resultante en tres categorías genéricas sin tocar ninguna de esas funciones:
- `completion-modal` (aviso que se autocierra) → Angeli lo lee en voz y sigue escuchando una instrucción nueva.
- Presencia de `#conversationDraft` (pregunta de aclaración, ej. "¿a qué hora?") → Angeli la lee y sigue escuchando la respuesta, encadenando el mismo `interactionId` (igual que ya hacía `continueConversation` con el compositor).
- Cualquier otro modal (crear evento, elegir entre varias notas/recordatorios, editor de nota, WhatsApp, llamada...) → estas decisiones ya exigían un toque en pantalla incluso dictando por el compositor normal (son las confirmaciones sensibles con varias opciones). El modo conversación lo anuncia, pausa el micrófono y reanuda solo (vía `MutationObserver` sobre `#actionModal`) en cuanto ese modal se cierra. No se ha intentado mapear "sí"/"no" hablado a esos botones: es la superficie más sensible y no se quiso arriesgar sin que el propietario lo pruebe primero.

Bug real encontrado probando el flujo completo (con un `SpeechRecognition` simulado, sin depender del micrófono real): tras cada turno la escucha no se reanudaba sola. Causa: `conversationBusy` se ponía a `false` DESPUÉS de leer/hablar el resultado, pero la propia lectura del resultado ya intentaba reanudar la escucha internamente — y `startConversationRecognizer` se niega a arrancar mientras `conversationBusy` sea `true` (para no solaparse con el propio `add()`), así que esa reanudación era un no-op silencioso. Corregido liberando `conversationBusy` justo después de que `add()` termine, antes de hablar el resultado.

Se usa reconocimiento de una sola tanda (`continuous:false`) encadenado automáticamente en vez de `continuous:true`: el modo continuo real es poco fiable en iOS/Safari (la plataforma objetivo real de esta PWA), mientras que el modo de una tanda es exactamente el que ya funciona de forma probada en el dictado normal.

También se detectó que `#actionModal`/`#scrim` (z-index 6/5) quedaban DETRÁS de los paneles a pantalla completa existentes (Galería z-8, Dietario z-8, visor de imagen z-9) — nunca se había notado porque el resto de la app sigue la convención de cerrar el panel a pantalla completa antes de abrir un modal (ej. `openLibraryEntry` llama a `closeMediaLibrary()` primero). El modo conversación es el primer caso que necesita mantener su pantalla abierta MIENTRAS aparece un modal encima, así que se le dio deliberadamente un z-index bajo (4, por debajo del modal) en vez de tocar el z-index global de `#actionModal`/`#scrim` (que habría alterado, sin necesidad, el apilamiento ya validado del menú de Ajustes).

Pendiente detectado y explícitamente fuera de alcance por ahora: optimizar el `system_instruction` de `backend/app.py` (~48.500 caracteres por llamada a Gemini) con *context caching* de Vertex AI — relevante porque el modo conversación multiplica el número de llamadas por minuto. No se ha tocado el backend en este cambio.

## 2026-09-14 — Corrección crítica: adjuntar una foto o archivo suelto se quedaba bloqueado V0.21.65

Encontrado probando la app real de punta a punta (con autorización del propietario, subiendo un archivo de prueba real desde el compositor): tocar "+ → Archivo" o "+ → Fotos" y seleccionar un fichero sin pasar por el editor de una nota lanzaba una excepción no capturada (`TypeError: Cannot read properties of null (reading 'scope')` en `media-context.js`) que impedía que se abriera el modal de clasificación (motivo/categoría/relación). La persona se quedaba con el archivo "preparado" pero sin ninguna pantalla para continuar, y cada intento de reenviar volvía a lanzar el mismo error.

Causa raíz: `pendingMediaContext` en `app.js` se inicializa (y se resetea) a `null` literal. `normalizeMediaContext(value = {}, settings)` usa un valor por defecto de parámetro, que en JavaScript **solo actúa sobre `undefined`, nunca sobre `null`** — al recibir `null` explícito, la función intentaba leer `value.scope` sobre `null` y reventaba antes de que `showMediaContextEditor` pudiera abrir el modal. El resto de llamadas a `normalizeMediaContext` en la app (desde el editor de notas, desde "Clasificar ahora" en Galería/Archivos) pasan objetos ya definidos o `undefined`, por eso nunca se había detectado: solo afecta al primer adjunto suelto de una sesión, adjuntado directamente desde el compositor. Corregido sustituyendo el valor por defecto por una comprobación explícita (`value = value || {}`) dentro del cuerpo de la función, tanto en `normalizeMediaContext` como en `mediaContextRelation`.

Repasando Galería a petición del propietario ("mira los modales, de toda la botonera de arriba") apareció un segundo hallazgo real con datos de producción: una nota antigua mostraba el chip «🔗 none» en vez de no mostrar relación. Causa: `settingLabel(settings, key, id, fallback)` cae a `clean(id)` cuando no encuentra la opción ni recibe fallback — y para `relationType==="none"` (el identificador interno de "sin relación", no una etiqueta real de una versión antigua sin la normalización actual) eso devuelve literalmente el string "none" como si fuera texto válido para mostrar. Corregido en `settingLabel` (nunca devuelve "none" como último recurso) y reforzado en `mediaLibraryItems` (filtra explícitamente ese valor al construir la relación mostrada en Galería/Archivos).

Lección para revisar código propio o ajeno: un valor por defecto de parámetro (`= {}`) nunca es una garantía completa contra "vacío" en JavaScript — solo cubre `undefined`. Cualquier variable de estado que se inicialice explícitamente a `null` (patrón habitual en este proyecto para "todavía no hay nada") necesita una comprobación explícita dentro de la función, no un valor por defecto en la firma.

## 2026-09-14 — Relación explícita entre adjuntos y notas V0.21.64

Repaso de punta a punta pedido por el propietario del área Notas/Galería/Archivos, la última función que había quedado a medias en una sesión anterior. Dos hallazgos reales, encontrados por lectura de código y confirmados con datos reales en producción (con autorización expresa del propietario, usando su Chrome ya conectado):

1. `showEntryAction` mostraba un mensaje fijo sin ningún dato («Guardado — La entrada se ha guardado en tu conversación») al guardar una foto o archivo suelto, o una tarea sin fecha — cualquier intención que no cayera en una de las ramas explícitas (nota, calendario, aviso, contacto, WhatsApp). Causa raíz: `js/intents.js` nunca definió una descripción para `photo.store`/`file.store` (caían en el valor por defecto, "Nota preparada", incorrecto), y el mensaje final ignoraba `entryBody(note)` por completo. Corregido reutilizando `entryBody`, que ya muestra tipo, descripción real y contexto de clasificación.
2. La ficha de un adjunto (`showMediaEntryDetail`) nunca decía explícitamente con qué estaba relacionado — solo se intuía por la etiqueta de un botón ("Abrir nota" vs "Añadir nota"). Nueva función `mediaRelationCard`: si el adjunto pertenece a una nota, muestra su título/contenido/estado; si no, muestra la relación de persona/cliente/proyecto o dice explícitamente que no hay ninguna. El listado de Galería/Archivos añade el mismo indicador («📝 Nota vinculada») a simple vista.

Hallazgos menores registrados pero no corregidos aún (baja prioridad, decisión pendiente del propietario): la ficha de una nota (`showNoteDetail`) lista los nombres de sus adjuntos como texto, sin miniatura, aunque la tarjeta de conversación sí la muestra; una nota con adjunto muestra la categoría dos veces en la tarjeta de conversación (una por la nota, otra por el contexto del adjunto).

Nota sobre el arnés de integración: `backend/test_harness.py` valida el backend contra las APIs reales de Google — no puede detectar bugs de interfaz. Estos tres cambios (V0.21.62, V0.21.63, V0.21.64) fueron todos de frontend puro, encontrados y verificados probando la interfaz real, no con el arnés.

## 2026-09-14 — Fichas del Dietario y botón de acciones rápidas V0.21.63

Prueba real en dispositivo de V0.21.62 (filtros ya corregidos) reveló tres problemas nuevos: 1) tocar «Avisos» abría la ficha y se cerraba sola casi al instante; 2) tocar «Adjuntos» mostraba «La entrada se ha guardado en tu conversación», que ni siquiera es cierto; 3) la pulsación larga para el menú rápido no respondía nunca en el móvil.

Causa de 1 y 2: `openDietarioEntry` reutilizaba `ui.showEntryAction`, la pantalla que se muestra justo después de crear o interpretar una instrucción nueva. Para un aviso ya programado, esa función llama a `showCompletion`, que se autocierra a los 1.8s por diseño (pensada para un vistazo rápido tras una acción, no para repasar algo ya existente); para tipos no contemplados (foto/archivo sueltos) cae en su mensaje genérico de cierre. Solución: nueva función `ui.showDietarioDetail`, una ficha persistente sin autocierre que reutiliza los mismos bloques de contenido (`entryBody`, `calendarCard`, `scheduleTitle`/`scheduleWhen`) pero con un botón «Cerrar» explícito. Las entradas de tipo foto/archivo se enrutan en su lugar a la ficha real ya existente de Galería/Archivos (`openLibraryEntry`), no a un mensaje genérico.

Causa de 3, y lección para cualquier gesto táctil futuro: el navegador de pruebas de Claude emula tamaño y user-agent móvil, pero traduce los clics como eventos de ratón, no como una secuencia táctil real — por eso el fallo no se detectó antes de la prueba en dispositivo real. En un móvil de verdad, un `pointerdown` dentro de una lista con scroll puede recibir `pointercancel` en cuanto el sistema operativo interpreta el gesto como posible scroll, abortando el temporizador de pulsación larga antes de completarse. Ante cualquier interacción que dependa de gestos táctiles con temporización, preferir un control visible y explícito (aquí, un botón «⋮» en cada línea) en vez de un gesto de tiempo, salvo que se pueda validar en un dispositivo o simulador táctil real antes de publicar.

Aclaración importante sobre el arnés de integración (`backend/test_harness.py`): valida el backend contra las APIs reales de Google con una cuenta de pruebas — no abre ningún navegador ni puede detectar bugs de interfaz (cableado de eventos, CSS, autocierre de modales). Los bugs de esta versión son todos de frontend y solo se detectan probando la interfaz real, en navegador o dispositivo.

## 2026-09-14 — Corrección de filtros del Dietario V0.21.62

Regresión detectada por el propietario nada más publicar V0.21.61: los chips de periodo (Hoy/Esta semana/Todo) y de tipo (Eventos/Avisos/Notas/Adjuntos) del Dietario no filtraban nada al tocarlos, y la fila de tipo se veía recortada sin poder desplazarse para ver «Adjuntos». Causa raíz: el wiring original asignaba `onclick` a cada botón individual, pero el manejador genérico `document.querySelectorAll(".filter").forEach(...)` de la conversación se ejecuta después en `app.js` y sobrescribe ese `onclick` en cualquier elemento con clase `.filter` del documento — además de vaciar el estado `active` de todos los chips `.filter` de la app en cada clic, no solo los del grupo tocado. Lección para futuras pantallas con chips de filtro: **usar siempre delegación de eventos en el contenedor** (como ya hacían Notas y Galería) y **una clase propia** si el chip no debe participar del filtro genérico de la conversación, nunca `onclick` por botón con la clase `.filter` compartida. `.library-filters` gana `overflow-x:auto` para que una fila con más chips de los que caben se pueda desplazar en vez de recortarse en silencio.

A petición del propietario, se añade también una pulsación larga (~550 ms) sobre cualquier línea del Dietario que abre un menú rápido para marcar como hecho/reabrir o eliminar esa entrada sin pasar antes por su ficha completa — reutiliza la lógica de `toggle`/`delete` ya existente en `handleEntryAction`, ahora extraída a `toggleEntryStatus`/`deleteEntry` para no duplicarla. Pendiente de prueba manual real en dispositivo (requiere sesión con datos): confirmar que la pulsación larga no interfiere con el scroll de la lista y que el menú aparece de forma fiable en iOS/Android.

## 2026-09-13 — Dietario: agenda unificada por día V0.21.61

El icono «Agenda» (🗓️) generaba confusión: solo consultaba Calendar, pero el nombre sugería algo más amplio. Se renombra a «Calendario» sin tocar su comportamiento (sigue siendo el atajo directo a `calendar.query`), y se añade un icono nuevo, «Dietario» (📔), que agrupa por día lo que ya vive en Firestore: eventos de Calendar, avisos (recordatorios, tareas con fecha, llamadas programadas), notas y adjuntos, con una sección final «Sin fecha». No crea ningún dato nuevo ni un modal paralelo: cada línea abre la ficha real ya existente para ese tipo de entrada (`ui.showEntryAction` o el detalle de nota). La agrupación vive en `js/dietario.js`, un módulo puro y testeado (`tests/dietario.test.mjs`), siguiendo el mismo patrón que `media-library.js` para la Galería. Pendiente para una versión futura: fusionar eventos reales de Calendar que Angeli no haya creado (hoy el Dietario solo agrupa lo que ya está sincronizado en Firestore, no hace una consulta en vivo a la API de Calendar).

## 2026-09-13 — Corrección urgente del arranque V0.21.60

La V0.21.59 quedó bloqueada en la pantalla «Preparando tu asistente» por un cierre incorrecto en la función `openLibraryEntry`. Chrome informó `Unexpected token ')'` en `js/app.js`, aunque `node --check` y las pruebas unitarias habían pasado. Se reestructura la función para que los cierres del editor de nota y la ficha del adjunto sean inequívocos. La validación de esta regresión debe incluir un arranque real en Chrome y comprobar que desaparece `welcomeScreen`, además de las pruebas Node habituales.

## 2026-09-13 — Enlace bidireccional entre Notas y adjuntos V0.21.59

Notas, Galería y Archivos representan ahora vistas de las mismas entradas de Firestore. El editor de una nota acepta imágenes y documentos, los sube a Drive al guardar y los incorpora a `images` o `files`; el índice derivado los presenta automáticamente en Galería o Archivos. La clasificación de la nota alimenta también `mediaContext`, por lo que ambas vistas conservan categoría, relación y motivo. Desde la ficha de un adjunto, Añadir nota convierte esa misma entrada en nota, preserva sus referencias remotas y evita duplicar el archivo. Si ya está enlazado, el botón abre la nota existente.

## 2026-09-13 — Biblioteca de notas y edición de adjuntos V0.21.58

El acceso Notas deja de presentar resultados dentro del modal conversacional y abre una biblioteca independiente. Incluye búsqueda por título, contenido, categoría, relación, motivo y etiquetas; filtros Pendientes, Hechas y Todas; filtro de categoría; y acciones para ver ficha, reclasificar, cambiar el estado y borrar. En Galería y Archivos, Ver ficha abre ahora una ficha específica del adjunto. Si una entrada anterior no tiene `mediaContext`, ofrece Clasificar ahora; si ya lo tiene, permite modificarlo y sincroniza el cambio en Firestore.

## 2026-09-13 — Contexto de adjuntos y Agenda V0.21.57

Cada nueva selección de fotos o archivos abre una ficha previa obligatoria con motivo, categoría y relación opcional. Las categorías y tipos de relación son los mismos que los de Notas, por lo que siguen siendo configurables desde un único lugar. El contexto se guarda en `mediaContext` dentro de la entrada de Firestore y la biblioteca lo usa para filtrar, buscar y explicar el adjunto. Los adjuntos anteriores continúan usando la clasificación heredada de su entrada. La cabecera añade Agenda entre Recordatorios y Ajustes; ejecuta una consulta directa de Calendar para los próximos 90 días y muestra todos los eventos pendientes sin pedir una frase adicional.

## 2026-09-13 — Prioridad de avisos móviles V0.21.56

Una prueba real mostró que Cloud Tasks ejecutó `/push/deliver` a la hora prevista y el ordenador recibió el aviso, mientras el Samsung A54 mantuvo el mensaje hasta abrir la PWA. Los tokens de Chrome Android son Web Push y el backend enviaba mensajes de datos sin urgencia explícita; FCM puede retenerlos durante Doze. Desde V0.21.56 cada mensaje incluye los encabezados Web Push `Urgency: high` y `TTL: 86400`, adecuados para recordatorios visibles y puntuales. Base confirmada: `angelifirebase`; cola confirmada: `angeli-reminders` en `europe-west1`; entrega confirmada en Cloud Run con respuesta 200.

## 2026-09-13 — Cabecera funcional V0.21.55

La cabecera conserva el logotipo de Angeli a la izquierda y Ajustes a la derecha. Entre ambos presenta cuatro accesos directos: Galería, Archivos, Notas y Recordatorios. Los antiguos iconos de enviar y buscar se retiran de la cabecera porque el usuario no los utilizaba. Galería y Archivos reutilizan la biblioteca con su filtro inicial; Notas abre el gestor con todas las notas y Recordatorios abre los pendientes.

## 2026-09-13 — Biblioteca de fotos y archivos V0.21.54

Las notas permanecen dentro de Angeli; no se copiarán ahora en Google Keep ni en otra aplicación. Los adjuntos disponen de un apartado propio accesible desde la cabecera. La biblioteca deriva su índice de las entradas existentes en Firestore, permite buscar y filtrar por fotos, archivos y categoría, amplía imágenes, abre documentos, comparte el original y conduce a la ficha relacionada. No crea otra base ni otra copia: los bytes continúan únicamente en las carpetas fijas de Drive y se descargan bajo demanda.

## 2026-09-13 — Avisos de segundo plano fiables V0.21.53

La revisión posterior a la primera prueba real de avisos detectó dos fallos del entregador. Las tareas fechadas se programaban en Cloud Tasks, pero su entrada no contiene `schedule.status`, por lo que `/push/deliver` las descartaba como inactivas. Además, la entrega concreta se retiraba de Firestore antes de llamar a FCM; una excepción temporal dejaba el reintento de Cloud Tasks sin una entrega válida. Desde V0.21.53 una tarea pendiente con `scheduledDate` y `scheduledTime` es elegible y cada entrega se consume únicamente después de que FCM responda. Las pruebas del servicio de notificaciones forman parte de `integration-gate`.

## 2026-09-12 — Enlaces de adjuntos en Sheets V0.21.52

La hoja operativa real `Secretaria_Angeli.xlsx`, propiedad de `franbermudez.es@gmail.com`, conserva 23 columnas y ya dispone de `Archivo` y `Enlace`. El Apps Script activo es `Angeli Secretaria V0.8`; su endpoint respondió correctamente a la comprobación de estado. Una escritura mínima confirmó que el contrato actual guarda `archivo` en la columna `Archivo` y `enlace` en `Enlace`; las dos filas técnicas creadas durante la comprobación se vaciaron y una exportación posterior confirmó que no quedó ningún dato de prueba. El fallo estaba en la PWA: `js/sheets.js` enviaba únicamente los nombres de `entry.files`, omitía las fotos y nunca incluía `enlace`. Desde V0.21.52 se registran en el mismo orden todas las referencias de `images` y `files`, usando el `webViewLink` devuelto por Drive o reconstruyéndolo con el ID remoto. Sheets continúa siendo un registro externo y Firestore sigue siendo la fuente operativa.

## 2026-09-12 — Banner de escritorio en primer plano V0.21.51

La prueba V0.21.50 confirmó mediante el aviso interno que FCM entregaba el mensaje a Chrome, pero macOS no presentaba el banner aun con ambos perfiles de Chrome autorizados. En escritorio y primer plano se usa `new Notification` para pasar por el canal nativo de la ventana; el service worker continúa atendiendo móvil y segundo plano.

## 2026-09-12 — Diagnóstico de prueba de escritorio V0.21.50

Firestore confirmó dos instalaciones registradas (`Linux armv81 · móvil` y `MacIntel · ordenador`). Al probar desde el ordenador, la PWA podía considerar activos los avisos solo porque el permiso del navegador estaba concedido, aunque el token de esa carga aún no estuviera disponible. `/push/test` recibía entonces un token vacío y enviaba a todos los dispositivos, por lo que la prueba aparecía en el móvil. La corrección espera el token local, obliga al backend a recibirlo y muestra también una confirmación dentro de Angeli cuando está en primer plano.

La revisión del mismo flujo detectó cuatro bordes que se corrigen en la misma versión: las tareas fechadas también deben programarse; una llamada futura se clasifica por `schedule.action.kind`; los ajustes pueden conservar un seguimiento futuro aunque la hora base haya pasado; y cada entrega comprueba que su clase siga pendiente para impedir duplicados por reintentos. Si falla una reprogramación, el modal permanece abierto y lo indica.

## 2026-09-02 — V0.21.40 · Ubicación editable sin hacerla obligatoria

Toda ficha que vaya a crear un elemento en Calendar ofrece `Añadir ubicación` o `Cambiar ubicación`: eventos, recordatorios y eventos con aviso vinculado. El lugar sigue siendo opcional para no convertir una orden completa en más pasos; cuando el usuario lo añade, se guarda en el campo nativo `location` de Calendar.

## 2026-09-02 — V0.21.39 · Las preguntas de seguimiento pertenecen a la interfaz

La PWA no muestra literalmente el texto libre que Gemini proponga para pedir un dato pendiente. La IA identifica qué campo falta y Angeli formula la pregunta con microcopy canónica en español según la intención. Así, título, fecha, hora, ubicación, contacto y objetivo mantienen el idioma y el tono de la aplicación aunque el proveedor responda en otro idioma.

## 2026-09-02 — V0.21.38 · Peticiones normales restauradas

Las funciones que reciben un acceso directo opcional deben admitir también `null`, porque el compositor normal no tiene ninguna etiqueta asociada. Leer propiedades del acceso sin normalizarlo bloqueaba cualquier instrucción con `Cannot read properties of null (reading 'action')`. La ausencia de acceso directo significa orden natural y debe continuar hacia la IA o el respaldo local.

## 2026-08-31 — V0.21.37 · Fecha y hora editables

Toda ficha de creación que termine en Calendar debe permitir corregir fecha y hora antes de ejecutar: evento, recordatorio y evento con aviso vinculado. La corrección modifica el dato real que se enviará a Calendar. Si existe un aviso vinculado, se desplaza junto al evento conservando su antelación original.

## 2026-08-31 — V0.21.36 · Accesos directos operativos

Un acceso directo expresa una intención, no solo un texto sugerido. Los seis accesos base y sus copias heredadas conservan esa intención aunque Gemini o el clasificador local interpreten otra cosa. Las consultas de agenda y la búsqueda de contactos se ejecutan al enviar la voz, sin pedir después otro clic para «Consultar» o «Llamar ahora». Los accesos personalizados reconocibles reciben la misma semántica; los desconocidos continúan como órdenes naturales sin forzar una acción.

## 2026-08-31 — V0.21.35 · Ciclo completo de notas

Las consultas de notas son operativas, no listas planas. Cada resultado permite editar su ficha completa, marcarlo como hecho o reabrirlo y borrarlo con confirmación. Las expresiones «notas pendientes», «notas hechas» y «todas las notas» eligen el estado sin depender de Gemini. Tras cada acción se vuelve al mismo contexto de consulta y Firestore sigue siendo la única fuente compartida entre dispositivos.

## 2026-08-30 — V0.21.31 · Modelo base de notas

Firestore continúa siendo la fuente operativa y Google Sheets el registro externo obligatorio. Una nota se clasifica sin bloquear su creación mediante título, ámbito (`general`, `personal` o `company`), relación opcional (`person`, `client`, `project` o `event`), motivo y hasta cinco etiquetas. La ausencia de clasificación explícita produce una nota general, nunca un interrogatorio. `note.query` consulta las entradas sincronizadas por cualquiera de esos campos y no guarda la pregunta como otra nota.

Google Keep no se integra: su API oficial no ofrece una sincronización completa y soportada para la cuenta personal actual. Una posible copia en Drive se evaluará en un PR independiente después de cerrar creación, consulta, edición y eliminación dentro de Angeli.

## 2026-08-30 — V0.21.30 · Calendar reconcilia modificaciones externas

La consulta de recordatorios ya no usa `events.get` únicamente para detectar
borrados. Si el aviso continúa existiendo, su título, descripción, fecha, hora
y URL efectiva vuelven de Calendar, se aplican a la entrada y se sincronizan
por Firestore. El texto dictado original se conserva como historial. La puerta
real `P03-external-update` modifica un aviso aislado y recorre el reconciliador
de la PWA antes de eliminarlo.

## 2026-08-24 — Entorno de pruebas aislado: validación real inicial completada

El arnés de integración real dispone ahora de un perfil OAuth estrictamente
separado del uso diario: las rutas de Cloud Run `/test/session/status` y
`/test/oauth/exchange` solo existen si `ANGELI_TEST_HARNESS_ENABLED=1` y solo
aceptan a la cuenta propietaria de Firebase. Esas rutas escriben únicamente los
secretos `angeli-test-google-{contacts,calendar,drive}-grant`; nunca leen ni
sobrescriben `angeli-google-*-grant` de producción. La página estática
`tests/test-auth.html` permite que la persona propietaria conecte
`buengusto.es@gmail.com` para Contactos, Calendar y Drive de pruebas. Antes de
ejecutar casos reales P04, P06 y P10 hay que crear esos tres secretos, asignar
al Service Account los roles de acceso/creación de versiones sobre ellos,
desplegar Cloud Run con la bandera de pruebas y completar esa autorización.

La cuenta de pruebas `buengusto.es@gmail.com` quedó conectada correctamente en
los tres grants aislados y el arnés se ejecutó realmente desde Cloud Shell con
resultado `PASS` en P04 (crear, localizar y cancelar Calendar), P10 (consulta
por intervalo), P11 (localizar y modificar la hora del mismo evento) y P06
(subir y eliminar un adjunto en Drive de pruebas). Cada ejecución elimina los
recursos `ANGELI-TEST-*` que crea. Esta validación no modifica la PWA,
Firestore ni las cuentas personales y no equivale a validar los casos
conversacionales, notificaciones o negocio todavía pendientes de perfil de
Firebase y pruebas manuales específicas.

## 2026-08-24 — Puerta técnica obligatoria antes de `main`

Las publicaciones dejan de hacerse mediante `push` directo a `main`. El flujo
permanente es rama `codex/*` → Pull Request → check obligatorio
`integration-gate` → fusión automática si pasa. GitHub Actions ejecuta pruebas
unitarias y el arnés real contra la cuenta aislada. La autenticación con Google
usa Workload Identity Federation y una cuenta de servicio dedicada, sin claves
JSON permanentes. Esa cuenta solo puede leer
`angeli-test-google-oauth-client-secret` y los tres grants
`angeli-test-google-{contacts,calendar,drive}-grant`; el arnés no lee el secreto
OAuth de producción. El cliente web exclusivo se llama
`Angeli Integration Gate Tests` y se inyecta mediante
`ANGELI_TEST_GOOGLE_WEB_CLIENT_ID`; no existe fallback al Client ID de
producción. Los informes JSON quedan como artefactos durante 30 días; no
se amplía por ahora el contrato del Apps Script ni se escriben resultados en la
hoja operativa de Sheets.

## Estado de referencia

- Repositorio remoto/fuente de verdad: `origin` → `git@github.com:franbermudezes-cloud/angeli_secretaria.git`.
- Rama principal: `main`.
- Commit de referencia al iniciar esta memoria: `764d9590e1ece6a0ea20e1d1a3cabe6a71c95f32` (`764d959`, `Update index.html`, 2026-08-20).
- En ese momento, `main` y `origin/main` apuntaban al mismo commit y el árbol de trabajo estaba limpio.
- Última versión estable validada: `V0.12.1 · Teléfonos`, validada manualmente en Android el 2026-08-20.
- `V0.12.2 · Contactos Google`, `V0.12.3 · SaaS UI`, `V0.13 · Google Calendar`, `V0.13.1 · Cuentas Google`, `V0.14 · Arquitectura modular`, `V0.14.1 · Temporal inteligente`, `V0.15 · IA estructurada`, `V0.15.1 · Ubicaciones` y `V0.15.2 · IA real` están preparadas para prueba manual; no deben considerarse validadas hasta completar sus pruebas reales en Android.
- No existe un README, gestor de paquetes, dependencias declaradas, proceso de build ni pruebas automatizadas.

GitHub es la fuente de verdad del código. Antes de modificar cualquier funcionalidad, comprobar el estado actual del repositorio y del código, y analizar qué otros flujos podrían verse afectados.

Regla permanente de versionado: cada commit funcional incrementa la versión visible y sincroniza todas las referencias de versión y caché PWA. Los commits solo documentales no cambian la versión.

## Arquitectura y archivos

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Marcado de la secretaria y carga del módulo principal. |
| `styles.css` | Estilos de la interfaz. Debe contener los cambios visuales; evitar bloques CSS grandes dentro de `index.html`. |
| `js/app.js` | Inicialización, estado mínimo, coordinación y eventos. |
| `js/ui.js` | Renderizado de bandeja, tarjetas, estados visuales, previsualizaciones y avisos. |
| `js/firebase.js` | Sesión persistente de Angeli y lectura/escritura de entradas en Cloud Firestore. |
| `js/media.js` | Subida, lectura y borrado autenticado de adjuntos en Google Drive. |
| `js/storage.js` | Preferencias ligeras y limpieza de caché heredada; no es fuente de verdad. |
| `js/classifier.js` | Tipos, prioridades, teléfonos y datos derivados de la clasificación. |
| `js/temporal.js` | Detección temporal actual, sin reglas de negocio adicionales. |
| `js/ai.js` | Interpretación estructurada, proveedor intercambiable, validación y fallback. |
| `js/conversation.js` | Estado persistente de una interacción, datos recogidos, preguntas pendientes y cierre de la operación. |
| `js/intents.js` | Propuestas de acción derivadas de intenciones validadas, sin ejecutar integraciones. |
| `js/google.js` | OAuth, People API y Calendar API. |
| `js/sheets.js` | Envío actual al Apps Script público de Google Sheets. |
| `manifest.json` | Metadatos de la PWA, colores, inicio e iconos. |
| `sw.js` | Instalación, activación y estrategia de caché de la PWA. |
| `prueba-microfono.html` | Prueba independiente del reconocimiento de voz. |
| `icon-192.png`, `icon-512.png` | Iconos de la PWA. |

La aplicación se ejecuta con un servidor HTTP local, por ejemplo `python3 -m http.server 8000`, y se abre en `http://localhost:8000/`.

La arquitectura visual se separó en V0.12.3 y la lógica se modularizó en V0.14. `index.html` carga `js/app.js` como módulo ES; sus dependencias se importan con la misma versión de caché y se precargan en `sw.js`. Al modificar PWA, revisar de forma conjunta los recursos versionados de `index.html`, los imports de módulos, `manifest.json` y el precaché de `sw.js`.

## Funcionalidad existente

- Bandeja de entrada de notas: crear, buscar, filtrar por pendiente/hecha, completar, reabrir y borrar.
- Clasificación local automática de entradas por tipo: nota, tarea, recordatorio, calendario, contacto, foto o archivo.
- Acciones contextuales: llamada por `tel:` cuando se detecta teléfono, estados visuales de tarea/recordatorio y creación confirmada de eventos en Google Calendar.
- Firebase Auth mantiene una sesión persistente de la cuenta propietaria y Cloud Firestore es la única fuente de verdad compartida de las entradas entre móvil y escritorio.
- Captura de cámara, selección de imágenes y selección de archivos. Las imágenes y archivos nuevos se guardan como ficheros en Google Drive y las entradas solo conservan sus referencias ligeras.
- Dictado en español mediante `SpeechRecognition` o `webkitSpeechRecognition`.
- Envío de datos de la entrada a un endpoint de Google Apps Script/Google Sheets.
- Consulta opcional de contactos por nombre mediante Google Identity Services OAuth y People API; solicita exclusivamente `contacts.readonly` cuando la persona usuaria pulsa `🔗 Conectar Google`.
- Creación opcional de eventos en el calendario principal mediante Google Identity Services OAuth y Calendar API; solicita exclusivamente `calendar.events` cuando la persona usuaria confirma `📅 Añadir al calendario`.
- Instalación PWA y disponibilidad parcial offline mediante Service Worker.

## Decisiones y límites conocidos

- Es una aplicación estática de un solo documento: no hay backend propio ni bundler.
- La integración con Google usa `fetch` con `mode: "no-cors"`. Esto no permite al navegador verificar la respuesta del servidor; el aviso de éxito indica que la petición se inició, no que Google confirmó el almacenamiento.
- El dictado depende del soporte del navegador y de los permisos de micrófono. La página `prueba-microfono.html` sirve para aislar ese diagnóstico.
- No se migran los datos locales históricos: el usuario confirmó que son únicamente pruebas. La aplicación no los lee ni los reintroduce en Firestore.
- Firestore conserva texto, estado, metadatos de acciones y referencias de medios; Drive conserva los bytes de imágenes y archivos. La caché técnica del navegador se puede borrar sin afectar a los datos remotos.
- Drive se conecta de manera independiente mediante `drive.file`, por lo que puede usar una cuenta distinta de la cuenta Angeli, Contactos o Calendar. La PWA nunca recibe ni conserva el refresh token.
- Google Contacts no utiliza el endpoint público de Apps Script. El Client ID web es público por diseño; los tokens de acceso y las coincidencias de contactos permanecen únicamente en memoria y no se guardan en GitHub, `localStorage` ni IndexedDB.
- Google Calendar tampoco utiliza el endpoint público de Apps Script. Su token de acceso permanece únicamente en memoria. Las notas de calendario conservan `calendarStatus`, `calendarEventId`, `calendarUrl` y, cuando se detecta, `location`; nunca el token.
- Contactos y Calendar se conectan por separado porque pueden pertenecer a cuentas distintas. La interfaz muestra el estado de cada integración solo durante la sesión, permite elegir o cambiar cuenta por separado y permite desconectar la sesión local sin revocar permisos en Google.
- La opción `⚙️ Mantenimiento · Borrar todos los datos` elimina solo la clave local de notas y la base IndexedDB de medios tras confirmación; nunca modifica Google Sheets.
- La versión visible y las referencias de caché PWA deben mantenerse alineadas. Antes de cambios futuros de versión o caché, revisar en conjunto `index.html`, `manifest.json`, `sw.js` y los recursos versionados.
- La IA interpreta una instrucción, pero nunca ejecuta por sí sola una acción externa. Cuando falte un dato, la entrada conserva una interacción activa en Firestore y la siguiente respuesta completa esa misma operación; no se crea una nota nueva ni se cambia de intención por una respuesta corta.
- Si la IA no responde, supera el tiempo de espera o devuelve un JSON no válido, la interfaz debe indicarlo y aplicar solo un respaldo local explícito. No debe presentar ese respaldo como si fuera una interpretación de IA ni ejecutar una acción sensible incorrecta.
- La caché del Service Worker puede retener recursos en el navegador. Tras cambios de PWA, validar actualización, activación y recursos precargados.
- Angeli Secretaria debe mantenerse como PWA lo más autónoma posible. n8n es auxiliar futuro para automatizaciones en segundo plano, correo, seguimientos, procesos programados o workflows complejos, nunca el motor de sus funciones básicas. Contacts y Calendar continúan por Google APIs directas; al llegar Drive se estudiará primero conexión directa y segura desde la PWA. No se deben incrustar secretos de webhooks ni credenciales de n8n en la PWA pública.
- El intérprete IA se ejecuta de forma aislada en Cloud Run (`angeli-ai-interpreter`, región `europe-southwest1`) y usa la cuenta de servicio dedicada con `roles/aiplatform.user` y ADC. No usa API key ni archivo JSON. La URL del servicio es pública solo a nivel de red: el endpoint exige un ID token de Google válido, con audiencia del Client ID web y `sub` incluido en la lista privada `ALLOWED_GOOGLE_SUBS` del servicio.

## Protocolo antes de cambios funcionales

1. Consultar el estado Git, la rama y la relación con `origin`.
2. Para cualquier servicio externo o almacén de datos, confirmar antes de editar el recurso real que se está usando: proyecto, ID/nombre, cuenta, permisos, regla activa, destino y una lectura/escritura mínima. No inferirlo a partir de variables, nombres o pantallas parciales.
3. Leer los archivos implicados y localizar dependencias o flujos relacionados.
4. Definir el alcance y los posibles efectos en interfaz, datos locales, Google Sheets, dictado, adjuntos y PWA.
5. Aplicar cambios mínimos y validar los flujos afectados en un servidor HTTP local.
6. Actualizar esta memoria y `CHANGELOG.md` cuando haya decisiones, limitaciones o cambios funcionales relevantes.

## Registro de decisiones y soluciones

Añadir aquí, con fecha, el contexto, la decisión tomada, los archivos implicados y cómo se verificó. No sustituir decisiones anteriores sin explicar el motivo del cambio.

### 2026-08-24 — Entorno de pruebas aislado (en preparación)

La especificación oficial de producto está en la hoja `ANGELI — Investigación de Mercado y Producto`, pestaña `01 — Pruebas de Producto`, con los casos P01–P16. Se inicia un arnés independiente en `backend/test_harness.py`: usa únicamente la cuenta `buengusto.es@gmail.com`, la carpeta `Angeli - Pruebas` (`1A1iuK8xwn3icpNezmB2JeOvD8_fsKuEx`) y secretos con prefijo `angeli-test-google-`. Producción conserva el prefijo `angeli-google-` y no se puede mezclar con el arnés.

La primera fase automatiza operaciones reales aislables: P04 (crear/buscar/cancelar Calendar), P10 (consulta de agenda por intervalo) y la base de adjuntos P06/P07 (subida y borrado en Drive). Los casos conversacionales, Firestore, notificaciones PWA y negocio no se simulan: quedan manuales hasta habilitar un perfil Firebase/OAuth exclusivo de pruebas y un destino de resultados distinto del Apps Script de entradas. Antes de declarar validada una integración se exige una operación mínima real de lectura/escritura/borrado en los recursos de prueba.

### 2026-08-21 — V0.20.5 · Base Firestore real pendiente de validación

La consola confirmó que la base Cloud Firestore creada para Angeli se llama `angelifirebase`. El cliente PWA apuntaba a `(default)`, que es otra base distinta; por ello móvil/Mac no podían sincronizar por el registro que se comprobaba en la consola. V0.20.5 selecciona explícitamente `angelifirebase` y espera la confirmación remota de las escrituras pendientes antes de declarar los datos sincronizados. No modifica IA, Calendar, Contactos, Drive ni diseño. Pendiente de comprobación cruzada Android/Mac con la cuenta Angeli.

Regla permanente: antes de modificar una integración o almacén externo, confirmar proyecto, ID/nombre, cuenta, permisos, reglas activas, destino y una operación mínima de lectura/escritura. No inferir una configuración correcta a partir de variables, nombres o pantallas parciales.

### 2026-08-21 — V0.20.6 · Bienvenida con Angeli pendiente de validación

La PWA muestra al abrirse una pantalla completa con `assets/angeli-welcome.gif`, proporcionado por el usuario. La animación permanece como mínimo 2,6 segundos mientras se inicializa Angeli y se retira al terminar la carga; un límite de seguridad evita que una incidencia de red deje la pantalla bloqueada. Es un cambio de presentación aislado: no interviene en Firebase, IA, Calendar, Contactos, Drive ni el flujo de acciones.

### 2026-08-21 — V0.20.7 · Animación de trabajo pendiente de validación

El GIF se muestra también dentro del modal único de trabajo, no en los modales de confirmación o resultado. `showWorking()` reutiliza la misma animación para toda espera y cada llamada existente aporta el texto contextual de la operación; así no se duplican pop-ups ni se cambian los flujos de IA, adjuntos, Calendar o Contactos. La pantalla de bienvenida precarga el GIF y usa el mismo fondo que el `manifest` para reducir el destello anterior a que cargue el HTML. El splash nativo de Android sigue siendo necesariamente estático y usa el icono de la PWA: Android no admite un GIF en ese punto.

### 2026-08-21 — V0.20.8 · Drive OAuth persistente pendiente de validación

La prueba directa confirmó que la cuenta de servicio puede ver y editar la carpeta de Imágenes, pero Google Drive no permite que una cuenta de servicio cree archivos en Mi unidad porque no tiene cuota de almacenamiento. Abrir las carpetas a cualquier persona no lo resuelve y no es necesario. V0.20.8 conserva las carpetas fijas, pero las operaciones de medios pasan a usar una autorización OAuth persistente del Gmail propietario, con el alcance mínimo `drive.file`. El refresh token se conserva solo en Secret Manager (`angeli-google-drive-grant`) y puede pertenecer a una cuenta distinta de Angeli, Contactos o Calendar. La primera conexión de Drive debe hacerse desde Ajustes; después fotos y archivos se crean como archivos de ese Gmail. Pendiente de crear el secreto, desplegar Cloud Run y validar una foto y un archivo desde Android y Mac.

### 2026-08-24 — V0.21 · Conversación persistente pendiente de validación

La aplicación pasa de tratar cada frase como una entrada independiente a conservar una interacción activa dentro de la propia entrada Firestore. `js/conversation.js` reúne intención, datos ya recogidos, campos pendientes, pregunta breve e historial acotado. El backend de IA recibe ese contexto y debe completar la misma operación salvo que la persona indique expresamente un cambio o cancelación. La interfaz distingue entre una propuesta lista para confirmar, una pregunta pendiente y un respaldo local; no debe ejecutar Calendar, llamadas o cualquier acción externa sin el paso de confirmación existente. La interacción se replica entre móvil y escritorio porque se guarda junto a la entrada, no en memoria local. Esta versión requiere desplegar el backend Cloud Run junto con la PWA antes de validarla en Android.

### 2026-08-24 — V0.21.1 · Conversación fluida pendiente de validación

La interfaz conserva la conversación activa en una sola tarjeta: si Angeli necesita fecha, hora u otro dato, la pregunta, el campo de respuesta, el dictado, `Continuar` y `Cancelar` permanecen disponibles sin obligar a buscar el compositor general ni cerrar ventanas. Durante la interpretación se muestra el estado de trabajo y, al terminar, la misma posición pasa a la siguiente pregunta o a la confirmación de la acción. Los mensajes normales no revelan si se usó IA o respaldo local; si Angeli no está segura, pide el detalle o la confirmación con texto comprensible. No cambia Firebase, Cloud Run, Google Contacts, Calendar, Drive ni las acciones externas existentes. Pendiente de prueba manual en Android.

### 2026-08-24 — Regla permanente de publicación funcional

Cuando el cambio solicitado está claro, se han ejecutado las comprobaciones disponibles y no hay una decisión, riesgo o autorización externa pendiente, Codex debe versionar, hacer commit y publicar directamente en `origin/main`. La publicación es necesaria para probar la PWA real en Android; no se debe dejar una corrección funcional solo en el árbol local esperando una autorización redundante. Si falta una decisión del usuario, existe riesgo de regresión no resuelto o el usuario pide expresamente detenerse, se informa antes de publicar.

### 2026-08-24 — V0.21.2 · Flujo directo pendiente de validación

Una vez que la persona confirma y Angeli ejecuta con éxito una acción, la tarjeta final solo sirve como confirmación visual breve y se cierra automáticamente. Las tarjetas se mantienen abiertas únicamente cuando aún hay una elección, un dato pendiente, una confirmación o un error que resolver. Pendiente de validación manual en Android.

### 2026-08-24 — V0.21.3 · Calendar fiable pendiente de validación

Se corrige una regresión crítica de búsqueda. Las consultas de agenda por intervalo no pueden usar el texto natural de la pregunta como parámetro `q` de Google Calendar: una frase como «¿Qué tengo mañana?» filtraba por esas palabras y producía falsos resultados vacíos. Las consultas generales usan solo `timeMin` y `timeMax`; las operaciones de modificar/cancelar usan únicamente el título objetivo, sin el verbo de orden ni referencias temporales. El backend usa y devuelve explícitamente el mismo calendario `primary` para crear, leer, modificar y borrar. Los fallos técnicos de Calendar se devuelven como error distinguible, nunca como «No he encontrado coincidencias». Pruebas locales cubren lectura/escritura sobre el mismo `calendarId` y la separación entre error técnico y resultado vacío. PWA y Cloud Run se publicaron; pendiente de validación manual.

### 2026-08-24 — V0.21.4 · Flujo aislado pendiente de validación

Una interacción pendiente no es un contexto global. Solo puede continuar cuando la persona responde desde el popup de esa misma interacción; el compositor principal y el dictado normal siempre crean una instrucción nueva. Esto evita que una pregunta o confirmación antigua secuestre órdenes posteriores y produzca tarjetas incoherentes. Pendiente de validar una orden nueva mientras exista una interacción antigua pendiente.

### 2026-08-21 — V0.20 · Datos y Drive pendiente de validación

Se sustituye el modelo híbrido de pruebas por una arquitectura única: Firestore es la fuente de verdad de todas las entradas y Google Drive conserva los bytes de fotos y archivos. La PWA no lee, migra ni mezcla `localStorage` o IndexedDB heredados porque el usuario confirmó que todos los datos previos son pruebas. Las entradas remotas guardan únicamente los metadatos y las referencias de Drive; los medios nuevos se organizan en `Angeli Secretaria/Fotos/<año>/<mes>` y `Angeli Secretaria/Archivos/<año>/<mes>`. La autorización `drive.file` se conserva como refresh token solo en Secret Manager, separada de Angeli, Contactos y Calendar. Antes de tratar esta versión como estable hay que desplegar Cloud Run y comprobar foto, archivo, lectura, persistencia, sincronización móvil-escritorio y borrado.

### 2026-08-21 — V0.20.1 · Destinos Drive y confirmación Firestore pendiente de validación

La carpeta raíz de Angeli fue compartida con la cuenta de servicio de Cloud Run. Los IDs de sus destinos no pertenecen al repositorio: se configuran únicamente como variables de Cloud Run para Imágenes, Archivos, Bandeja de entrada, Notas de voz y Datos. El backend deja de crear carpetas y usa de forma directa las rutas configuradas de imágenes y archivos; por ello no vuelve a pedir conexión OAuth de Drive al móvil o Mac. La interfaz bloquea el envío durante una carga y muestra un estado de trabajo. Las nuevas entradas esperan confirmación de Firestore antes de borrar el borrador; ante error revierte la vista temporal y muestra el estado. Pendiente de despliegue y prueba manual cruzada entre Android y Mac.

### 2026-08-21 — V0.20.2 · Flujo seguro pendiente de validación

Todas las instrucciones muestran una tarjeta de progreso desde el primer toque de Enviar y bloquean los dos controles de envío hasta terminar. Un fallo de subida de Drive no puede quedar preparado y contaminar la siguiente instrucción de texto: la selección fallida se elimina y se informa claramente. Si el medio ya se subió y falla una fase posterior, la aplicación intenta retirarlo de Drive. Los errores de acceso a medios se registran con diagnóstico seguro en Cloud Run y se muestran como un problema de acceso a la carpeta de Drive, no como un genérico «No autorizado». Pendiente de desplegar Cloud Run y validar texto, Calendar, Contactos, foto y archivo en Android.

### 2026-08-21 — V0.20.3 · Flujo libre pendiente de validación

La interfaz no espera a que Firestore termine una escritura antes de pasar de «Guardando» a la tarjeta operativa. Firestore sigue siendo la fuente remota de verdad y su estado se muestra en Ajustes; si no sincroniza, se informa de que la instrucción sigue pendiente. Esta separación evita que una demora de red bloquee el menú, adjuntos, Calendar o Contactos.

### 2026-08-21 — V0.20.4 · Adjuntos pendiente de validación

La cuenta de servicio de Cloud Run fue comprobada directamente contra la carpeta de Imágenes: puede listar y modificar contenido. La investigación posterior aclaró que no puede ser propietaria de ficheros nuevos porque Google no le asigna cuota de Drive en Mi unidad; V0.20.8 reemplaza esa ruta por Drive OAuth persistente del Gmail propietario. Antes de una subida, el navegador fuerza una renovación del token Firebase. El backend separa y registra de forma segura un rechazo de la sesión Angeli de un rechazo concreto de Drive, sin modificar IA, Calendar, Contactos ni el modelo de datos. Pendiente de desplegar y probar una carga de imagen y archivo desde Android y Mac; esta misma prueba debe confirmar la recepción cruzada por Firestore.

### 2026-08-20 — Validación estable V0.10

V0.10 se validó manualmente en Android: dictado y texto, cámara, selección de fotos, archivos, persistencia tras actualizar/reabrir la PWA, visualización de medios y envío a Google Sheets. Tratar este estado como referencia estable: los cambios futuros deben preservar esos flujos.

### 2026-08-20 — Validación estable V0.11

V0.11 se validó manualmente en Android con clasificación correcta: tarea, recordatorio, calendario, contacto, foto y archivo; una nota textual acompañada de PDF conservó la prioridad de la intención textual. También se confirmó la persistencia de textos y adjuntos.

### 2026-08-20 — Validación estable V0.12.1

V0.12.1 se validó manualmente en Android: teléfonos escritos y dictados se reconocen, clasifican la entrada como Contacto y abren correctamente el marcador mediante `tel:`.

### 2026-08-20 — V0.12.2 · Contactos Google pendiente de validación

La PWA solicita de forma explícita y temporal el alcance `https://www.googleapis.com/auth/contacts.readonly` mediante Google Identity Services. Para una entrada como `Llama a Montse`, extrae el nombre, consulta People API con los campos mínimos `names,phoneNumbers` y muestra opciones de llamada sin persistir la agenda ni los resultados. Pendiente de validar en Android: autorización, cero/una/varias coincidencias, contacto sin teléfono y reautorización tras caducar el token.

### 2026-08-20 — V0.12.3 · SaaS UI pendiente de validación

Se extrajo la hoja de estilos de `index.html` a `styles.css` y se adoptó una presentación SaaS de tarjetas, controles táctiles, filtros y acciones. No se modificó ninguna lógica de la aplicación. `styles.css` se incluye en el precaché del Service Worker y está pendiente de validación visual manual en Android y escritorio.

### 2026-08-20 — V0.13 · Google Calendar pendiente de validación

Las entradas de tipo Calendario con fecha y hora detectadas pueden crear, previa confirmación, un evento de una hora en el calendario principal. La integración solicita de forma incremental el alcance `https://www.googleapis.com/auth/calendar.events` y conserva el identificador y enlace del evento para una futura gestión bidireccional. La inserción usa un ID determinista por entrada y trata una respuesta de conflicto como recuperación del evento existente para evitar duplicados. Si falta fecha u hora, falla Google o se rechaza la autorización, la entrada local se conserva y permite reintentar. Pendiente de validar en Android: autorización, creación real, persistencia del estado sincronizado, no duplicación y errores de Google.

### 2026-08-20 — V0.13.1 · Cuentas Google pendiente de validación

Se separa la conexión temporal de Google Contacts y Google Calendar: cada una permite elegir o cambiar cuenta y desconectarse solo de la sesión local. No se guardan tokens ni resultados de contactos. Las búsquedas sin token de Contactos ahora dejan un mensaje persistente en la tarjeta, en lugar de conservar un botón sin explicación. Pendiente de validar en Android con una cuenta de agenda distinta de la cuenta de Calendar.

### 2026-08-20 — V0.14 · Arquitectura modular pendiente de validación

Sin modificar el comportamiento, la aplicación se separó en módulos ES para interfaz, almacenamiento, clasificación, utilidades temporales, OAuth/Google, Sheets y coordinación. `index.html` queda limitado al marcado y la carga de `js/app.js`. El Service Worker precarga el grafo de módulos con el mismo identificador de versión para evitar combinaciones de HTML y JavaScript de versiones distintas. Pendiente de regresión manual completa en Android.

### 2026-08-20 — V0.14.1 · Temporal inteligente pendiente de validación

`temporal.js` reconoce ahora mañana, días de semana, fechas numéricas y fechas como `28 de agosto`; también horas numéricas y naturales con franja del día, medias y cuartos. `classifier.js` mantiene como prioridad recordatorio, tarea y contacto, y clasifica como Calendario las entradas restantes con fecha y hora detectadas. Al iniciar, una nota existente solo se recalifica si pasa inequívocamente a Calendario; los demás tipos guardados no se cambian. El título enviado a Calendar elimina las expresiones temporales nuevas. Pendiente de validación manual en Android.

### 2026-08-20 — V0.15 · IA estructurada pendiente de validación

Se incorporan `ai.js` e `intents.js` con un proveedor local simulado, sin secretos ni llamadas de red. La respuesta se limita a una lista cerrada de intenciones, se valida y usa el clasificador local como fallback ante error o confianza inferior a `0.75`. La IA solo crea propuestas; Calendar crear conserva su confirmación existente, mientras que actualizar/cancelar Calendar se muestra como solicitud confirmable y no ejecuta todavía ninguna acción externa. La futura integración real sustituirá el proveedor dentro de `ai.js` y requerirá backend autenticado con secreto fuera de la PWA.

### 2026-08-20 — V0.15.1 · Ubicaciones pendiente de validación

Las entradas `calendar.create` conservan la ubicación detectada en el campo local `location`, incluida la recuperación segura desde `aiIntent.location` para entradas V0.15 existentes. La tarjeta y la confirmación de Calendar muestran la ubicación cuando existe. `google.js` envía ese texto libre al campo `location` del evento de Google Calendar, sin geocodificación, Google Maps API ni permisos OAuth adicionales. El extractor local admite poblaciones, nombres de restaurantes y direcciones con números y comas; si no hay ubicación, el evento se crea sin ese campo.

### 2026-08-20 — Decisión de arquitectura: PWA autónoma y n8n auxiliar

La PWA es el núcleo de Angeli Secretaria: conserva interfaz, validación, confirmaciones, almacenamiento local e integraciones inmediatas. Contacts y Calendar siguen con Google APIs directas. n8n queda reservado para una necesidad futura y concreta de automatización diferida, correo, seguimiento, programación o workflow complejo; no es el motor de Drive ni de la IA. Cuando se aborde Drive, se estudiará primero una conexión directa y segura desde la PWA. Un webhook no se protege mediante una URL oculta: nunca se incluirán secretos o credenciales permanentes en el código publicado.

### 2026-08-20 — V0.15.2 · Intérprete IA remoto pendiente de validación

`backend/` contiene el servicio aislado `POST /interpret`, desplegado en Cloud Run con Gemini `gemini-2.5-flash-lite` mediante Agent Platform/ADC. El servicio acepta como máximo 500 caracteres, aplica un límite básico de 30 peticiones por minuto por identidad, agota a los 8 segundos y no registra el cuerpo de la petición. La PWA adquiere un ID token solo después de pulsar `✨ Conectar IA`; lo conserva exclusivamente en memoria, lo envía como `Authorization: Bearer` y mantiene el clasificador local como fallback. La respuesta sigue validándose contra la lista cerrada de intenciones en `ai.js`; no puede ejecutar acciones externas por sí sola. La cuenta autorizada en Cloud Run se conserva exclusivamente como `sub` privado en la configuración del servicio, nunca en el repositorio.

### 2026-08-20 — V0.15.3 · IA prioritaria pendiente de validación

Cuando el intérprete remoto devuelve una intención válida, esa intención determina el tipo, las fechas, hora, ubicación, teléfono y propuesta de la entrada: las reglas locales no vuelven a reinterpretarla. La PWA conserva únicamente la validación de esquema y la confirmación explícita antes de ejecutar acciones sensibles; no puede aceptar código ni acciones fuera de la lista cerrada. El clasificador local queda reservado para falta de conexión IA, error, tiempo agotado o salida estructuralmente insegura. El backend normaliza respuestas parciales seguras del modelo para que los campos opcionales ausentes no provoquen un fallback innecesario. Pendiente de validar manualmente en Android.

### 2026-08-21 — V0.15.5 · Calendario bidireccional pendiente de validación

Para `calendar.create`, la IA debe devolver un título breve del evento y una ubicación física separada. La PWA guarda el título en `calendarTitle` y usa ese valor —o el título de una intención IA ya guardada— como `summary` del evento de Google Calendar; el texto original de la entrada no se altera. La ubicación se mantiene en `location` y se envía al campo oficial de Calendar. Así, una entrada como «Está contratada discomóvil en Complejo San Marcos de Gandía el 29 de agosto a las siete de la tarde» debe crear el evento `Discomóvil` con ubicación `Complejo San Marcos de Gandía`.

La integración incorpora `calendar.query`, `calendar.update` y `calendar.delete`. La IA propone la operación y, en los dos últimos casos, identifica el objetivo y los cambios; la PWA consulta únicamente un intervalo limitado del calendario principal y mantiene las coincidencias solo en memoria. Antes de modificar o cancelar, muestra cada candidato y pide una confirmación final con el evento concreto. No se eliminan ni modifican eventos automáticamente. Pendiente de validación manual en Android: creación estructurada, consulta, modificación, cancelación y casos de cero o varias coincidencias.

### 2026-08-21 — V0.15.6 · Calendario contextual pendiente de validación

La intención `calendar.update` separa ahora el objetivo existente (`target`) de los datos nuevos (`changes`): la búsqueda no usa la fecha nueva como filtro. Las consultas `calendar.query` pueden incluir `rangeStart` y `rangeEnd`; «la semana que viene» comprende desde el lunes siguiente, inclusive, hasta el lunes posterior, exclusivo. El contrato del intérprete exige mantener separado título, ubicación, objetivo y cambios. Pendiente de validación manual en Android.

### 2026-08-21 — V0.16 · Angeli Asistente pendiente de validación

La interfaz se rediseña para móvil sin mover la lógica de negocio a `index.html`: este conserva solo marcado, `styles.css` contiene la presentación, `ui.js` renderiza conversación y tarjetas emergentes, `app.js` coordina entrada, dictado, accesos y acciones, y `storage.js` conserva los accesos directos locales bajo `angeli_secretaria_shortcuts_v1`. El dictado puede pararse y continuarse; solo `Enviar` procesa la instrucción. La propuesta aparece primero en una tarjeta emergente y después pasa a la conversación. Los accesos directos representan texto de instrucciones para el mismo flujo de interpretación; no contienen código ni secretos. `Limpiar vista` no modifica notas, IndexedDB ni integraciones externas. Pendiente de validación completa en Android antes de considerar la versión estable.

### 2026-08-21 — V0.16.4 · Recuperación de caché PWA pendiente de validación

Durante la primera prueba de V0.16 se publicó una plantilla HTML sin cerrar dentro de `ui.js`; el navegador no podía analizar el módulo y por eso ninguno de los controles se inicializaba. Se reescribe el renderizado de tarjetas sin plantillas anidadas, preservando las mismas acciones y datos. Los recursos, manifest y Service Worker se renuevan a `0.16.4`; JavaScript y CSS pasan a usar red primero y la caché queda como respaldo offline. La versión se muestra permanentemente en la cabecera durante esta fase de pruebas. Pendiente de comprobar menú, envío y dictado en Android antes de considerar V0.16 operativa.

### 2026-08-21 — V0.16.5 · Flujo operativo pendiente de validación

La tarjeta emergente deja de ser un aviso breve y pasa a ser el espacio de trabajo: muestra el borrador completo al dictar o escribir, y permanece hasta enviar o cancelar. El micrófono grande no se oculta después de una entrada. Para `contact.call`, la tarjeta mantiene la búsqueda abierta; si Contactos no está conectado, inicia la autorización bajo una acción explícita de la persona y, al volver, muestra los teléfonos encontrados para abrir el marcador. El historial inferior conserva los registros, pero no es el lugar donde se debe completar una acción inmediata. Calendar recibe la confirmación desde la tarjeta, por lo que no debe mostrar una segunda confirmación nativa. Pendiente de validación manual completa en Android.

### 2026-08-21 — V0.16.6 · Compositor y acceso de llamada pendientes de validación

El compositor inferior concentra los controles en dos columnas verticales para priorizar el texto: adjuntar/dictar a la izquierda y enviar/borrar a la derecha. El acceso directo de llamada no debe enviar solo el nombre a la IA: abre el borrador con el prefijo `Llama a ` e inicia dictado, de modo que «Montse» forme la instrucción completa `Llama a Montse`. Pendiente de comprobar en Android, incluida la conexión automática de Contactos y la selección final de teléfono en la tarjeta.

### 2026-08-21 — Estructura de producto y siguiente bloque

Se crea `docs/` como documentación de producto separada de esta memoria técnica: visión, roadmap y especificaciones por bloque. El primer bloque preparado es `docs/specs/01-scheduled-actions.md`: una orden futura como «Llama a Miguel Ibiza mañana a las nueve» debe crear un recordatorio programado, no abrir el marcador en ese momento. La PWA seguirá siendo la interfaz y validará/confirmará acciones; la planificación fiable se estudiará con n8n u otra infraestructura autenticada. El canal acordado combina notificación Android y aviso de Calendar como respaldo.

También se incorpora al roadmap el bloque «Conocimiento de empresa»: consultas de solo lectura sobre las fuentes reales de clientes, presupuestos, proyectos y marketing. Antes de conectarlo habrá que inventariar dónde viven esos datos y diseñar una capa autenticada que consulte solo lo necesario; no se descargará ni expondrá una base completa en la PWA.

### 2026-08-21 — V0.17 · Acciones programadas pendiente de validación

Se añade `js/schedule.js` para representar una acción futura con fecha/hora, zona `Europe/Madrid`, estado, entrega y vínculo al evento de Calendar. Una llamada con fecha y hora se interpreta como `reminder.create` con acción subordinada `contact.call`; nunca abre el marcador en ese momento. La tarjeta permite confirmar, reintentar y cancelar sin borrar la entrada. La confirmación crea un evento privado/transparente con aviso emergente de Google Calendar y guarda su ID/URL para evitar duplicados. Esto ofrece el aviso de Calendar en Android cuando la aplicación Calendar está configurada; una notificación propia y fiable de Angeli con la PWA cerrada requiere todavía un planificador externo autenticado y no se considera implementada.

### 2026-08-21 — V0.18 · Sesiones Google pendiente de validación

Cloud Run incorpora el flujo OAuth de código y Secret Manager para que Contactos y Calendar puedan conservar autorizaciones independientes sin almacenar refresh tokens en la PWA. La IA pasa a usar un selector OAuth explícito para evitar bloqueos de One Tap en Android. Cada integración puede usar una cuenta Google distinta. Pendiente de despliegue y comprobación real antes de considerarla publicada estable.

### 2026-08-21 — V0.18.1 · Corrección de arranque

Se corrige un error de sintaxis de `js/google.js` detectado al cargar la PWA publicada. Antes de publicar la corrección se comprobó en navegador que no hay errores de consola y que menú y controles se inicializan. Sigue pendiente validar las sesiones persistentes reales en Android. En la primera prueba posterior, IA sí intercambió su código OAuth y obtuvo estado de sesión (`200`), pero Contactos y Calendar devolvieron `400` antes de Secret Manager: la comparación directa con el encabezado `Origin` se sustituye por validación contra la lista configurada de orígenes permitidos.

### 2026-08-21 — V0.18.4 · Sesiones y avisos pendiente de validación

La autorización persistente de Contactos y Calendar ya se comprobó en Cloud Run: Secret Manager contiene una versión habilitada para cada grant y las llamadas protegidas a `/session/status`, `/interpret` y `/google` devolvieron `200`. La identidad de IA sigue siendo deliberadamente temporal y nunca se guarda en el dispositivo; V0.18.4 intenta recuperarla al abrir mediante Google Identity Services con selección automática. Si Google no permite esa recuperación silenciosa, Ajustes indica que hay que confirmar la cuenta de IA, sin afirmar que Contactos o Calendar hayan perdido su autorización. Las tres integraciones pueden pertenecer a cuentas Google distintas: la cuenta de IA identifica al propietario de la PWA, mientras que los refresh tokens de Contactos y Calendar permanecen separados en Secret Manager.

Los recordatorios locales entienden `a las dos y cuarto` y `a las 2 y 15 minutos`. Para `reminder.create` con hora y sin día, se calcula la próxima ocurrencia temporal; para eventos de Calendar normales se mantiene la exigencia de fecha explícita. Antes de crear el evento privado de Calendar con aviso emergente, la PWA muestra la hora calculada y requiere la acción `Programar`. Android recibe el aviso de Google Calendar solo si Calendar crea correctamente ese evento y sus notificaciones están activadas; no se implementa todavía una notificación propia de Angeli con la PWA cerrada.

Pendiente de validación manual en Android: cerrar/abrir, comprobar estados, crear un recordatorio de prueba, confirmar `Programar`, verificar el evento/alerta de Calendar y cancelar la prueba.

### 2026-08-21 — V0.19 · Cuenta y sincronización preparado

Se adopta Firebase como infraestructura compartida de Angeli: Firebase Auth mantiene la sesión de la cuenta propietaria y Cloud Firestore pasa a ser la fuente de verdad de las entradas entre dispositivos. La PWA conserva `localStorage` como copia de respaldo y migra de forma idempotente las entradas locales al iniciar una sesión; no borra datos locales durante la migración. Los medios siguen como blobs locales en IndexedDB y sus referencias se conservan en las entradas, pero la sincronización física de fotos/archivos se reserva para un bloque posterior de Storage/Drive para no perder adjuntos existentes.

Cloud Run deja de aceptar el ID token efímero de Google Identity Services y pasa a validar ID tokens de Firebase, restringidos al correo propietario mediante `ALLOWED_FIREBASE_EMAILS`. Contactos y Calendar mantienen sus grants persistentes independientes en Secret Manager y pueden pertenecer a cuentas Google distintas. Antes de publicar hay que desplegar las reglas `firestore.rules`, configurar la variable de Cloud Run y validar inicio de sesión, cierre/reapertura, sincronización móvil-escritorio y la migración de datos locales.
## V0.21.27 — Ubicación y contexto en operaciones vinculadas

- En `calendar.create` con `linkedReminder`, la separación local determinista manda sobre una salida remota que mezcle título y ubicación.
- El aviso vinculado debe ser comprensible por sí solo: incluye el evento y su ubicación cuando existen.
- El modal final siempre enseña el campo Ubicación y permite dictarlo o editarlo antes de crear.
## V0.21.28 — Cancelación de operaciones vinculadas

- `angeliRelatedEventId` es el vínculo de Calendar que permite localizar el aviso de un evento principal sin depender solo del estado local.
- Cancelar el evento principal elimina también sus avisos vinculados; en selección de cancelar/modificar se ocultan estos avisos auxiliares.
## V0.21.29 — Aviso vinculado incompleto

- «Recuérdame», «avísame» y «tienes que avisarme» pertenecen al mismo flujo compuesto.
- `linkedReminder.time` puede ser temporalmente nulo mientras la conversación espera la hora; al recibirla hereda la hora del evento.
- Una respuesta corta dentro de esta operación no puede cambiar su intención a Nota ni sobrescribir título, ubicación o tarea del aviso.

## V0.21.32 — Las notas se confirman antes de persistir

- La interpretación de una nota genera primero un borrador local; Firestore y Google Sheets solo reciben la nota después de `Guardar nota`.
- La ficha editable comprende título, contenido, ámbito, relación, motivo y etiquetas.
- Cancelar un borrador no crea entradas y retira los adjuntos que ya se hubieran subido a Drive.

## V0.21.33 — Taxonomía de notas configurable

- Las categorías y tipos de relación son ajustes de cuenta, no preferencias locales del dispositivo.
- Se guardan en `users/{uid}/settings/notes` dentro de `angelifirebase` y se sincronizan junto a la sesión propietaria.
- Borrar una opción usada exige confirmación y migra explícitamente las notas afectadas; siempre debe quedar al menos una categoría.

## V0.21.34 — La interpretación conoce la taxonomía de notas

- Las categorías y relaciones configuradas se incluyen como contexto acotado en cada interpretación, tanto con una conversación activa como sin ella.
- Una orden explícita «anota/apunta/guarda en X» prima como categoría X; no debe reutilizar ese mismo valor como relación salvo que la persona lo pida expresamente.
- Los identificadores personalizados siguen el formato seguro de slug y el backend limita a 30 opciones por grupo.
# Gestor unificado de entradas (V0.21.41)

## Seguimiento 2026-09-08

- V0.21.44 sustituye el estado basado en la existencia de secretos por una comprobación real y solo de lectura: token aceptado y llamada mínima a People, Calendar y las carpetas de Drive. La sesión IA se considera conectada cuando Firebase y Cloud Run validan la identidad; no se consume una inferencia de Gemini en cada apertura.
- La comprobación se ejecuta al arrancar y al regresar tras más de dos minutos o recuperar la red. Si todo está conectado guarda silencio; si no, muestra un único modal y actualiza los textos de Ajustes. Nunca abre OAuth sin que la persona pulse Conectar.
- «No conectado», «faltan permisos» y «no se pudo comprobar temporalmente» son estados diferentes. Las acciones conservan el código estructurado del backend para explicar cuál integración requiere atención.
- El perfil aislado de `integration-gate` ya demostró lectura/escritura y limpieza reales en Calendar y Drive. V0.21.44 amplía la puerta con una lectura mínima real de Contactos y con las mismas comprobaciones de estado que usa la PWA.

- Las consultas de notas, recordatorios y agenda usan un patrón común: listado flotante desplazable → ficha individual → acción → regreso al listado.
- Firestore sigue siendo la fuente operativa de notas y recordatorios; Calendar es la fuente real de eventos y avisos. Google Sheets/Drive son registro y adjuntos, no la fuente desde la que se reconstruye el panel.
- Las consultas temporales admiten mes actual y ventanas naturales de días sin confundir el periodo con el texto que se busca.

## WhatsApp personal (V0.21.45)

- WhatsApp se integra con Click to Chat (`wa.me`), no con Business API ni n8n: Angeli busca el teléfono mediante la conexión ya comprobada de Google Contacts, prepara el texto y abre el chat.
- La última pulsación de Enviar pertenece siempre a la persona dentro de WhatsApp. Angeli solo confirma «Mensaje preparado» porque no conoce la entrega real.
- El flujo es conversacional: pregunta únicamente el destinatario o el mensaje que falte, permite editar el texto y elegir el teléfono si hay varias coincidencias. No requiere OAuth, secretos ni permisos nuevos.
- Pendientes posteriores, separados en sus propios PR: ampliar/abrir imágenes, ciclo completo de archivos en Drive, registrar URL de adjuntos en Sheets, notificaciones PWA cerrada y una posible copia externa de notas.

## Consultas breves de entradas (V0.21.42)

- «Ver», «listar» y una petición breve como «recordatorios» son órdenes de consulta explícitas. Nunca deben caer en el flujo de creación de una nota.
- El estado pedido forma parte de la consulta: «notas hechas» muestra completadas y «notas pendientes» muestra abiertas. Si no hay recordatorios, Angeli lo indica sin crear ninguna entrada.

## 2026-09-10 — Revisión de notas V0.21.46

El usuario confirmó WhatsApp en el móvil: recogida del texto, selección entre contactos coincidentes y apertura con envío final manual correctos.

Se reprodujo que la creación de notas usaba la orden original como contenido, ignorando `aiIntent.notes`, y aceptaba títulos idénticos a la orden. La preparación de la ficha pasa a `js/notes.js`: conserva el detalle interpretado, limpia el prefijo de creación en el respaldo y solicita título/contenido ausentes mediante el editor existente, antes de confirmar. No se modifican integraciones ni el contrato de datos. Prueba móvil pendiente: «Añade una nota personal en la que tengo que enviar un correo»; verificar contenido limpio, título breve o solicitud de título, categoría Personal y edición posterior.

Verificación local: 79 pruebas Node aprobadas y formulario comprobado en navegador: bloqueo de título vacío, contenido limpio, categoría Personal, confirmación y modificación posterior. La puerta real de integración se ejecuta en el PR.

## 2026-09-10 — Avisos propios de Angeli V0.21.47

Se adopta FCM Web Push para identificar cada instalación de la PWA y Cloud Tasks para entregar el aviso aunque Angeli esté cerrada. El usuario activa el permiso mediante una pulsación explícita en Ajustes y puede comprobarlo con «Probar aviso». Los tokens viven en `users/{uid}/pushDevices` y la programación privada en `users/{uid}/pushReminders`, siempre dentro de la base con nombre `angelifirebase`.

Calendar continúa siendo el respaldo visible. Crear o modificar un recordatorio programa las dos vías; completar o cancelar retira ambas. Cada tarea contiene únicamente UID, ID de entrada y fecha técnica. Antes de enviar, Cloud Run vuelve a leer Firestore y exige que la programación coincida y que el recordatorio siga activo, por lo que una tarea antigua no puede generar un aviso obsoleto.

Infraestructura comprobada y configurada en `angeli-secretaria`: APIs Cloud Tasks y FCM activas; cola `angeli-reminders` en `europe-west1`; certificado web push generado; cuenta `angeli-notification-delivery` con invocación de Cloud Run; y cuenta `angeli-ai-interpreter` con acceso limitado a `angelifirebase`, encolado/cancelación de tareas, envío FCM y uso de la identidad de entrega. Falta completar la comprobación real desde cada dispositivo después de publicar V0.21.47.

## 2026-09-12 — Botón de prueba visible V0.21.48

La activación real del dispositivo se confirmó porque Ajustes mostraba «Avisos activos en este dispositivo» y «Renovar». El botón «Probar aviso» existía, pero heredaba `.small-btn.subtle`, una regla histórica con `display:none`. Se retira esa clase únicamente del botón de prueba; los controles secundarios antiguos mantienen su comportamiento.
## 2026-09-12 — Preferencias completas de avisos V0.21.49

- `Ajustes > Avisos Angeli > Configurar` reúne el estado del dispositivo, activación, prueba, desactivación y las preferencias sincronizadas en Firestore (`users/{uid}/settings/notifications`).
- Cada pendiente puede generar aviso anticipado, puntual y posterior. El posterior solo se entrega mientras la entrada siga pendiente; los tipos pueden activarse por separado.
- El servidor desplaza o descarta avisos dentro del horario de descanso según la preferencia de la cuenta. Al guardar ajustes, la PWA vuelve a programar las entradas pendientes.
- La desactivación es local al dispositivo y elimina su token FCM del servidor. Los demás dispositivos conservan su estado.
