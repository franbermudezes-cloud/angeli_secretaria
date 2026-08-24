# Backend de interpretación IA

Este servicio interpreta texto mediante `POST /interpret` y actúa como backend
seguro para las integraciones persistentes de Google. La PWA nunca recibe ni
guarda refresh tokens.

Además ofrece, siempre tras comprobar un ID token de Firebase del propietario:

- `POST /session/status`: estado de las vinculaciones de Contactos, Calendar y Drive.
- `POST /oauth/exchange`: intercambia un código OAuth; los refresh tokens de
  Contactos, Calendar y Drive se guardan exclusivamente en Secret Manager.
- `POST /google`: consulta acotada de Contactos y operaciones de Calendar.
- `POST /media/upload`, `/media/download` y `/media/delete`: adjuntos de Angeli en Drive.

No escribe en Sheets ni descarga la agenda completa. Cuando la persona propietaria conecta Drive, recibe y sirve únicamente los adjuntos creados por Angeli mediante `drive.file`; no analiza el resto de Mi unidad.

## Producción en Cloud Run

Cloud Run debe usar una Service Account dedicada con el rol
`roles/aiplatform.user`. Para las sesiones persistentes, esa misma identidad
necesita `roles/secretmanager.secretAccessor` y
`roles/secretmanager.secretVersionAdder` sobre estos secretos:

- `angeli-oauth-client-secret`
- `angeli-google-contacts-grant`
- `angeli-google-calendar-grant`
- `angeli-google-drive-grant`

El SDK obtiene Application Default Credentials de la identidad del servicio;
no se usan API keys ni archivos JSON de cuentas de servicio.

Variables necesarias:

- `GOOGLE_CLOUD_PROJECT`: proyecto de Google Cloud.
- `VERTEX_LOCATION`: `global` inicialmente.
- `GOOGLE_WEB_CLIENT_ID`: Client ID web ya usado por la PWA.
- `ANGELI_TEST_GOOGLE_WEB_CLIENT_ID`: Client ID web exclusivo de
  `Angeli Integration Gate Tests`; solo lo usan `/test/*` y el arnés, y nunca
  puede sustituirse por el cliente de producción.
- `ALLOWED_FIREBASE_EMAILS`: correos propietarios de Angeli autorizados,
  separados por coma. Actualmente: `franbermudez.es@gmail.com`.
- `ALLOWED_ORIGINS`: orígenes exactos de GitHub Pages y de desarrollo local,
  separados por coma.

La PWA envía un ID token de Firebase en `Authorization: Bearer <id-token>`.
El servicio verifica su firma, proyecto, expiración y correo validado antes de
llamar a Vertex AI o a una integración Google.

Firebase Auth mantiene la sesión de Angeli en el navegador. Firestore contiene
las entradas compartidas entre dispositivos; Secret Manager conserva solo las
autorizaciones de Contactos y Calendar, que pueden pertenecer a cuentas
distintas de la cuenta propietaria de Angeli.

Los medios se envían directamente desde la PWA al servicio. Drive usa una
autorización OAuth persistente del Gmail propietario de las carpetas; la
cuenta de servicio de Cloud Run no crea archivos porque Google no le asigna
cuota de Drive. Los destinos fijos se configuran solo como variables de Cloud
Run:

- `ANGELI_DRIVE_ROOT_FOLDER_ID`
- `ANGELI_DRIVE_IMAGES_FOLDER_ID`
- `ANGELI_DRIVE_FILES_FOLDER_ID`
- `ANGELI_DRIVE_INBOX_FOLDER_ID`
- `ANGELI_DRIVE_VOICE_FOLDER_ID`
- `ANGELI_DRIVE_DATA_FOLDER_ID`

Actualmente se usan imágenes y archivos; los demás quedan reservados para
funciones futuras. El límite por adjunto es 20 MB; Firestore guarda únicamente
metadatos y el ID de Drive.

## Desarrollo local y pruebas

Las pruebas no llaman a Vertex AI ni requieren credenciales:

```bash
cd backend && python3 -m unittest -v test_app.py
```

La variable `ANGELI_AI_DEV_BYPASS_AUTH=1` se usa solo dentro de estas pruebas
y queda ignorada si Cloud Run define `K_SERVICE`. Nunca debe configurarse en el
servicio desplegado.

Para una prueba local real contra Vertex AI se requiere autenticación ADC de
una cuenta con `roles/aiplatform.user`; se usa `gcloud auth application-default
login`, nunca un JSON de cuenta de servicio. En Cloud Run no se configura
`GOOGLE_APPLICATION_CREDENTIALS`.

Las pruebas reales contra Google están documentadas en
[`TEST_HARNESS.md`](TEST_HARNESS.md). Se ejecutan manualmente con una cuenta,
secretos y carpeta exclusivos de pruebas; nunca reutilizan las autorizaciones
ni los datos de producción.
