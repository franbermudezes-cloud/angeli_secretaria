# Visión de producto — Angeli Asistente

## Propósito

Angeli es una asistente móvil para capturar una orden natural por voz o texto, entenderla, consultar fuentes empresariales autorizadas cuando corresponda, mostrar una propuesta clara y completar la acción con el mínimo número de pasos seguros.

No es un formulario de notas con botones. El historial conserva lo ocurrido; la tarjeta emergente es el espacio donde se trabaja una acción hasta terminarla.

## Promesa de uso

Una persona debe poder decir una frase cotidiana como:

> «Llama a Miguel Ibiza mañana a las nueve de la noche»

y Angeli debe proponer el comportamiento correcto: no llamar ahora, sino preparar un recordatorio de llamada para el momento indicado. Si la orden es inmediata, entonces busca el contacto, muestra sus teléfonos y abre el marcador solo al elegir uno.

## Principios

1. **Lenguaje natural primero.** La IA interpreta; la aplicación valida y ejecuta una lista cerrada de acciones.
2. **Una acción, un flujo visible.** La tarjeta emergente no desaparece entre pasos ni obliga a buscar el resultado en el historial.
3. **Lo inmediato y lo futuro son distintos.** Una llamada ahora puede abrir el marcador; una llamada mañana debe programarse.
4. **Confirmación proporcional.** Crear, modificar, cancelar, llamar o enviar fuera de la aplicación requiere una confirmación clara antes del efecto externo.
5. **Historial no operativo.** La conversación deja constancia; no debe ser necesaria para completar una acción recién creada.
6. **Privacidad por defecto.** Solo se piden permisos de Google al ejecutar la función correspondiente; tokens y coincidencias permanecen temporales.
7. **Resiliencia.** Una caída de red, IA o Google nunca borra la entrada local ni sus medios.

## Límites actuales

- La PWA puede interpretar, almacenar y ejecutar acciones inmediatas.
- Los avisos fiables cuando la PWA está cerrada requieren una infraestructura programada; no se deben prometer con temporizadores del navegador.
- Google Contacts y Calendar siguen siendo acciones inmediatas por API directa. Los procesos diferidos se decidirán caso a caso, previsiblemente con n8n como planificador auxiliar.

## Conocimiento de empresa

Angeli debe poder responder preguntas de negocio como el estado de un cliente, un presupuesto, un proyecto o una acción de marketing. No debe descargar bases de datos completas al teléfono ni mezclar datos empresariales con la memoria local de la PWA. La solución será una capa de consulta autenticada y de solo lectura que conecte las fuentes autorizadas y entregue únicamente los resultados necesarios para cada pregunta. Cualquier modificación de datos empresariales será una fase posterior y siempre requerirá confirmación explícita.
