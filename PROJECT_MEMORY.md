# Memoria del proyecto — Angeli Secretaria

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
