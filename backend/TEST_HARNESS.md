# Entorno automático de pruebas reales

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

La primera fase automatiza las integraciones reales ya aislables:

- `P04`: crear, buscar y cancelar un evento en Calendar.
- `P04-name`: «Anula llamada a Miguel Ibiza» sin fecha/hora recorre el
  coordinador y constructor de búsqueda PWA; recupera tres llamadas reales,
  cancela una por ID y comprueba que las otras dos permanecen. Limpieza aislada.
  Pruebas locales adicionales verifican «no lo sé», botones seleccionables y
  confirmación del ID elegido. No prueban el micrófono ni una respuesta de Gemini
  en directo. Prueba manual: dictar la frase, elegir una de tres coincidencias,
  confirmar y comprobar que las otras permanecen sin preguntas temporales.
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
