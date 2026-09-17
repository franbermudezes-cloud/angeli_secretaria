# Memoria del proyecto — Angeli Secretaria

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
