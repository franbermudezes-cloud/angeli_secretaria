# Entorno automático de pruebas reales

El arnés `test_harness.py` prueba integraciones reales sin tocar las cuentas,
autorizaciones, calendarios ni carpetas de producción.

## Aislamiento obligatorio

- Cuenta de prueba: `buengusto.es@gmail.com`.
- Carpeta Drive de prueba: `Angeli - Pruebas` (`1A1iuK8xwn3icpNezmB2JeOvD8_fsKuEx`).
- Secretos exclusivos: `angeli-test-google-contacts-grant`,
  `angeli-test-google-calendar-grant` y `angeli-test-google-drive-grant`.
- Prefijo de todos los datos creados: `ANGELI-TEST-<id>`.

El arnés no lee secretos `angeli-google-*-grant`, que pertenecen a producción.
Cada ejecución elimina sus eventos y adjuntos incluso cuando una prueba falla.

## Preparación pendiente antes de la primera ejecución

1. Crear los tres secretos de prueba en Secret Manager y conceder a
   `angeli-ai-interpreter@angeli-secretaria.iam.gserviceaccount.com` los roles
   `Secret Manager Secret Accessor` y `Secret Manager Secret Version Adder`
   sobre esos secretos, no sobre los de producción.
2. Autorizar con `buengusto.es@gmail.com` los scopes mínimos independientes de
   Contacts, Calendar y Drive y guardar cada refresh token en su secreto de
   prueba. Esta vinculación se implementará como perfil de pruebas separado;
   **no** se debe usar el botón de conexiones de la PWA de producción.
3. Verificar desde Cloud Run: crear, listar y borrar un evento de la agenda de
   prueba; crear y borrar un archivo en `Angeli - Pruebas`.

La contraseña, 2FA y consentimiento inicial de `buengusto.es@gmail.com` los
realiza siempre la persona propietaria. No se guardan en código ni en Git.

## Ejecución

Solo después de completar la preparación:

```bash
cd backend
export ANGELI_TEST_MODE=1
export GOOGLE_CLOUD_PROJECT=angeli-secretaria
export GOOGLE_WEB_CLIENT_ID='…client-id-web…'
python3 test_harness.py
```

El resultado queda en `backend/test-reports/`, ruta ignorada por Git. Todavía
no se envía a Google Sheets: el Apps Script actual registra entradas de Angeli,
no ejecuciones de pruebas. Antes de registrar resultados allí hay que crear un
destino de pruebas separado con un contrato específico.

## Cobertura inicial

La primera fase automatiza las integraciones reales ya aislables:

- `P04`: crear, buscar y cancelar un evento en Calendar.
- `P10`: crear dos eventos y recuperarlos por intervalo de fecha.
- Base de `P06/P07`: subir un adjunto a Drive y eliminarlo.

Los casos conversacionales, de Firestore, notificación PWA y negocio siguen
marcados como manuales hasta que exista un perfil de Firebase de prueba y una
autorización OAuth de pruebas separada.
