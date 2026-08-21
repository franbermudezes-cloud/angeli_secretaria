# Reglas de trabajo — Angeli Secretaria

## Fuente de verdad y control de cambios

- GitHub (`origin`) es la fuente de verdad del código. Antes de iniciar trabajo, revisar la rama, el estado de Git y la referencia remota relevante.
- Antes de modificar una funcionalidad, inspeccionar qué existe actualmente en el código y en el historial cuando sea necesario. No asumir que la descripción de una tarea refleja el estado real.
- Evaluar qué otras funciones pueden verse afectadas antes de editar. En especial, revisar las relaciones entre interfaz, almacenamiento local, dictado, adjuntos, envío a Google Sheets y comportamiento PWA/caché.
- Mantener los cambios acotados a la solicitud. No modificar archivos funcionales, versiones, configuración de caché ni integraciones externas de forma incidental.
- No crear commits, etiquetas, ramas remotas ni hacer `push` sin autorización explícita del usuario.
- Todo commit funcional debe incrementar la versión visible de la aplicación y sincronizar `index.html`, referencias `?v=`, `manifest.json`, la versión/caché de `sw.js` y cualquier otro identificador PWA. Los commits exclusivamente documentales no requieren cambio de versión.

## Arquitectura actual

- El proyecto es una aplicación web estática sin framework, dependencias, gestor de paquetes ni proceso de compilación.
- `index.html` contiene la estructura HTML y carga el punto de entrada de módulos; no incorporar en él lógica de negocio nueva.
- `styles.css` contiene todos los estilos de la interfaz. No añadir bloques CSS grandes a `index.html`; mantener los cambios visuales en esta hoja de estilos.
- `js/app.js` inicializa la aplicación y coordina el estado y los eventos principales.
- `js/ui.js` contiene el renderizado, tarjetas, estados visuales, previsualizaciones y mensajes.
- `js/storage.js` concentra `localStorage`, IndexedDB, medios, migraciones y limpieza.
- `js/classifier.js` concentra clasificación, teléfonos y prioridades; `js/temporal.js` contiene únicamente las utilidades de fecha y hora.
- `js/ai.js` interpreta texto mediante un proveedor intercambiable y valida una lista cerrada de intenciones; `js/intents.js` convierte esas intenciones en propuestas sin efectos externos.
- `js/google.js` contiene OAuth, Contacts y Calendar; `js/sheets.js` contiene exclusivamente el envío existente a Apps Script/Google Sheets.
- `js/firebase.js` concentra Firebase Auth y Firestore: sesión persistente y sincronización de entradas. Firestore es la fuente compartida de las entradas; `localStorage` es una copia local de migración/respaldo y IndexedDB sigue siendo local para blobs hasta la futura migración explícita de medios.
- `manifest.json` y `sw.js` configuran la PWA y su caché offline.
- `prueba-microfono.html` es una prueba aislada de reconocimiento de voz.

Antes de introducir una responsabilidad nueva, decidir su módulo. No concentrar funcionalidades nuevas en `app.js` por comodidad: mantener coordinación en `app.js`, presentación en `ui.js`, datos en `storage.js`, clasificación en `classifier.js`, temporal en `temporal.js`, interpretación en `ai.js`, propuestas en `intents.js` e integraciones en sus módulos correspondientes. Una respuesta de IA nunca ejecuta directamente una acción sensible.

## Forma de trabajar

- Para desarrollo local, servir la raíz por HTTP, por ejemplo: `python3 -m http.server 8000`, y abrir `http://localhost:8000/`.
- Verificar los flujos afectados en un navegador compatible. El dictado requiere `SpeechRecognition`/`webkitSpeechRecognition` y permiso de micrófono.
- Al modificar PWA, revisar conjuntamente `index.html`, `styles.css` cuando corresponda, `manifest.json` y `sw.js`, incluido el versionado de recursos y el comportamiento de caché.
- Si se cambia el modelo de datos, preservar o planificar la migración de las entradas guardadas en `localStorage`.
- Registrar en `PROJECT_MEMORY.md` las decisiones, limitaciones y soluciones que deban persistir entre sesiones; actualizar `CHANGELOG.md` para cambios funcionales relevantes.

## Límites e integraciones

- El endpoint de Google Apps Script es una integración externa: no cambiarlo, ni sus datos enviados, sin una solicitud explícita y una revisión de impacto.
- Los adjuntos e imágenes tienen limitaciones de almacenamiento local; no alterar su tratamiento sin verificar sus efectos sobre las entradas existentes.
- Google Sheets es un registro externo, no la fuente de verdad operativa. No usar GitHub como base de datos. Las entradas sincronizadas pertenecen únicamente a `users/{uid}/entries/{entryId}` en Firestore y las reglas deben exigir `request.auth.uid == userId`.
- Firebase Auth identifica a la cuenta propietaria de Angeli y debe usar persistencia local de navegador. Contactos y Calendar pueden autorizarse con cuentas Google distintas, pero sus refresh tokens solo se guardan en Secret Manager y nunca en Firestore, IndexedDB, `localStorage` o GitHub.
- Mantener la documentación en español, salvo identificadores técnicos o texto que deba conservarse literal.

## Automatización y n8n

- Angeli Secretaria debe ser una PWA lo más autónoma posible. Usar la PWA y sus módulos JavaScript para interfaz, validación, confirmaciones, IndexedDB, interpretación integrada y acciones inmediatas.
- Usar Google APIs directas para acciones inmediatas que requieran respuesta en pantalla, como Contactos y Calendar. Al llegar Drive, estudiar primero una conexión directa y segura desde la PWA antes de proponer automatización externa.
- n8n es una herramienta auxiliar futura para automatizaciones en segundo plano, correo, seguimientos, procesos programados o flujos complejos con una razón concreta; no es el motor de las funciones básicas de la PWA ni la arquitectura principal de Drive o IA.
- No migrar a n8n una función ya validada solo por centralizarla. Antes de cada integración nueva, comparar explícitamente lógica local, Google API directa y n8n, y elegir la alternativa más simple, segura y mantenible.
- Un webhook de n8n no puede considerarse seguro solo por ser poco visible. No incrustar secretos, contraseñas, tokens permanentes ni credenciales de webhook en la PWA pública.
