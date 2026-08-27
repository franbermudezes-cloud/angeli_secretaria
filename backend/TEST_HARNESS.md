# Entorno automático de pruebas reales

V0.21.26: P05 compuesto. La frase oficial de boda en Masía X produce un evento
el 14 de septiembre a las 18:00 y el aviso «Comprobar el equipo» dos días
antes. La prueba PWA valida interpretación, payloads, persistencia y consulta
del recordatorio. `P05-linked` crea ambos recursos en Calendar aislado, exige
que el aviso conserve el ID del evento relacionado y los elimina al terminar.

V0.21.25: regresión de modificación por persona. `P11` crea «Quedada con
María», simula la salida problemática de Gemini `target.title = "hora con
María"` y exige que «Cámbiame la hora con María» consulte Calendar usando solo
`María`, encuentre el evento real y actualice su hora. La prueba local verifica
además que tanto el intérprete de respaldo como la protección de la respuesta
remota muestran `María` en el modal, nunca `hora con María`.

V0.21.24: regresión semántica de cancelación. `P04-name` crea eventos reales
«Quedada con Miguel» y exige que la orden «Anula cita con Miguel» los encuentre
buscando por `Miguel`, permita cancelar uno solo y conserve el resto. La prueba
local amplía los equivalentes cita, quedada, reunión, llamada, cena, comida,
evento, aviso y recordatorio. La PWA conserva el objetivo semántico devuelto
por la IA y limita la capa local a proteger la intención sensible. `P11` crea
«Quedada con Miguel» y exige que «cámbiame la hora de Miguel» la encuentre y
modifique usando solo `Miguel` como criterio.

V0.21.23: regresión de persistencia de descripciones. La serialización que usa
Firestore es ahora una pieza pura probada en el arnés PWA: conserva tanto
`calendarDescription` en eventos como `schedule.description` en recordatorios
durante la ida y vuelta entre dispositivos. `P05-description` crea un evento y
un recordatorio reales con esos payloads, vuelve a leerlos desde Calendar,
compara las dos descripciones exactas y elimina ambos recursos al terminar.

V0.21.22: ficha de confirmación única para eventos y recordatorios. Las pruebas
PWA verifican que título, descripción y ubicación mostrados antes de confirmar
son exactamente los enviados a Calendar, y que título y descripción se pueden
editar sin alterar fecha, hora ni lugar. El dictado dentro del editor y la
presentación final del modal se comprueban manualmente en un móvil real.

V0.21.21: reconciliación de avisos borrados fuera de Angeli. `P03-external`
crea y elimina un evento real en Calendar y verifica que la ausencia queda
observable. Las pruebas del backend distinguen evento activo de 404/410 y las
pruebas PWA comprueban que solo el aviso ausente pasa a cancelado; un error
técnico no modifica las entradas.

V0.21.20: regresión automática de la frase real «Cámbiame la hora de llamar a
Miguel». Comprueba que una respuesta errónea de IA como `contact.call` queda
subordinada a `calendar.update`, conserva «Miguel» como objetivo y mantiene la
conversación abierta para solicitar la nueva hora. También se verifica que la
instrucción enviada a Gemini contiene esta prioridad explícita.

V0.21.19: pruebas locales de reprogramación con variantes naturales, operación
incompleta continuada por voz/texto, búsqueda normalizada por persona y
actualización exclusiva del recordatorio vinculado al evento seleccionado. El
arnés real P11 continúa verificando búsqueda y PATCH en Calendar aislado; la
elección visual entre varias coincidencias se valida en la PWA y permanece como
comprobación manual final en móvil.

V0.21.18: prueba local del modal conversacional con micrófono propio, sin
autofoco que abra el teclado y limitado por `visualViewport`. La autorización
real del micrófono y la convivencia con el teclado se mantienen como prueba
manual en dispositivo móvil; no cambia ninguna integración externa.

V0.21.17: P03 localiza recordatorios programados cuya conversación ya terminó,
retira el evento antes de cambiar el estado de Angeli y conserva ambos como
pendientes si Calendar falla. `P03-complete` crea y elimina un aviso real en la
cuenta aislada; la escritura de Firestore permanece como comprobación manual.

V0.21.16: comprobación previa registrada desde `integration-gate` V0.21.15:
cuenta aislada `buengusto.es@gmail.com`, Calendar `primary`, cliente OAuth y
grant `angeli-test-google-*`; P04/P04-name/P10/P11/P05/P06 PASS. El cambio
añade `pageToken` sin cambiar identidad, calendario ni permisos. P10 fuerza
dos páginas reales (`maxResults=1`) y exige recuperar ambos eventos. Las
pruebas JS reúnen 27 resultados y rechazan un ciclo anómalo; la fixture visual
con 40 eventos comprueba scroll y acciones.

V0.21.15: `tests/conversation.test.mjs` cubre llamada sin fecha mal clasificada
por IA/fallback, protección de llamadas futuras y conversaciones activas,
botones de elección y continuidad al programar sin perder el contacto.
La apertura del marcador telefónico del móvil permanece como prueba manual;
las pruebas automáticas no efectúan llamadas reales.

V0.21.14: acciones de consulta de agenda automatizadas en `tests/conversation.test.mjs`:
Ver/Anular por ID, volver al listado, refrescar tras DELETE correcto, no marcar éxito
si se rechaza/falla y bloqueo de doble pulsación. `tests/agenda-long.html` permite
comprobar la presentación con 40 eventos ficticios. El arnés real P04/P04-name
mantiene la cobertura de consulta y cancelación selectiva en Calendar de pruebas;
la interacción completa PWA autenticada sigue siendo comprobación manual.

Comprobación previa al cambio de título (26/08/2026): arnés ejecutado desde
Cloud Shell en `angeli-secretaria`, cliente OAuth exclusivo de pruebas,
secretos `angeli-test-google-*`, Calendar `primary` de la cuenta de pruebas.
P04/P10/P11/P06: PASS (crear, leer, modificar y eliminar recursos aislados).
La PWA usa igualmente Calendar `primary` mediante la autorización Calendar;
este cambio no cambia identidad, permisos, calendario ni Firestore.

El arnés `test_harness.py` prueba integraciones reales sin tocar las cuentas,
autorizaciones, calendarios ni carpetas de producción.

## Aislamiento obligatorio

- Cuenta de prueba: `buengusto.es@gmail.com`.
- Carpeta Drive de prueba: `Angeli - Pruebas` (`1A1iuK8xwn3icpNezmB2JeOvD8_fsKuEx`).
- Secretos exclusivos: `angeli-test-google-contacts-grant`,
  `angeli-test-google-calendar-grant`, `angeli-test-google-drive-grant` y
  `angeli-test-google-oauth-client-secret`.
- Prefijo de todos los datos creados: `ANGELI-TEST-<id>`.

El arnés no lee secretos `angeli-google-*-grant` ni
`angeli-oauth-client-secret`, que pertenecen a producción.
Cada ejecución elimina sus eventos y adjuntos incluso cuando una prueba falla.

## Preparación pendiente antes de la primera ejecución

1. Crear los tres secretos de prueba en Secret Manager y conceder a
   `angeli-ai-interpreter@angeli-secretaria.iam.gserviceaccount.com` los roles
   `Secret Manager Secret Accessor` y `Secret Manager Secret Version Adder`
   sobre esos secretos, no sobre los de producción.
2. Desplegar Cloud Run con `ANGELI_TEST_HARNESS_ENABLED=1` y abrir
   `/tests/test-auth.html` en GitHub Pages. Iniciar sesión allí como propietario
   de Angeli y elegir `buengusto.es@gmail.com` para cada una de las tres
   conexiones. La página escribe exclusivamente en los secretos de prueba;
   **no** se debe usar el botón de conexiones de la PWA de producción.
3. Verificar desde Cloud Run: crear, listar y borrar un evento de la agenda de
   prueba; crear y borrar un archivo en `Angeli - Pruebas`.

La contraseña, 2FA y consentimiento inicial de `buengusto.es@gmail.com` los
realiza siempre la persona propietaria. No se guardan en código ni en Git.

## Ejecución

Solo después de completar la preparación:

```bash
cd backend
python3 -m pip install --user -r requirements.txt
export ANGELI_TEST_MODE=1
export GOOGLE_CLOUD_PROJECT=angeli-secretaria
export ANGELI_TEST_GOOGLE_WEB_CLIENT_ID='…client-id-web-exclusivo-de-pruebas…'
python3 test_harness.py
```

El resultado queda en `backend/test-reports/`, ruta ignorada por Git. Todavía
no se envía a Google Sheets: el Apps Script actual registra entradas de Angeli,
no ejecuciones de pruebas. Antes de registrar resultados allí hay que crear un
destino de pruebas separado con un contrato específico.

## Puerta automática de GitHub

Cada Pull Request contra `main` ejecuta `.github/workflows/integration-gate.yml`.
GitHub obtiene credenciales efímeras de Google mediante Workload Identity
Federation e impersona exclusivamente
`angeli-integration-gate@angeli-secretaria.iam.gserviceaccount.com`; no existe
una clave JSON permanente en GitHub. La cuenta solo puede leer los secretos
OAuth aislados que necesita el arnés.

El primer PR de implantación (`codex/integration-gate`) queda excluido del
auto-merge para revisar manualmente que la puerta bloquea y publica el informe.
Los PR posteriores de ramas `codex/*` sí se fusionan automáticamente al pasar.

La configuración inicial de Google se instala de forma idempotente con
`scripts/setup-integration-gate.sh`. El script no imprime secretos y verifica
al final el proveedor federado y los cuatro permisos mínimos de lectura. Falla
de forma segura si alguno de los cuatro secretos aislados no existe o no tiene
una versión habilitada: nunca crea, copia ni consulta un secreto de producción.
El arnés exige además `ANGELI_TEST_GOOGLE_WEB_CLIENT_ID`; nunca acepta
`GOOGLE_WEB_CLIENT_ID` como sustituto. El cliente web de pruebas y su secreto
pertenecen exclusivamente a `Angeli Integration Gate Tests`.
La configuración del repositorio se instala con
`scripts/setup-github-integration-gate.sh`: activa auto-merge, protege `main`
con el check obligatorio y abre el primer PR sin fusionarlo.

El check obligatorio se llama `integration-gate`. Un resultado `FAIL` deja el
Pull Request abierto. Cuando pasa y la rama empieza por `codex/`, el mismo
workflow activa la fusión automática. El informe JSON se conserva como
artefacto de GitHub durante 30 días.

## Cobertura inicial

Listado largo: prueba automática del contrato de estilos en conversation.test.mjs
y fixture `tests/agenda-long.html` con 40 eventos ficticios. La geometría, el
desplazamiento real y el cierre se verifican en navegador; no se confunden con
una prueba automática de Calendar o de dispositivos físicos.

La primera fase automatiza las integraciones reales ya aislables:

- `P04`: crear, buscar y cancelar un evento en Calendar.
- `P04-name`: «Anula llamada a Miguel Ibiza» sin fecha/hora recorre el
  coordinador y constructor de búsqueda PWA; recupera tres llamadas reales,
  cancela una por ID y comprueba que las otras dos permanecen. Limpieza aislada.
  Pruebas locales adicionales verifican «no lo sé», botones seleccionables y
  confirmación del ID elegido. No prueban el micrófono ni una respuesta de Gemini
  en directo. Prueba manual: dictar la frase, elegir una de tres coincidencias,
  confirmar y comprobar que las otras permanecen sin preguntas temporales.
  También verifica que indicar una fecha permite recuperar una llamada a 120 días.
- `P03-complete`: crear un aviso real de llamada, retirarlo al completarlo y
  comprobar que ya no continúa activo en Calendar. La prueba local verifica
  además que Angeli solo cambia Firestore a completado después de que Google
  confirme el borrado; Firestore real continúa cubierto por la prueba manual.
- `P10`: crear dos eventos y recuperarlos por intervalo de fecha.
- `P11`: localizar un evento y actualizar su hora en el mismo calendario.
- `P05-model-time`: replay de la respuesta Gemini capturada con `10:00:00`,
  validación backend, constructor PWA y creación/lectura Calendar real a las
  10:00 Madrid del 27/08/2026. No invoca al modelo en cada ejecución.
- `P05-relative`: constructor PWA desde referencia fija 26/08/2026; mañana
  debe guardarse el 27 y pasado mañana el 28, ambos a las 11:00 Madrid.
  Crea y lee ambos eventos de Calendar real, con limpieza posterior.
- `P05-summary`: transcripción «Recuérdame llamar a Miguel Ibiza mañana a las
  diez de la mañana», IA parcial controlada sin nombre, constructor compartido
  con la PWA y creación/lectura en Calendar real. Comprueba summary y description
  y elimina el evento. Requiere Node en PATH (ya disponible en el runner).
  No prueba micrófono ni Gemini; las notificaciones Android siguen manuales.
- Base de `P06/P07`: subir un adjunto a Drive y eliminarlo.

La misma puerta ejecuta además `tests/conversation.test.mjs`, que protege el
coordinador local sin simular éxitos de Google: P01 pregunta únicamente la
hora pendiente, P02 conserva la intención y el identificador de la operación,
P03 localiza y completa el pendiente existente sin crear otra entrada (y exige
elegir si encuentra varios), y su prueba de regresión consulta después solo
los recordatorios que continúan pendientes aunque su conversación esté cerrada.
La consulta general, el filtro por persona y el respaldo de consulta se prueban
localmente con proveedor simulado, no se presentan como pruebas de Gemini real.
`tests/reminder-query.html` permite comprobar la tarjeta de resultados sin
autenticación ni escrituras externas; usa exclusivamente dos entradas ficticias.
Un recordatorio completo evita preguntas
redundantes y cancelar/completar cierra la interacción activa. La comprobación real de esta sesión confirmó
también el mismo recorrido contra la IA remota antes de incorporar la prueba.

Firestore, notificación PWA y los recorridos visuales completos siguen
marcados como manuales hasta que exista un perfil Firebase aislado para el
arnés. Las pruebas del coordinador no sustituyen la validación periódica del
proveedor real: evitan que una respuesta corta vuelva a convertirse en una
orden independiente si la IA falla o responde con baja confianza.
