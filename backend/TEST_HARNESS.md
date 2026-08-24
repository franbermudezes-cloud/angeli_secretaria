# Entorno automático de pruebas reales

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
export GOOGLE_WEB_CLIENT_ID='…client-id-web…'
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

El check obligatorio se llama `integration-gate`. Un resultado `FAIL` deja el
Pull Request abierto. Cuando pasa y la rama empieza por `codex/`, el mismo
workflow activa la fusión automática. El informe JSON se conserva como
artefacto de GitHub durante 30 días.

## Cobertura inicial

La primera fase automatiza las integraciones reales ya aislables:

- `P04`: crear, buscar y cancelar un evento en Calendar.
- `P10`: crear dos eventos y recuperarlos por intervalo de fecha.
- `P11`: localizar un evento y actualizar su hora en el mismo calendario.
- Base de `P06/P07`: subir un adjunto a Drive y eliminarlo.

Los casos conversacionales, de Firestore, notificación PWA y negocio siguen
marcados como manuales hasta que exista un perfil de Firebase de prueba y una
autorización OAuth de pruebas separada.
