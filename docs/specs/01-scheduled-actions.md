# Especificación 01 — Acciones programadas

## Problema que resuelve

La orden «Llama a Miguel Ibiza mañana a las nueve de la noche» no es una llamada inmediata. La intención principal es crear un recordatorio programado cuya acción futura es una llamada a Miguel Ibiza.

Hoy Angeli puede detectar el contacto, pero el ejecutor abre la llamada de inmediato y pierde el componente temporal. Este bloque corrige el modelo, no solo una frase concreta.

## Alcance inicial

- Recordatorios con fecha y hora.
- Llamadas futuras a un nombre o teléfono.
- Tareas futuras.
- Confirmación, programación, cancelación y estado visible.
- Aviso fiable cuando la PWA esté cerrada mediante una infraestructura programada aprobada.

No incluye todavía automatizar una llamada, enviar WhatsApp, descargar contactos completos ni un calendario nuevo.

## Comportamiento esperado

| Entrada | Propuesta | Acción al confirmar |
| --- | --- | --- |
| `Llama a Miguel Ibiza` | Buscar a Miguel Ibiza y llamar | Mostrar teléfonos; el toque final abre `tel:`. |
| `Llama a Miguel Ibiza mañana a las 21:00` | Recordatorio de llamada | Programar aviso para mañana a las 21:00. |
| `Recuérdame mañana llamar al banco` | Recordatorio de llamada | Programar aviso; no llamar ahora. |
| `Comprar pilas mañana` | Tarea programada | Guardar tarea con fecha; el aviso depende de la hora o regla elegida. |
| `Cancela el recordatorio de llamar al banco` | Buscar recordatorio y cancelar | Mostrar coincidencias y pedir confirmación. |

## Modelo de datos propuesto

Una entrada existente conserva `type`, fecha y medios. Cuando tenga una acción futura, añade un objeto ligero:

```json
{
  "schedule": {
    "dueAt": "2026-08-22T21:00:00+02:00",
    "timeZone": "Europe/Madrid",
    "action": {
      "kind": "contact.call",
      "contactName": "Miguel Ibiza",
      "phone": null
    },
    "status": "pending_confirmation",
    "delivery": "pending",
    "externalJobId": null,
    "lastError": null
  }
}
```

Estados permitidos: `draft`, `pending_confirmation`, `scheduled`, `due`, `completed`, `cancelled`, `error`.

`scheduledDate`, `scheduledTime` y `actionStatus` existentes se migrarán sin perder datos; `schedule` será la fuente detallada del comportamiento futuro.

## Interpretación y seguridad

La IA propondrá una intención cerrada, por ejemplo `reminder.create`, y una acción subordinada `contact.call`. La aplicación debe validar fecha, hora, zona horaria y tipo de acción. La IA no programa ni llama por sí sola.

Antes de confirmar, la tarjeta debe decir con claridad:

> Recordatorio: llamar a Miguel Ibiza mañana a las 21:00.

Después de confirmar, debe mostrar `✓ Programado` o un error recuperable. La tarjeta solo desaparece al completar, cancelar o cerrar conscientemente.

## Arquitectura a decidir antes de código

La PWA no puede garantizar por sí sola un aviso a una hora concreta si Android la cierra. Por eso se debe elegir la entrega real:

1. **Google Calendar:** crear un evento/recordatorio en el calendario de la cuenta elegida. Ventaja: aviso fiable de Google; limitación: mezcla recordatorios con agenda.
2. **n8n programado:** la PWA registra una tarea segura; n8n espera y dispara la entrega. Ventaja: flexible, reintentos y futuro multicanal; exige endpoint autenticado y una decisión de entrega.
3. **Notificaciones web/PWA:** útil solo como complemento cuando el navegador permite y mantiene el servicio; no será la única garantía.

La primera entrega usa **Google Calendar** como respaldo real: se crea un evento privado y transparente con aviso emergente a la hora indicada, y se conserva su ID para cancelarlo sin duplicados. La PWA mantiene el registro y la confirmación. n8n seguirá siendo la opción para una futura notificación propia de Angeli, reintentos multicanal y avisos fiables fuera de Calendar; antes de ello se definirá autenticación, sin URL secreta incrustada.

## Canal de aviso acordado

La entrega combinará una notificación Android como vía inmediata y un evento/aviso de Google Calendar como respaldo. Ambas vías representarán la misma acción programada mediante un identificador común, para impedir duplicados y estados contradictorios.

## Criterios de aceptación de V0.17

1. Una llamada sin fecha sigue buscando y llamando ahora.
2. Una llamada con fecha y hora nunca abre el marcador de inmediato.
3. La propuesta muestra nombre, fecha, hora y acción futura antes de programar.
4. Cancelar o fallar no borra la entrada ni sus medios.
5. Persistencia tras cerrar/reabrir la PWA.
6. Se puede cancelar una acción programada sin afectar entradas no relacionadas.
7. Cámara, fotos, archivos, dictado, Contacts, Calendar, Sheets, filtros y PWA siguen funcionando.
