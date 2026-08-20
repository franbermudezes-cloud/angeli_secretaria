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
| `js/storage.js` | `localStorage`, IndexedDB, medios, migración y limpieza. |
| `js/classifier.js` | Tipos, prioridades, teléfonos y datos derivados de la clasificación. |
| `js/temporal.js` | Detección temporal actual, sin reglas de negocio adicionales. |
| `js/ai.js` | Interpretación estructurada, proveedor intercambiable, validación y fallback. |
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
- Persistencia de las entradas en `localStorage` con la clave `angeli_secretaria_notes_v5`.
- Captura de cámara, selección de imágenes y selección de archivos. Imágenes y archivos se guardan localmente como blobs en IndexedDB.
- Dictado en español mediante `SpeechRecognition` o `webkitSpeechRecognition`.
- Envío de datos de la entrada a un endpoint de Google Apps Script/Google Sheets.
- Consulta opcional de contactos por nombre mediante Google Identity Services OAuth y People API; solicita exclusivamente `contacts.readonly` cuando la persona usuaria pulsa `🔗 Conectar Google`.
- Creación opcional de eventos en el calendario principal mediante Google Identity Services OAuth y Calendar API; solicita exclusivamente `calendar.events` cuando la persona usuaria confirma `📅 Añadir al calendario`.
- Instalación PWA y disponibilidad parcial offline mediante Service Worker.

## Decisiones y límites conocidos

- Es una aplicación estática de un solo documento: no hay backend propio ni bundler.
- La integración con Google usa `fetch` con `mode: "no-cors"`. Esto no permite al navegador verificar la respuesta del servidor; el aviso de éxito indica que la petición se inició, no que Google confirmó el almacenamiento.
- El dictado depende del soporte del navegador y de los permisos de micrófono. La página `prueba-microfono.html` sirve para aislar ese diagnóstico.
- Las notas se mantienen en `localStorage`; los blobs de imágenes y archivos se guardan en IndexedDB, base `angeli_secretaria_media`, almacenes `images` y `files`.
- Las notas solo conservan IDs de imágenes y referencias ligeras de archivos. Las imágenes Data URL heredadas se migran al iniciar tras confirmar su copia en IndexedDB.
- Los archivos no se suben a Google desde la aplicación actual; se conservan localmente en IndexedDB y pueden abrirse desde la entrada.
- Google Contacts no utiliza el endpoint público de Apps Script. El Client ID web es público por diseño; los tokens de acceso y las coincidencias de contactos permanecen únicamente en memoria y no se guardan en GitHub, `localStorage` ni IndexedDB.
- Google Calendar tampoco utiliza el endpoint público de Apps Script. Su token de acceso permanece únicamente en memoria. Las notas de calendario conservan `calendarStatus`, `calendarEventId`, `calendarUrl` y, cuando se detecta, `location`; nunca el token.
- Contactos y Calendar se conectan por separado porque pueden pertenecer a cuentas distintas. La interfaz muestra el estado de cada integración solo durante la sesión, permite elegir o cambiar cuenta por separado y permite desconectar la sesión local sin revocar permisos en Google.
- La opción `⚙️ Mantenimiento · Borrar todos los datos` elimina solo la clave local de notas y la base IndexedDB de medios tras confirmación; nunca modifica Google Sheets.
- La versión visible y las referencias de caché PWA deben mantenerse alineadas. Antes de cambios futuros de versión o caché, revisar en conjunto `index.html`, `manifest.json`, `sw.js` y los recursos versionados.
- La caché del Service Worker puede retener recursos en el navegador. Tras cambios de PWA, validar actualización, activación y recursos precargados.
- Angeli Secretaria debe mantenerse como PWA lo más autónoma posible. n8n es auxiliar futuro para automatizaciones en segundo plano, correo, seguimientos, procesos programados o workflows complejos, nunca el motor de sus funciones básicas. Contacts y Calendar continúan por Google APIs directas; al llegar Drive se estudiará primero conexión directa y segura desde la PWA. No se deben incrustar secretos de webhooks ni credenciales de n8n en la PWA pública.
- El intérprete IA se ejecuta de forma aislada en Cloud Run (`angeli-ai-interpreter`, región `europe-southwest1`) y usa la cuenta de servicio dedicada con `roles/aiplatform.user` y ADC. No usa API key ni archivo JSON. La URL del servicio es pública solo a nivel de red: el endpoint exige un ID token de Google válido, con audiencia del Client ID web y `sub` incluido en la lista privada `ALLOWED_GOOGLE_SUBS` del servicio.

## Protocolo antes de cambios funcionales

1. Consultar el estado Git, la rama y la relación con `origin`.
2. Leer los archivos implicados y localizar dependencias o flujos relacionados.
3. Definir el alcance y los posibles efectos en interfaz, datos locales, Google Sheets, dictado, adjuntos y PWA.
4. Aplicar cambios mínimos y validar los flujos afectados en un servidor HTTP local.
5. Actualizar esta memoria y `CHANGELOG.md` cuando haya decisiones, limitaciones o cambios funcionales relevantes.

## Registro de decisiones y soluciones

Añadir aquí, con fecha, el contexto, la decisión tomada, los archivos implicados y cómo se verificó. No sustituir decisiones anteriores sin explicar el motivo del cambio.

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

### 2026-08-21 — V0.16.2 · Recuperación de caché PWA pendiente de validación

Durante la primera prueba de V0.16 se cargó una copia previa de `ui.js` desde la caché PWA, que contenía un error de sintaxis e impedía inicializar todos los controles. La corrección no altera la funcionalidad: renueva de forma coherente `index.html`, módulos JavaScript, manifest, Service Worker y caché a `0.16.2`. Esta renovación es obligatoria para recuperar correctamente una instalación Android que ya hubiese guardado el recurso anterior. Pendiente de comprobar menú, envío y dictado en Android antes de considerar V0.16 operativa.
