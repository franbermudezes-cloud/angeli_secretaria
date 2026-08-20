# Reglas de trabajo — Angeli Secretaria

## Fuente de verdad y control de cambios

- GitHub (`origin`) es la fuente de verdad del código. Antes de iniciar trabajo, revisar la rama, el estado de Git y la referencia remota relevante.
- Antes de modificar una funcionalidad, inspeccionar qué existe actualmente en el código y en el historial cuando sea necesario. No asumir que la descripción de una tarea refleja el estado real.
- Evaluar qué otras funciones pueden verse afectadas antes de editar. En especial, revisar las relaciones entre interfaz, almacenamiento local, dictado, adjuntos, envío a Google Sheets y comportamiento PWA/caché.
- Mantener los cambios acotados a la solicitud. No modificar archivos funcionales, versiones, configuración de caché ni integraciones externas de forma incidental.
- No crear commits, etiquetas, ramas remotas ni hacer `push` sin autorización explícita del usuario.

## Arquitectura actual

- El proyecto es una aplicación web estática sin framework, dependencias, gestor de paquetes ni proceso de compilación.
- `index.html` contiene la interfaz, los estilos y la lógica principal.
- `manifest.json` y `sw.js` configuran la PWA y su caché offline.
- `prueba-microfono.html` es una prueba aislada de reconocimiento de voz.

## Forma de trabajar

- Para desarrollo local, servir la raíz por HTTP, por ejemplo: `python3 -m http.server 8000`, y abrir `http://localhost:8000/`.
- Verificar los flujos afectados en un navegador compatible. El dictado requiere `SpeechRecognition`/`webkitSpeechRecognition` y permiso de micrófono.
- Al modificar PWA, revisar conjuntamente `index.html`, `manifest.json` y `sw.js`, incluido el versionado de recursos y el comportamiento de caché.
- Si se cambia el modelo de datos, preservar o planificar la migración de las entradas guardadas en `localStorage`.
- Registrar en `PROJECT_MEMORY.md` las decisiones, limitaciones y soluciones que deban persistir entre sesiones; actualizar `CHANGELOG.md` para cambios funcionales relevantes.

## Límites e integraciones

- El endpoint de Google Apps Script es una integración externa: no cambiarlo, ni sus datos enviados, sin una solicitud explícita y una revisión de impacto.
- Los adjuntos e imágenes tienen limitaciones de almacenamiento local; no alterar su tratamiento sin verificar sus efectos sobre las entradas existentes.
- Mantener la documentación en español, salvo identificadores técnicos o texto que deba conservarse literal.
