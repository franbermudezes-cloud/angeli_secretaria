# Backend de interpretación IA

Este servicio ofrece únicamente `POST /interpret`. No crea eventos, consulta
contactos, accede a Drive, escribe en Sheets ni almacena datos de Angeli.

## Producción en Cloud Run

Cloud Run debe usar una Service Account dedicada con el rol
`roles/aiplatform.user`. El SDK obtiene Application Default Credentials de la
identidad del servicio; no se usan API keys ni archivos JSON de cuentas de
servicio.

Variables necesarias:

- `GOOGLE_CLOUD_PROJECT`: proyecto de Google Cloud.
- `VERTEX_LOCATION`: `global` inicialmente.
- `GOOGLE_WEB_CLIENT_ID`: Client ID web ya usado por la PWA.
- `ALLOWED_GOOGLE_SUBS`: identificadores `sub` autorizados, separados por coma.
- `ALLOWED_ORIGINS`: orígenes exactos de GitHub Pages y de desarrollo local,
  separados por coma.

La PWA enviará un ID token de Google en `Authorization: Bearer <id-token>`.
El servicio verifica firma, audiencia, emisor, expiración y el `sub`, antes de
llamar a Vertex AI.

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
