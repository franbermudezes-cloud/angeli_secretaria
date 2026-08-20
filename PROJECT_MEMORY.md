# Memoria del proyecto — Angeli Secretaria

## Estado de referencia

- Repositorio remoto/fuente de verdad: `origin` → `git@github.com:franbermudezes-cloud/angeli_secretaria.git`.
- Rama principal: `main`.
- Commit de referencia al iniciar esta memoria: `764d9590e1ece6a0ea20e1d1a3cabe6a71c95f32` (`764d959`, `Update index.html`, 2026-08-20).
- En ese momento, `main` y `origin/main` apuntaban al mismo commit y el árbol de trabajo estaba limpio.
- No existe un README, gestor de paquetes, dependencias declaradas, proceso de build ni pruebas automatizadas.

GitHub es la fuente de verdad del código. Antes de modificar cualquier funcionalidad, comprobar el estado actual del repositorio y del código, y analizar qué otros flujos podrían verse afectados.

## Arquitectura y archivos

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Aplicación completa: marcado, CSS y JavaScript de la secretaria. |
| `manifest.json` | Metadatos de la PWA, colores, inicio e iconos. |
| `sw.js` | Instalación, activación y estrategia de caché de la PWA. |
| `prueba-microfono.html` | Prueba independiente del reconocimiento de voz. |
| `icon-192.png`, `icon-512.png` | Iconos de la PWA. |

La aplicación se ejecuta con un servidor HTTP local, por ejemplo `python3 -m http.server 8000`, y se abre en `http://localhost:8000/`.

## Funcionalidad existente

- Bandeja de entrada de notas: crear, buscar, filtrar por pendiente/hecha, completar, reabrir y borrar.
- Persistencia de las entradas en `localStorage` con la clave `angeli_secretaria_notes_v5`.
- Captura de cámara, selección de imágenes y selección de archivos. Las imágenes se guardan en la entrada como data URLs; de los demás archivos se guarda nombre, tipo y tamaño.
- Dictado en español mediante `SpeechRecognition` o `webkitSpeechRecognition`.
- Envío de datos de la entrada a un endpoint de Google Apps Script/Google Sheets.
- Instalación PWA y disponibilidad parcial offline mediante Service Worker.

## Decisiones y límites conocidos

- Es una aplicación estática de un solo documento: no hay backend propio ni bundler.
- La integración con Google usa `fetch` con `mode: "no-cors"`. Esto no permite al navegador verificar la respuesta del servidor; el aviso de éxito indica que la petición se inició, no que Google confirmó el almacenamiento.
- El dictado depende del soporte del navegador y de los permisos de micrófono. La página `prueba-microfono.html` sirve para aislar ese diagnóstico.
- Las notas se mantienen en `localStorage`; los blobs de imágenes y archivos se guardan en IndexedDB, base `angeli_secretaria_media`, almacenes `images` y `files`.
- Las notas solo conservan IDs de imágenes y referencias ligeras de archivos. Las imágenes Data URL heredadas se migran al iniciar tras confirmar su copia en IndexedDB.
- Los archivos no se suben a Google desde la aplicación actual; se conservan localmente en IndexedDB y pueden abrirse desde la entrada.
- `index.html` muestra `V0.9`, mientras que `manifest.json` y `sw.js` usan `0.8.1` y aún hay referencias a `0.8`. Antes de cambiar versiones o caché, revisar los tres archivos de PWA en conjunto.
- La caché del Service Worker puede retener recursos en el navegador. Tras cambios de PWA, validar actualización, activación y recursos precargados.

## Protocolo antes de cambios funcionales

1. Consultar el estado Git, la rama y la relación con `origin`.
2. Leer los archivos implicados y localizar dependencias o flujos relacionados.
3. Definir el alcance y los posibles efectos en interfaz, datos locales, Google Sheets, dictado, adjuntos y PWA.
4. Aplicar cambios mínimos y validar los flujos afectados en un servidor HTTP local.
5. Actualizar esta memoria y `CHANGELOG.md` cuando haya decisiones, limitaciones o cambios funcionales relevantes.

## Registro de decisiones y soluciones

Añadir aquí, con fecha, el contexto, la decisión tomada, los archivos implicados y cómo se verificó. No sustituir decisiones anteriores sin explicar el motivo del cambio.
