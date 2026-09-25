# Changelog

## V0.24.2 · Privacidad: Calendar, Contactos y Drive son solo del propietario

- **Fallo grave de privacidad encontrado** al preparar el resumen del día: la conexión con Google Calendar, Contactos y Drive guarda **una sola autorización, la del propietario** (`angeli-google-*-grant`), sin distinguir quién pregunta. Una persona invitada habría leído y escrito en la agenda del propietario, buscado en sus contactos y subido archivos a su Drive, e incluso podría haber **sustituido su autorización** al pulsar «Conectar».
- **No llegó a pasar**: la lista de invitados está vacía y la lista heredada solo contiene el correo del propietario (comprobado en producción).
- **Arreglo en el servidor**: `/google`, `/oauth/exchange` y `/media/*` responden 403 a quien no sea el propietario, con un mensaje claro. `/session/status` ya no revela a un invitado el estado de las conexiones del propietario.
- **En la app**: una persona invitada no ve los botones de Calendar, Contactos ni Drive, y en su lugar lee que de momento son solo de la cuenta principal. Sus notas, recordatorios y listas siguen siendo solo suyos (Firestore, por `uid`).
- **Pendiente para que los invitados tengan su propia agenda**: autorizaciones de Google por persona.
- **Requiere redesplegar Cloud Run.**
- Tests: `backend/test_access_control.py` (3 nuevas), `tests/admin-audit.test.mjs`.

## V0.24.1 · Pregúntale por tus cosas

Angeli ya contesta preguntas sobre tu agenda y tus notas, no solo ejecuta órdenes:
- **«¿Cuándo es la cena con Vicente?»**, «¿A qué hora tengo el dentista?», «¿Tengo algo con Laura esta semana?»: la IA extrae el tema («Vicente», «dentista», «Laura») y la búsqueda en Calendar lo usa. Antes solo se buscaba por tema al cambiar o cancelar, y una pregunta así listaba un periodo entero.
- **Respuesta directa** arriba de la lista: «“Cena con Vicente” es el sábado 26 de septiembre a las 21:00, en Casa Pepe.», «Tienes 2 cosas: …», «No tienes nada en ese periodo.». En el **modo conversación** te la dice en voz alta y sigue escuchando.
- **Notas: «¿Qué me dijo Luis del presupuesto?»** encuentra la nota aunque las palabras no vayan seguidas («Luis me comentó que el presupuesto…»), sin inventar coincidencias.
- **Examen**: 11 preguntas nuevas (150 frases); la IA acierta las 11 y el total queda en 97 %. Los 4 fallos restantes los corrige la red local del móvil.
- **Requiere redesplegar Cloud Run** (el servidor conserva el tema de la pregunta).
- Tests: `tests/preguntas.test.mjs`, `test_interpreter_quality.py` (257 pruebas en el frontend).

## V0.24.0 · Un cerebro más listo, medido con un examen

- **Examen del intérprete** (`backend/eval/`): 140 frases genéricas, de las que diría cualquier persona (recordatorios, eventos, llamadas, WhatsApp, notas, tareas, consultas, cambios y cancelaciones). Se corre contra Gemini real con las mismas instrucciones y la misma validación que el servidor, y sirve para medir cada cambio futuro: `GCP_TOKEN=$(gcloud auth print-access-token) python3 eval/run_eval.py <modelo>`.
- **Resultados** (con el mismo prompt):

  | Modelo | Aciertos | Tiempo típico |
  |---|---|---|
  | 2.5 Flash-Lite (el anterior) | 87 % → 94 % con el prompt mejorado | 1,3 s |
  | **2.5 Flash sin razonamiento (el nuevo)** | **98 %** | 1,8 s |
  | 3 Flash *preview* | 98 % | 1,7 s (en pruebas, no estable) |
  | 2.5 Pro | lento (8 s) y respuestas cortadas | — |

- **Cambio de modelo**: el intérprete pasa a Gemini 2.5 Flash con el razonamiento desactivado. Razonar no mejoraba la nota y cortaba respuestas. La frase corta de reacción del modo conversación sigue en Flash-Lite, que es más rápido.
- **Fallo grave encontrado por el examen**: al preguntar «¿Qué tengo mañana?» la IA solía devolver solo el día, sin periodo, y **la búsqueda iba de hoy a 90 días**. Ahora se corrige en dos capas:
  - el servidor convierte un día suelto en un periodo de un día;
  - el móvil calcula el periodo que dices («pasado mañana», «el fin de semana», «la semana que viene») y manda, que es exacto. La IA también confundía aquí «pasado mañana» con «mañana».
- **Prompt más claro** sobre:
  - periodos en las consultas;
  - «en una semana» son 7 días;
  - una frase que describe algo futuro es crear, no modificar;
  - «toma nota» siempre es una nota;
  - un WhatsApp que ya trae el mensaje no se pregunta.
- **Requiere redesplegar Cloud Run.**
- Tests: `test_interpreter_quality.py` y `tests/ai-authority.test.mjs` ampliados (253 pruebas en el frontend).

## V0.23.11 · La lógica local vuelve a proteger donde la IA se equivocaba

Revisión pedida por el propietario, preocupado por si se había quitado la lógica local para dejar solo la IA (que históricamente daba muchos errores). **La lógica local no se quitó**, pero el historial mostró un caso reabierto por la 3ª auditoría, y se corrige:
- **«Pasado mañana» vuelve a mandar aunque la IA diga «mañana»** (arreglo #6 del 26/08). En recordatorios, la fecha DICHA vuelve a mandar sobre la de la IA, porque calcularla en el móvil es exacto. Se mantiene la mejora de la auditoría: cuenta el PRIMER día que se dice («Recuérdame el viernes comprar el pan para mañana» sigue siendo el viernes). La IA solo decide cuando la frase no dice ningún día.
- **Al mover un evento, el día y la hora nuevos los vuelve a calcular el móvil**, ahora leyéndolos detrás de «al / para / hasta / a las» («la cena del viernes al sábado» → sábado aunque la IA se equivoque). Única excepción: si dijiste la hora sin franja («la cena a las nueve») y la IA coincide en la hora, decide la IA si es de mañana o de tarde (21:00), porque sabe que es una cena. Si dijiste la franja, manda lo dicho.
- **Un WhatsApp que espera el mensaje** toma lo que digas como mensaje aunque parezca otra cosa (arreglo #120). Los disparadores explícitos («Recuérdame…», «Llama a…») siguen soltándolo.
- **Las preguntas con «?» sobre recordatorios o notas** vuelven a reconocerse como consulta (arreglo #39).
- **Tests**: los casos del historial se prueban ahora como llegan de verdad, marcados como respuesta de la IA. Los antiguos no lo hacían, y por eso el #6 se reabrió sin que fallara nada (252 pruebas).

## V0.23.10 · Multiusuario más robusto (3ª auditoría, lote 6)

- **Una persona invitada ya no pierde la sesión por un fallo de red**: abrir la app sin conexión o un arranque lento del servidor cerraban su sesión y tenía que volver a entrar. Ahora solo un «no» explícito del servidor la cierra; los datos siguen protegidos por las reglas de Firestore y la IA se vuelve a comprobar en cada petición.
- **El panel de administración ya no se reabre solo**: cada vez que un invitado usaba la IA (su contador cambiaba), el panel saltaba encima de lo que hubiera en pantalla y tiraba el menú de opciones o el tope a medio escribir. Ahora solo se actualiza si está a la vista, deja de escuchar al cerrarlo tocando fuera, y cada acción vuelve a la lista.
- **Invitar a alguien que ya está** avisa en vez de reactivarlo o pasarlo a prueba en silencio.
- **Un tope vacío se muestra como 40**, igual que lo cuenta el servidor (antes mostraba 0).
- **Nombres con «&»** ya no aparecen como «&amp;amp;».
- **Reglas de Firestore**: la colección de invitaciones exige además el correo verificado.
- Requiere publicar `firestore.rules` (junto con el despliegue pendiente del lote 2).
- Tests: `tests/admin-audit.test.mjs` (248 pruebas).

## V0.23.9 · Dictado y accesos directos sin sorpresas (3ª auditoría, lote 5)

Regresiones de mis propios cambios recientes (V0.23.1–0.23.4), halladas ejecutando el `start()` real contra un reconocedor simulado:
- **El micro del móvil ya no se reinicia para siempre**: tras ~1 minuto en silencio se para (antes pitaba cada pocos segundos indefinidamente), y sin conexión avisa en vez de entrar en bucle.
- **Sin duplicados**: cada frase se suma una vez al cerrarse su tramo («hola hola» si el motor repetía el final).
- **Parar y volver a tocar el micro rápido** ya no apaga el dictado nuevo.
- **Tras Enviar, el texto enviado ya no reaparece** en el cuadro ni en la pregunta siguiente; y Enviar para el micro también si algo falla.
- **Escribir a mano en el borrador para el dictado**, en lugar de que el siguiente tramo borre lo escrito.
- **iPad** se trata como móvil (antes usaba el modo que duplicaba palabras).
- **Accesos directos**:
  - **«🛒 Añadir a la compra» añade a la lista**; antes acababa guardado como nota.
  - **«📞 Llamar»**: «Llama a» a secas pregunta a quién (antes buscaba el contacto «a»); «al móvil» se quita del nombre; un número se trata como teléfono; «Llama a Ana mañana a las 10» se convierte en aviso (antes llamaba ya).
  - **«✕ Cancelar evento»**: «Cancela» a secas pregunta qué evento (antes buscaba «Cancela»).
  - **Voz primero**: Recordatorio, Nuevo evento, Nota… empiezan escuchando. Desde V0.23.2 se abrían sin teclado ni micro; el teclado sigue a un toque (⌨️).
  - **Su pregunta de seguimiento** ya no dice «Necesito asegurarme».
- Tests: `tests/shortcuts-audit.test.mjs`, `tests/dictation.test.mjs` ampliado (237+ pruebas).

## V0.23.8 · Conversación a varios turnos que se entiende (3ª auditoría, lote 4)

- **«Sí / vale / no» funcionan de verdad**: antes la rama de confirmación nunca se alcanzaba y un «sí» se guardaba como nota nueva; y «Sí» con tilde no se reconocía. Ahora un «sí/no» suelto responde a la confirmación pendiente de los últimos 15 minutos. «Sí» abre la confirmación para pulsarla (una acción sensible nunca se ejecuta solo por voz). Ya no hay falsos positivos: «si puedes, recuérdame…», «no te olvides de…» o «No sé» no cuentan como sí/no, y «sí, pero a las 11» pasa como corrección.
- **Cancelar por voz**: «cancela», «déjalo», «olvídalo», «no importa»… sueltan la pregunta pendiente. Antes se tomaban como el dato y la pregunta se repetía para siempre.
- **Una orden nueva es una entrada nueva**: si la IA dice, con confianza, que la frase es de otro tipo que lo pendiente, ya no se funde con ello. Se acabó que un recordatorio nuevo heredara «Llamar a Pepe» o que una cita con el dentista acabara siendo el mensaje de un WhatsApp a Juan. La operación abandonada se cancela en vez de quedarse esperando.
- **Responder no borra lo ya dicho**: «Recuérdame comprar pan» → «mañana» → «a las diez» termina en *Comprar pan, mañana a las 10:00*. Antes terminaba con el título «a las diez», hoy y en el pasado.
- **Nunca se pregunta lo que ya está**: tras decir el día, pregunta solo la hora. Un aviso o evento completo siempre queda pendiente de confirmar.
- **Modo conversación**:
  - Vuelve a ser manos libres tras una pregunta: tu respuesta en voz alta va a esa pregunta y el resultado se lee.
  - La frase de relleno ya no corta la respuesta real.
  - Se acabaron el bucle de error/reinicio sin conexión y el pitido cada pocos segundos en silencio.
  - Solo recoge preguntas pendientes recientes (30 min), la más reciente.
- Sin cambios en el backend (sí recargar la PWA).
- Tests: `tests/conversation-audit.test.mjs` con el diálogo completo (237 pruebas).

## V0.23.7 · Fechas y horas como se dicen de verdad (3ª auditoría, lote 3)

El parser local de fechas y horas se reescribió de forma legible. Además de servir cuando la IA falla o se agota el cupo, **completa** las respuestas de la IA, así que sus errores se notaban siempre. Sobre la batería del agente: **29 casos arreglados, 0 rotos**.
- **Minutos y franja con cifras**, que es como escribe el dictado: «a las 8 y media de la tarde» → 20:30 (antes 08:00), «a las 9 y media de la noche» → 21:30, «a las 12 y media», «a las nueve y veinte», «a las 9.30», «a las 9 pm».
- **Formas que no se entendían**: «a la una», «sobre las 9», «hacia las 5 de la tarde», «a mediodía», «de la madrugada», «el día 20» (ya pasado → mes que viene), «el 30», «en una semana», «del año que viene».
- **AM/PM respetando el día dicho**: «Recuérdame mañana a las 8» ya no sale a las 20:00; «mañana por la mañana a las 9» → 09:00; «cena mañana a las 5» → 17:00.
- **Días**: «este viernes» dicho un viernes es hoy; «esta mañana» es hoy (no mañana); si se dicen dos días, gana el primero («Recuérdame el viernes comprar el pan para mañana» → viernes); «hoy a las 12 de la noche» → día siguiente a las 00:00.
- **Sin tildes**: «manana», «el sabado», «pasado manana».
- **Títulos y búsquedas limpios**: adiós a «Dentista pasado», «Cena con Luis el próximo», búsquedas por «que viene» o «Ana de la».
- **Agenda**: «el fin de semana» y «el mes que viene» tienen su periodo (antes 90 días), también desde el acceso directo, que ya no pasa por la IA.
- **Recordatorio de hoy ya pasado**: «Recuérdame hoy a las 8» dicho a las 10 pasa a las 20:00 en vez de quedarse en el pasado.
- **Búsqueda de eventos** sin fecha: empieza en la fecha local (entre las 00:00 y las 02:00 empezaba ayer).
- Sin cambios en el backend (sí recargar la PWA).
- Tests: `tests/temporal-audit.test.mjs` (230 pruebas; también en UTC como el CI).

## V0.23.6 · Un cerebro más fino: el servidor de IA entiende mejor y no desperdicia respuestas (3ª auditoría, lote 2)

- **Temperatura 0**: Gemini usaba la configuración más aleatoria (1.0); la misma frase podía entenderse distinto cada vez. Ahora responde de forma estable.
- **Hora local, día de la semana y calendario de 15 días** en cada petición: antes recibía la hora en UTC y sin día de la semana, y tenía que calcular «el jueves», «el lunes que viene» o «en media hora» por su cuenta (y entre las 00:00 y las 02:00 se equivocaba de día).
- **Ya no se obliga a inventar una hora**: el esquema exigía una hora en cancelar, modificar y «ya he llamado a…». Con la hora vacía se rechazaba la respuesta entera y se caía a reglas locales («He comprado el pan» acababa como nota nueva).
- **Validación que corrige en vez de tirar todo**: «9:00» → «09:00», «¿Qué tengo hoy?» con inicio = fin, cambios vacíos, un campo pendiente desconocido, un aviso vinculado mal formado o una categoría escrita con su nombre («Empresa») ya no provocan un 503.
- **Reglas nuevas en el prompt**: hora de cenas/fiestas por la tarde y de citas en horario laboral («cena a las nueve» = 21:00), «a las doce» = mediodía, tareas con `task.create`, fechas pasadas → año siguiente al crear, expresiones relativas («en media hora»), y que **faltar un dato no es ambigüedad** (antes la IA bajaba la confianza en «WhatsApp a Pepe» y el móvil descartaba su respuesta correcta).
- **Los ajustes de notas ya no se presentan como «operación pendiente»**, que empujaba cualquier orden nueva hacia continuar lo anterior; y con algo pendiente, una orden completa de otro tipo («¿qué tengo mañana?») se reconoce como nueva.
- **Consultas con periodo**: «¿Qué apunté ayer?» y «¿Qué recordatorios tengo esta semana?» conservan su intervalo (antes mostraban todo).
- **Cupo de invitados justo**: solo se cobra una interpretación que salió bien. Antes cobraban los errores, cada búsqueda en Mercadona (que ni usa IA) y la frase de reacción del modo conversación; un invitado podía agotar su mes en una sola compra.
- **Más margen**: peticiones hasta 8 KB (un dictado largo con dos respuestas de seguimiento no cabía) y respuestas hasta 800 tokens.
- **CI**: 8 suites de pruebas del frontend y 2 del backend (incluida la de multiusuario) existían pero ninguna puerta las ejecutaba. Ahora se ejecutan todas.
- **Requiere redesplegar el servicio de Cloud Run** para que el servidor use estos cambios.
- Tests: `backend/test_interpreter_quality.py` (16 pruebas nuevas).

## V0.23.5 · La IA manda: las reglas locales ya no pisan sus respuestas correctas (3ª auditoría, lote 1)

- **El problema de fondo** de que la IA «no acabe de estar fina»: Gemini entendía bien, pero después una regla local sustituía su respuesta por otra peor. En una batería de 52 órdenes, 30 respuestas correctas de la IA terminaban mal. Principio nuevo: si la IA respondió con confianza, lo local solo rellena huecos.
- **Recordatorios, tareas y notas ya no se convierten en «modificar evento»**: «Recuérdame pasar por el banco mañana», «Tengo que pasar la ITV el jueves», «Mañana a las diez pasa el técnico»… Ahora solo cuenta un verbo de cambio al principio de la frase o detrás del evento nombrado.
- **Al mover un evento, la fecha y hora nuevas de la IA mandan**: «la cena del viernes al sábado» ya no se queda el viernes, y «a las 9 y media de la noche» ya no se queda en 09:00.
- **Recordatorios: la fecha de la IA manda** sobre un «hoy/mañana» del contenido («Recuérdame el viernes comprar el pan para mañana» ya no cae mañana).
- **Crear ya no se confunde con consultar**: «Quiero que me pongas un recordatorio…» crea el recordatorio (antes buscaba tus recordatorios y no creaba nada); «Dile a Ana que me pase las notas» ya no busca notas.
- **Llamadas**: una nota que menciona llamar («Apunta que tengo que llamar al fontanero») o una llamada con hora («Llama a Ana esta noche») ya no se lanza como llamada inmediata; el nombre se corta limpio («Ana», no «Ana para preguntarle por el presupuesto»), y el nombre de la IA manda.
- **WhatsApp**: responder a un WhatsApp pendiente con la IA caída o sin cupo ya no revienta con «Campo IA no permitido»; el texto de un WhatsApp («dile que me pasa a buscar mañana a las 8») ya no se lee como modificar un evento; un WhatsApp pendiente ya no convierte una orden nueva en su mensaje cuando la IA dice que es otra cosa; y el respaldo local separa contacto y mensaje también sin «dile» («a Ana que llego tarde»), con «envíale/mándale» y con número.
- **Hora a la IA**: se envía la hora local con su desfase en lugar de UTC (entre las 00:00 y las 02:00 «hoy/mañana» caían un día antes).
- Sin cambios en el backend; no requiere redespliegue (sí recargar la PWA).
- Tests: `tests/ai-authority.test.mjs` con los casos reales de la auditoría (220 pruebas).

## V0.23.4 · Los accesos directos de llamar y agenda son instantáneos (sin esperar a la IA)

- **Antes**: cualquier acceso directo — incluso "📞 Llamar contacto" o "🗓️ Hoy" — pasaba por la IA del servidor antes de hacer nada, aunque ya supiéramos exactamente qué hacer. Eso añadía una espera innecesaria.
- **Ahora**: los accesos marcados como directos resuelven la acción **en el propio móvil, al instante**, sin llamar a la IA:
  - **📞 Llamar a [nombre]**: extrae el nombre del texto y va directo a buscar el contacto.
  - **🗓️ Hoy / Próxima semana / Mañana / Esta semana**: calcula el rango y consulta la agenda directamente.
  - **✕ Cancelar evento**: prepara la búsqueda del evento sin rodeo por la IA.
- **WhatsApp se queda a propósito con IA**: separar *a quién* de *qué mensaje* sin un marcador claro ("dile…", "diciéndole…") no es fiable en local ("a Ana que llego tarde" haría que el contacto fuera "Ana que llego tarde" y no se encontrara). La IA lo separa bien, así que ese sigue pasando por ella.
- **Nuevo evento y Recordatorio** también siguen con IA: ahí sí hace falta para entender fechas, horas, lugar y título de lo que dictas.
- **Verificado** sobre los módulos reales: llamar extrae "Pedro" de "Llama a Pedro", la consulta de agenda calcula su rango, y todo sin tocar la IA; WhatsApp mantiene su ruta con IA.
- Sin cambios en el backend; no requiere redespliegue (sí recargar la PWA del móvil).
- Tests: 2 pruebas nuevas en `tests/shortcuts.test.mjs` (209 en total).

## V0.23.3 · El dictado en el móvil ya no repite palabras (de verdad esta vez)

- **Antes**: en el móvil (Chrome de Android) dictar cualquier instrucción repetía palabras sin parar ("programa una visita programa una visita programa una visita…"). El propietario confirmó un dato clave: **antes no pasaba**, hasta que se cambió el dictado a `continuous:true` (que se puso para que el micro del **ordenador** no se cortara tras la primera frase).
- **Causa real**: `continuous:true` en Android está roto — encadena cada fragmento que va creciendo como resultados separados, y cualquier acumulación los multiplica. El intento anterior (V0.23.1, reconstruir desde la lista) no lo curó porque la raíz es el propio modo `continuous`.
- **Ahora**, según la plataforma:
  - **Ordenador**: sigue en `continuous:true` (una sola sesión, segmentos distintos que se concatenan). Igual de bien que hasta ahora.
  - **Móvil**: vuelve a `continuous:false` (el modo con el que **antes funcionaba**), tomando el último resultado de cada enunciado (nunca la suma) y **reiniciando el reconocedor** al terminar cada frase — así se mantiene la escucha del dictado largo sin cortarse, que era justo el motivo por el que se había puesto `continuous`.
- **Verificado en el navegador sandbox sobre el `start()` real**, emulando el user-agent de Android: se reproduce el encadenamiento de fragmentos y el texto queda limpio ("programa una visita para el día 20"), el reconocedor se reinicia para seguir escuchando, al parar no se reinicia, y en escritorio sigue concatenando bien sin reiniciar.
- Sin cambios en el backend; no requiere redespliegue (sí recargar la PWA del móvil).
- Tests: `tests/dictation.test.mjs` actualizado al enfoque por plataforma.

## V0.23.2 · El teclado ya no salta solo al abrir el modal de voz (móvil)

- **Antes**: al tocar el micrófono principal, se abría el modal "Te escucho" y **el teclado del móvil salía solo**, tapando los botones. Había que esconderlo a mano cada vez antes de poder hablar. Igual en el modal de pregunta del modo conversación.
- **Ahora**: esos modales son de **voz primero**: al abrirse **no** enfocan el cuadro, así que el teclado no aparece y los botones quedan a la vista. Se añade un botón **⌨️ Teclado** para sacarlo a demanda, y tocar el cuadro también lo abre, como siempre.
- **Se respeta el teclado donde hace falta**: si abres el borrador tocando el cuadro de texto del compositor (querías escribir), sí se enfoca y el teclado se mantiene. Los editores de campo (título/ubicación/descripción de Calendar, mensaje de WhatsApp, fecha/hora) y los cuadros de "escribe un nombre" (lista de la compra, invitar) siguen abriendo el teclado al entrar, porque ahí vas justo a escribir. El buscador de la lista de la compra no cambia.
- **Verificado en el navegador sandbox sobre el DOM real**: el modal de voz abre sin foco (sin teclado), el botón ⌨️ lo enfoca a demanda, y el flujo de "toqué para escribir" mantiene el teclado.
- Sin cambios en el backend; no requiere redespliegue (sí recargar la PWA del móvil).
- Tests: `tests/conversation.test.mjs` y `tests/conversation-mode.test.mjs` actualizados al nuevo comportamiento de voz primero.

## V0.23.1 · El dictado en el móvil ya no repite palabras "como si hubiera cincuenta micros"

- **Antes**: en el móvil (Chrome de Android) dar cualquier instrucción por voz repetía palabras y texto sin parar. En el ordenador iba bien.
- **Causa**: el dictado sumaba el texto reconocido confiando en que `e.resultIndex` avanzara para no releer lo ya dicho. En el ordenador avanza; en Android suele quedarse en 0 y reenvía toda la lista en cada evento, así que lo ya dicho se volvía a sumar una y otra vez.
- **Ahora**: en cada evento se reconstruye el texto entero desde la lista completa de resultados y se **asigna** (no se suma) — es idempotente, dé igual cuántas veces reenvíe Android. El ordenador sigue igual de bien.
- **Verificado en el navegador sandbox** simulando el reenvío de Android sobre el código real (`start()`): el texto queda limpio, y seguir dictando sobre texto ya escrito lo respeta.
- Sin cambios en el backend; no requiere redespliegue (pero sí recargar la PWA del móvil para tomar la versión nueva).
- Tests: `tests/dictation.test.mjs` ampliado con la regresión de Android.

## V0.23.0 · Multiusuario por invitación con panel de administrador y cupo de IA

Angeli deja de ser de un solo usuario: ahora el propietario puede invitar a gente de confianza, controlar cuánta IA gasta cada uno y cortarla cuando quiera, sin tocar el servidor.

- **Acceso por invitación (Opción A)**: solo entra quien el propietario da de alta. Cualquier otra cuenta identificada se cierra sesión con un mensaje claro ("pide el alta"), en vez de un error de sesión. El propietario entra directo, sin consultar al servidor.
- **Aislamiento intacto**: cada persona sigue teniendo su propio espacio bajo `users/{uid}` (reglas de Firestore por uid). Lo del propietario nunca se mezcla con lo de nadie.
- **Cupo mensual de IA ("el grifo")**: cada interacción de IA (interpretar, buscar en Mercadona, chat) cuenta contra un tope mensual por persona (40 por defecto). Al agotarse, el servidor responde `quota_exhausted` y la app avisa; sigue funcionando en modo básico local.
- **Panel de administrador** (solo lo ve el propietario, en Ajustes): lista de personas con su gasto del mes, e invitar por correo, abrir el grifo (sin límite), poner en prueba con tope, cambiar el tope, cortar/reactivar y quitar. Todo en vivo.
- **Backend**: la lista de invitados se traslada de la variable `ALLOWED_FIREBASE_EMAILS` (que exigía redesplegar) a Firestore (colección `access`, un documento por correo), administrable desde la app. El propietario y la lista heredada siguen entrando siempre y sin contar. Nuevo endpoint `/access/status`; `verify_identity` se separa en autenticar (quién eres) y autorizar (si tienes acceso).
- **Reglas de Firestore**: nueva colección `access`, legible/escribible solo por el propietario; el servidor la consulta y anota el gasto con el SDK de administración.
- **Verificado en el navegador sandbox**: el panel renderiza los tres estados (prueba/grifo abierto/cortado) y todos los mandos disparan su acción; validación de correo al invitar.
- **Tests**: backend `test_access_control.py` (15 pruebas nuevas), frontend `tests/admin-access.test.mjs` y `tests/firebase-auth.test.mjs` reescrito para el nuevo candado. 207 pruebas de frontend, 95 de backend (sin contar las de Vertex, que necesitan el módulo `google`).
- **Requiere despliegue**: redesplegar el servicio de Cloud Run (backend) y publicar `firestore.rules`. Pendiente además, en el panel de Google Cloud: dar de alta a cada invitado en la pantalla de consentimiento OAuth (modo prueba) para que Google les deje entrar.
- **Pendiente (fase 2, no incluido)**: "trae tu propia IA" (que un invitado pegue su clave de Gemini en Ajustes cuando se le agote el cupo).

## V0.22.36 · Cancelar un evento encontrado en Calendar usa el modal propio, no el cuadro del navegador (2ª auditoría, usabilidad)

- **Antes**: al anular un evento encontrado por búsqueda en Calendar, la confirmación era el `confirm()` nativo del navegador — el último que quedaba en un flujo de gestión.
- **Ahora**: confirma con el modal propio de Angeli (distinguiendo si el evento lleva un aviso vinculado). Con esto ya no queda ningún diálogo nativo en los flujos de gestión de la app.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/conversation.test.mjs`.

## V0.22.35 · La ficha del Dietario siempre deja eliminar, incluso si el evento falló al sincronizar (2ª auditoría, usabilidad)

- **Antes**: abrir desde el Dietario un evento/aviso que falló al sincronizar (o que seguía pendiente) mostraba solo "Cerrar" — la única forma de quitarlo era adivinar que el "⋮" de la fila lo permitía.
- **Ahora**: la ficha ofrece siempre "🗑️ Eliminar" (con confirmación), así ninguna entrada queda en un callejón sin salida.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/dietario.test.mjs` ampliado.

## V0.22.34 · Editar una nota: elegir un tipo de relación sin nombre ya no lo descarta en silencio (2ª auditoría, usabilidad)

- **Antes**: en el editor de notas, si elegías un tipo de relación (Persona, Cliente…) pero dejabas el nombre en blanco, la relación se descartaba en silencio al guardar, sin ningún aviso.
- **Ahora**: se pide el nombre cuando hay un tipo de relación elegido (o elegir "Sin relación") — igual que ya hace el editor de adjuntos.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/note-library.test.mjs` ampliado.

## V0.22.33 · Confirmar un evento o aviso ya no muestra un muro de botones (2ª auditoría, usabilidad)

- **Antes**: la pantalla de "¿Lo añado al calendario?" (y las de aviso y evento+aviso) mostraba 5-6 botones "Cambiar X" antes de poder confirmar, aunque lo dictado estuviera perfecto.
- **Ahora**: esos cambios se agrupan tras un solo "✎ Corregir un dato" que abre un submenú con las mismas opciones (y un "Volver"). La confirmación en sí se mantiene, porque crear el evento escribe en Google Calendar y conviene revisarlo. Para un evento bien dictado, la pantalla queda en 3 botones: Cancelar · Corregir · Añadir.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/conversation.test.mjs` actualizado + 1 prueba nueva.

## V0.22.32 · El buscador de la compra se ajusta a la tienda y se limpia al cambiar de lista (2ª auditoría, detalle)

- **Antes**: el buscador ponía siempre "Buscar o añadir un artículo…", aunque en una lista que no es de Mercadona no hay búsqueda en vivo; y al cambiar de lista conservaba lo escrito en la anterior.
- **Ahora**: el placeholder dice "Añadir un artículo…" en listas sin catálogo (y "Buscar o añadir…" solo en Mercadona), y el buscador se limpia al cambiar de lista.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.31 · Los ajustes de notas (categorías y relaciones) usan el modal propio, no cuadros del navegador (2ª auditoría, usabilidad)

- **Antes**: crear, renombrar o borrar categorías y tipos de relación en los ajustes de notas usaba los `prompt()`/`confirm()` nativos del navegador, dentro de una pantalla por lo demás con el estilo propio de la app.
- **Ahora**: usan el modal propio de Angeli (con dos helpers nuevos reutilizables, `showTextPrompt` y `showConfirm`), en línea con el resto de la app.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/note-library.test.mjs` ampliado.

## V0.22.30 · Crear un acceso directo usa el modal propio, también al dictarlo (2ª auditoría, usabilidad)

- **Antes**: crear un acceso directo personalizado usaba dos `prompt()` nativos seguidos — incluso desde "🎙️ Dictar acceso", que en una app de voz obligaba a teclear el nombre en un cuadro feo justo después de dictar la orden.
- **Ahora**: un modal propio recoge la orden y el nombre en una sola pantalla; la orden dictada llega precargada y el nombre se rellena solo a partir de ella (editable), así que dictar y pulsar "Crear" basta.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shortcuts.test.mjs`.

## V0.22.29 · Cancelar un evento/aviso desde el Dietario usa el modal propio y avisa si falla (2ª auditoría, usabilidad)

- **Antes**: cancelar desde el Dietario usaba el `confirm()` nativo del navegador (feo e inconsistente con el resto de la app), y si la cancelación fallaba (p. ej. token caducado) volvía a la ficha como si nada, con solo un aviso fugaz.
- **Ahora**: confirma con el modal propio de Angeli, y solo da por hecha la cancelación si de verdad salió bien; si falla, avisa claramente de que el evento/aviso sigue activo.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/dietario.test.mjs` ampliado.

## V0.22.28 · Crear una lista: Mercadona sale marcada por defecto y "Volver" ya no pierde el nombre (2ª auditoría, usabilidad)

- **Antes**: al crear una lista salían 7 tiendas sin ninguna marcada por defecto (aunque el código ya usa Mercadona), y "Cancelar" en ese paso perdía el nombre ya escrito sin forma de volver atrás.
- **Ahora**: Mercadona aparece marcada (✓, resaltada) como opción por defecto de un toque, y el botón "Volver" reabre el paso del nombre con lo ya escrito en vez de perderlo.
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.27 · Añadir por voz a una lista que no es de Mercadona ya no lanza una búsqueda inútil (2ª auditoría, regresión)

- **Antes**: al introducir "tienda por lista" (V0.22.13) se gateó la búsqueda de Mercadona al escribir en el buscador, pero no al dictar/ordenar por voz — añadir por voz a una lista de Leroy Merlin/Carrefour abría igualmente el modal de búsqueda de Mercadona, que nunca podía encontrar nada.
- **Ahora**: el comando de voz consulta la tienda real de la lista de destino; solo las listas de Mercadona abren el modal de búsqueda, el resto añaden el artículo directamente.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.26 · "Quitar comprados" ya no borra sin avisar, y lo marcado deja de llamarse "comprado" (2ª auditoría, usabilidad)

- **Antes**: marcar un artículo en la lista significa "lo quiero esta vez" (para el carrito), pero la interfaz seguía llamándolos "comprados" y el botón "Quitar comprados" los borraba **permanentemente sin confirmación** — era fácil marcar leche y pan para el carrito y perderlos de golpe.
- **Ahora**: "Quitar marcados" pide confirmación antes de borrar (con un recordatorio de que, si solo querías pasarlos al carrito, uses "🛒 Añadir al carrito"). Y toda la interfaz de la lista deja de llamar "comprado" a lo marcado (cabecera "Marcados", subtítulo "N marcados", el check dice "lo quiero esta vez").
- **Verificado en el navegador sandbox**.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.25 · Dictar una nota corriente ya no obliga a teclear un título a mano (2ª auditoría, usabilidad)

- **Antes**: casi cualquier nota corta dictada ("apunta comprar leche mañana") quedaba bloqueada en la pantalla "Completar nota" exigiendo escribir un título a mano — mismo tipo de bloqueo que el "¿para qué guardas la foto?" (V0.22.24).
- **Ahora**: el título deja de ser obligatorio; con contenido, la nota se guarda tal cual y usa el propio texto como título (igual que ya hacía en las listas, el Dietario y la biblioteca). Solo se sigue exigiendo el contenido — una nota sin nada escrito no tiene nada que guardar.
- **Verificado en el navegador sandbox**: una nota dictada corriente ahora va directa a "¿Guardo esta nota?" en vez de bloquearse.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/conversation.test.mjs` ampliado/actualizado.

## V0.22.24 · Subir una foto o archivo ya no obliga a explicar para qué se guarda

- **Antes**: en cuanto se seleccionaba una foto o un archivo, se abría "Organizar adjunto" y quedaba bloqueado del todo hasta escribir "¿para qué lo guardas?" — no había forma de saltarlo ni de subirlo tal cual.
- **Ahora**: ese campo es opcional. Con la categoría y la relación ya puestas por defecto, "Continuar" funciona con un solo toque si solo se quiere adjuntar la foto sin más explicación. Solo se sigue pidiendo el nombre si se elige explícitamente un tipo de relación (persona/cliente/proyecto) — dejarlo en blanco ahí sí sería un dato sin sentido.
- Verificado en el navegador sandbox simulando la selección real de un archivo: antes del cambio, "Continuar" quedaba bloqueado; después, funciona directamente.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/media-context.test.mjs` ampliado.

## V0.22.23 · El estado del micrófono del compositor ya no es una variable global suelta (auditoría, calidad de código)

- **Antes**: si el micrófono del compositor estaba escuchando vivía como una variable global (`listening`) tocada directamente desde cinco sitios distintos — la misma clase de fallo que ya causó el bug de "micrófonos huérfanos" (V0.21.95, V0.22.5).
- **Ahora**: se agrupa en `dictationMic`, un objeto con dos métodos explícitos (`isActive()`/`set(valor)`), sin cambiar ningún comportamiento.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/dictation.test.mjs` ampliado.

## V0.22.22 · Los formularios de editar recordatorio y evento ya comparten su construcción (auditoría, calidad de código)

- **Antes**: `showReminderEditor` y `showCalendarEventEditor` (`js/ui.js`) eran casi el mismo formulario (título/fecha/hora/ubicación/descripción) copiado dos veces con ids de campo distintos.
- **Ahora**: `buildRecordEditorForm(idPrefix)` construye el formulario una sola vez; cada editor conserva sus propios valores iniciales, su propia validación (el recordatorio exige fecha y hora; el evento no) y su propio nombre de campo en el resultado (`description` vs `notes`). Sin cambios de comportamiento.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/record-editor.test.mjs` (nuevo).

## V0.22.21 · Palabras clave de "recordatorio" centralizadas, ya no duplicadas en tres archivos (auditoría, calidad de código)

- **Antes**: el disparador de "esto habla de un recordatorio" vivía repetido en `js/ai.js` (4 copias, algunas escritas de formas distintas), `js/classifier.js` y `js/shortcuts.js` — ya había causado una regresión real (el guard de "recuérdame" tuvo que parchearse por separado en dos funciones porque cada una tenía su propia copia pegada).
- **Ahora**: `js/keywords.js` centraliza las tres variantes (`REMINDER_TRIGGER`, `REMINDER_CLASSIFY_TRIGGER`, `REMINDER_SHORTCUT_TRIGGER`) con la relación entre ellas documentada. Ningún comportamiento cambia — cada constante conserva exactamente las mismas palabras que tenía en su sitio original.
- De paso, se corrige un texto con caracteres mal codificados (`é` literal en vez de "é") en dos comentarios de `js/ai.js`, sin ningún efecto en el comportamiento.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/keywords.test.mjs` (nuevo, 7 pruebas).

## V0.22.20 · Crear/renombrar/borrar/vaciar una lista de la compra ya usa el modal propio de la app (auditoría, fricción)

- **Antes**: crear o renombrar una lista pedía el nombre con el `prompt()` del navegador, y borrarla o vaciarla confirmaba con `confirm()` — los últimos cuadros feos que quedaban, a diferencia del resto de la app.
- **Ahora**: las cuatro acciones usan el modal propio de Angeli, con el mismo estilo que el resto de confirmaciones (borrar/vaciar dicen cuántos artículos se van a perder).
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.19 · Bajar la cantidad a 0 en la compra ya quita el artículo directamente (auditoría, fricción)

- **Antes**: bajar la cantidad de un artículo (en la lista o en el carrito) se quedaba clavada en 1 — había que buscar la ✕ aparte para quitarlo del todo.
- **Ahora**: bajar de 1 quita el artículo directamente, igual que en cualquier carrito normal.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.18 · Añadir un artículo exacto a la compra ya no pide confirmar si no hay ninguna ambigüedad (auditoría, fricción)

- **Antes**: añadir un artículo a la lista siempre abría el modal de confirmación y esperaba a la búsqueda en Mercadona antes de mostrar nada, aunque solo hubiera un resultado — un toque de más ("Usar este") cuando no había nada que elegir.
- **Ahora**: se busca primero; si hay un único resultado, se añade directamente sin abrir ningún modal. El modal solo aparece cuando de verdad hace falta elegir (varios resultados) o no se ha encontrado nada (para escribirlo a mano) — y en ese caso ya aparece con los resultados listos, sin un segundo "buscando" de más.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.17 · "Historial de compras" ya es un acceso directo, junto a "Ver carrito" (auditoría, fricción)

- **Antes**: para ver el historial de compras de una lista había que abrir el "⋮" primero.
- **Ahora**: "🧾 Historial" aparece como acceso directo en la misma fila que "Quitar comprados"/"Vaciar lista"/"Ver carrito" — mismo tratamiento que ya se le dio a "Ver carrito".
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.16 · Abrir un evento o aviso desde el Dietario ya deja modificarlo o cancelarlo ahí mismo (auditoría, fricción)

- **Antes**: la ficha de un evento/aviso ya confirmado en el Dietario solo dejaba "Cerrar" — para editarlo o cancelarlo había que ir a Recordatorios o Calendario aparte y volver a buscarlo.
- **Ahora**: si el evento ya está sincronizado en Calendar, aparece "✎ Modificar" (título, fecha y hora, ubicación, descripción, y el título del aviso si va combinado) y "Anular evento"; si tiene un aviso programado, aparece también "Cancelar aviso". Los cambios se guardan también en Calendar, no solo en Angeli.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: ampliados en `tests/dietario.test.mjs`.

## V0.22.15 · Una pregunta pendiente de otra orden ya no se comía un recordatorio, WhatsApp, evento o llamada nuevos (auditoría, prioridad media)

- **Causa raíz**: solo la lista de la compra tenía un carve-out explícito para que un comando inequívoco y sin relación no se confundiera con la respuesta a una pregunta pendiente de otra orden. Reminders, WhatsApp, calendario y llamadas no lo tenían: un WhatsApp a medias esperando el nombre del contacto, por ejemplo, se comía un "Recuérdame llamar al médico mañana" completamente nuevo como si fuera su respuesta.
- **Corregido**: se generaliza el mismo carve-out a los cuatro dominios. Si el texto trae un disparador inequívoco de orden nueva de un dominio distinto al de la pregunta pendiente ("Recuérdame...", "envía/manda un whatsapp a...", "nuevo evento"/"añade... al calendario", "llama a..."), se descarta la pregunta pendiente para ese turno. Una respuesta real y corta ("a las nueve", "Juan Pérez", "sí, cámbialo a las nueve") sigue completando la interacción activa igual que antes.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 8 pruebas nuevas en `tests/conversation.test.mjs`.

## V0.22.14 · Editar los accesos directos en dos móviles a la vez ya no borra en silencio el cambio del otro (auditoría, prioridad media)

- **Causa raíz**: guardar los accesos directos hacía un `setDoc({items,hidden})` que sobrescribía el documento entero en Firestore — si dos dispositivos editaban los accesos (añadir, borrar, reordenar) casi a la vez, el segundo guardado en llegar pisaba sin avisar el cambio del primero. En el fondo, los accesos no tenían ningún `id` estable, así que no había forma de saber si dos accesos "parecidos" eran el mismo editado o dos distintos.
- **Corregido**: cada acceso lleva ahora un `id` estable, y el guardado calcula qué cambió de verdad en este dispositivo desde la última sincronización y lo aplica — dentro de una transacción de Firestore — sobre la copia más reciente de la nube, en vez de sobrescribirla entera. Un acceso añadido o borrado en el otro dispositivo mientras tanto ya no se pierde.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 4 pruebas nuevas en `tests/shortcuts.test.mjs`.

## V0.22.13 · Cada lista de la compra se asocia ahora a una tienda concreta

- **Novedad**: al crear una lista de la compra se elige su tienda entre un conjunto de presets (Mercadona, Consum, Leroy Merlin, Carrefour, Family Cash, Plaza Mayor) — también se puede cambiar después desde el "⋮" de la lista, sin tener que recrearla.
- **Por qué**: pedido explícito del propietario, que hace el 80-90% de su compra en Mercadona (por eso sigue siendo el valor por defecto para las listas ya existentes y las nuevas sin elegir tienda) pero también compra en otras tiendas sin catálogo con el que integrarse.
- **Comportamiento**: solo las listas de Mercadona conservan la búsqueda en vivo con precio y foto (es la única tienda con catálogo real). El resto son listas de artículos escritos a mano — escribir un artículo y pulsar Enter (o el botón de añadir) lo mete directamente en la lista, sin lanzar ninguna búsqueda que nunca podría responder.
- Cada lista muestra su tienda junto al número de artículos, tanto en "Mis listas" como dentro de la propia lista.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 6 pruebas nuevas en `tests/shopping.test.mjs`.

## V0.22.12 · Abrir la lista de la compra por voz en pleno modo conversación ya no la dejaba invisible detrás (auditoría, prioridad media)

- **Causa raíz**: `#shoppingLibrary`/`#dietarioLibrary` y el fondo a pantalla completa del modo conversación compartían el mismo `z-index:4` — en el empate ganaba el modo conversación, por ir después en el HTML, y la lista se abría de verdad pero invisible detrás.
- **Corregido**: la lista de la compra y el dietario suben a `z-index:5`, por delante del modo conversación pero sin tocar su posición respecto al menú rápido de acciones (`z-index:6`), que seguía siendo la razón original de tener un z-index más bajo que el resto de paneles a pantalla completa.
- **Verificado en el navegador sandbox**: con ambos paneles abiertos a la vez, "Mis listas" se ve por delante del fondo oscuro del modo conversación.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.11 · Añadir de nuevo al carrito un artículo ya vinculado a Mercadona ya actualiza el producto de esa línea (auditoría, prioridad media)

- **Causa raíz**: al fusionar con una línea ya existente del carrito, `mergeIntoCart` solo sumaba la cantidad — si el artículo de la lista se vinculaba a un producto de Mercadona (o cambiaba de vínculo) DESPUÉS de la primera vez que se añadía al carrito, esa línea se quedaba para siempre sin precio ni foto.
- **Corregido**: al fusionar, la línea del carrito también actualiza su producto vinculado con el más reciente.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.10 · Un móvil de contacto en formato no reconocido ya no se daba por "no encontrado" (auditoría, prioridad media)

- **Causa raíz**: `whatsappPhone` solo acepta números que empiecen por "+"/"00" o que encajen en el patrón español de móvil de 9 cifras — cualquier otro formato (p. ej. un número extranjero guardado sin prefijo) se descartaba en silencio, y la pantalla de WhatsApp mostraba "No encuentro un móvil" como si el contacto no tuviera ninguno.
- **Corregido**: cuando el contacto sí tiene un número pero no encaja en ningún formato reconocido, ahora se muestra igualmente (con aviso de que le falta el prefijo) y, al tocarlo, abre el editor de número ya con ese valor escrito, en vez de en blanco.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/conversation.test.mjs`.

## V0.22.9 · Reprogramar un evento a la vez que se cambia el lugar ya no perdía el lugar (auditoría, prioridad media)

- **Causa raíz**: `protectCalendarInterpretation` combinaba los cambios detectados localmente (fecha/hora) con los de la IA remota usando `local.changes || remote.changes || null` — en cuanto el detector local encontraba una fecha u hora en la misma frase, descartaba entero lo que la IA remota hubiera entendido, aunque fuera un cambio distinto (p. ej. la ubicación).
- **Corregido**: ahora se fusionan ambos objetos (`{...remote.changes, ...local.changes}`), dando prioridad a lo detectado localmente solo en los campos que realmente puede detectar (fecha/hora), sin descartar el resto de lo que la IA haya entendido bien.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/conversation.test.mjs`.

## V0.22.8 · Editar una nota desde su biblioteca ya no deja sin confirmación al guardar (auditoría, prioridad media)

- **Causa raíz**: al guardar los cambios, siempre volvía a la pantalla de inicio sin mostrar nada — no importaba si habías abierto el editor desde la ficha de la nota o desde la propia lista.
- **Corregido**: editar desde la ficha de una nota vuelve a esa misma ficha, ya actualizada; editar desde la lista de notas vuelve a la lista, ya refrescada.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/note-library.test.mjs`.

## V0.22.7 · Una subida con varios adjuntos que falla a medias ya no deja archivos huérfanos en Drive (auditoría, prioridad media)

- **Causa raíz**: al añadir varios adjuntos a la vez, si el segundo (o el tercero) fallaba al subir a Drive, el primero ya subido nunca se borraba — quedaba huérfano, sin ninguna entrada que lo referenciara.
- **Corregido**: se deshace lo ya subido antes de limpiar el estado local, igual que ya hacía el mismo tipo de subida al editar una nota.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/media-context.test.mjs`.

## V0.22.6 · Reclasificar un adjunto desde Fotos/archivos ya no escribía en el campo equivocado si era una nota (auditoría, prioridad media)

- **Causa raíz**: el botón "Clasificar ahora"/"Modificar clasificación" de la ficha de un adjunto escribía siempre en `mediaContext`, aunque la entrada fuera una nota (cuya categoría/relación real vive en `noteClassification`) — creaba una segunda clasificación que Notas y Fotos/archivos mostraban de forma distinta para la misma entrada.
- **Corregido**: las notas ya no ofrecen ese botón — "Abrir nota" ya da acceso a su edición completa, con su categoría/relación real.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/media-context.test.mjs`.

## V0.22.5 · Micrófonos huérfanos: cancelar un dictado ya no exige un segundo toque en otro micro (auditoría, hallazgo 6/6)

Último hallazgo de prioridad alta de la auditoría completa del código.

- **Causa raíz**: cancelar o guardar un borrador (el modal "Te escucho", la pregunta de aclaración, o los editores de campo de Calendar/WhatsApp) nunca paraba el reconocedor de voz si seguía escuchando en ese momento — se quedaba huérfano en segundo plano. El primer toque en OTRO micrófono (de un campo distinto, o el micro rápido de la lista de la compra) solo apagaba ese fantasma sin llegar a arrancar nada — hacía falta un segundo toque para dictar de verdad.
- **Corregido**: todos los puntos donde se cierra un borrador o se cambia de pantalla tras cancelar/guardar paran primero cualquier dictado huérfano.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: ampliados en `tests/dictation.test.mjs`.

## V0.22.4 · Dos falsos positivos del intérprete: frases cotidianas y "recuérdame que..." (auditoría, hallazgos 4 y 5/6)

- **"Cámbiame el turno del trabajo, ponlo de tarde" ya no se confunde con modificar un evento**: el detector local de "modificar evento" solo exigía un verbo cotidiano (cambia/mueve/pasa...), sin ninguna señal de que la frase fuera realmente sobre Calendar. Ahora exige también una palabra de calendario, un campo modificable (hora/fecha/ubicación/título...) o una fecha/hora real detectada.
- **"Recuérdame que revise los recordatorios del banco el viernes" ya no se pierde como una consulta vacía**: si el contenido de un recordatorio nuevo mencionaba las palabras "notas" o "recordatorios", se malinterpretaba como una consulta en vez de crearse. Corregido con el mismo criterio ya usado para "recuérdame llamar a X".
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 2 pruebas nuevas en `tests/conversation.test.mjs`.

## V0.22.3 · Completar un aviso ya borrado en Calendar ya no lo deja atascado para siempre (auditoría, hallazgo 3/6)

- **Causa raíz**: borrar en el backend un evento de Calendar que ya no existe (borrado a mano por el propietario, o en un intento anterior) devolvía 404/410, y tanto completar como cancelar un aviso/recordatorio lo trataban como un fallo real — con un mensaje falso ("el aviso sigue activo en Calendar") y sin marcar nunca la entrada como hecha. Cada reintento chocaba con el mismo evento inexistente, sin salida posible desde la interfaz.
- **Corregido**: un borrado que ya no encuentra el recurso en Calendar se trata como éxito (el estado que se buscaba — evento fuera de Calendar — ya se cumple), igual que ya hacía la consulta ("get") de un evento junto a la que vive este código.
- Sin cambios en el frontend; sí requiere redespliegue del backend (`gcloud run deploy`).
- Tests: 1 prueba nueva en `backend/test_app.py`.

## V0.22.2 · El badge "Mercadona · en vivo" y el buscador se ocultaban solo a medias (auditoría, hallazgo 2/6)

- **Causa raíz**: `#shoppingLiveBadge`, `#shoppingFallbackAdd` y `#shoppingSuggestions` se ocultan con el atributo `hidden`, pero sus propias clases fijan su `display` — con la misma especificidad que la regla `[hidden]` del navegador, gana la de la clase, así que ocultarlos con `hidden=true` no los ocultaba de verdad. Mismo patrón de bug ya corregido antes para otras pantallas de esta app, colado en tres elementos añadidos después.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/shopping.test.mjs`.

## V0.22.1 · Cerrar sesión ya no dejaba la app "pegada" (auditoría completa, hallazgo 1/6)

Primer arreglo de la auditoría completa del código pedida por el propietario. Bug encontrado por revisión, no reportado por el propietario — nadie había notado que cerrar sesión no funcionaba de verdad.

- **Causa raíz**: la comprobación "¿es la cuenta correcta?" (`nextUser?.email?.toLowerCase() !== OWNER_EMAIL`) también daba verdadero cuando no había ninguna cuenta (`nextUser` nulo, justo el caso de cerrar sesión o de cargar la app sin sesión previa), porque `undefined !== "franbermudez.es@gmail.com"` es cierto. Esa rama, al no tener ninguna cuenta que expulsar, no hacía nada y salía sin limpiar el estado interno, sin desuscribir ninguno de los 5 oyentes de Firestore ni avisar a la interfaz — la app se quedaba mostrando "conectado" indefinidamente tras pulsar "Cerrar sesión", y con el tiempo empezaba a fallar en silencio al intentar sincronizar con un token ya inválido.
- **Corregido**: solo se trata como "cuenta equivocada" cuando de verdad hay una cuenta distinta a la propietaria; sin ninguna cuenta, el flujo sigue normal y limpia todo correctamente.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/firebase-auth.test.mjs`.

## V0.22.0 · Una foto clasificada ya no se queda huérfana sin forma de enviarse

Reportado con captura de pantalla justo después de la V0.21.99: tras clasificar una foto (categoría, tipo de relación...), se quedaba como miniatura fija encima del footer — sin ningún botón visible para enviarla, y tocarla no hacía nada.

- **Causa raíz**: desde el rediseño de la pantalla principal (V0.21.87), el compositor fijo con el botón "➤ Enviar" quedó oculto por defecto. Clasificar un adjunto avisaba "puedes añadir una instrucción o enviarlo", pero ningún paso volvía a abrir ese compositor — la foto se quedaba solo en memoria, sin ninguna forma de completarse, hasta que se cerraba la app y se perdía.
- **Corregido**: justo después de clasificar el adjunto, se abre el mismo cuadro "Te escucho" de siempre (con su micrófono y su "➤ Enviar"), para poder añadir una instrucción o enviarlo tal cual en el momento. Al enviarse, la miniatura desaparece del footer, como debía.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/media-context.test.mjs`.

## V0.21.99 · Fotos de cámara+galería mezcladas ya no se pierden; nuevo tipo de relación al vuelo

Dos fallos reales reportados por el propietario probando la app: fotos que desaparecían al combinar cámara y galería, y no poder crear un tipo de relación nuevo (p. ej. "Familia") sin ir antes a Ajustes.

- **Causa raíz de las fotos perdidas**: hacer una foto con la cámara y luego añadir también fotos de la galería (o al revés) sustituía en silencio la selección anterior por la nueva, en vez de sumarlas — la primera foto nunca llegaba a subirse, sin ningún aviso de que se había perdido. Corregido para que cada nueva selección se sume a la anterior.
- **Nuevo tipo de relación al clasificar un adjunto**: el selector "Relacionado con" ahora incluye "+ Nuevo tipo…" — se escribe el nombre ahí mismo (p. ej. "Familia") y queda creado de verdad en los ajustes de notas, sin salir a Ajustes primero.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 2 pruebas nuevas en `tests/media-context.test.mjs`.

## V0.21.98 · Modo conversación: el micrófono se abre solo

Pedido explícito del propietario: tocar "modo conversación" y tener que tocar OTRA VEZ el micrófono para empezar a hablar era un clic de más que además confundía.

- Al entrar en modo conversación, el micrófono queda escuchando automáticamente — ya no hace falta tocarlo aparte para empezar a hablar.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 1 prueba nueva en `tests/conversation-mode.test.mjs`.

## V0.21.97 · Llamar y WhatsApp buscan el contacto solos, sin un clic de más

Pedido explícito del propietario: "no tengo el por qué de hacer yo clic para que haga la búsqueda... menos es más".

- **Antes**: al pedir una llamada o un WhatsApp, solo se buscaba el contacto sola si la orden venía del acceso directo "Llamar contacto" — hablar o escribir la orden de la forma normal, o cualquier WhatsApp (por cualquier vía), obligaba a tocar "Buscar contacto" antes de poder elegir el número.
- **Ahora**: en cuanto Angeli sabe a quién va dirigida la llamada o el WhatsApp, busca el contacto sola — un toque menos para llegar al número. Solo se salta la búsqueda si el número ya se conocía de antes.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/shortcuts.test.mjs` actualizado.

## V0.21.96 · Cursor listo para escribir en todos los modales con su propio cuadro de texto

El propietario avisó, tras la corrección de la V0.21.95, de que el mismo fallo (cuadro de texto sin el cursor puesto al abrirse) podía repetirse en cualquier otro modal con su propio campo de escritura.

- **Auditados todos los modales con cuadro de texto propio** — el borrador general ("Te escucho"), cambiar título/ubicación/descripción de un evento, cambiar fecha y hora, editar el mensaje de WhatsApp, e indicar otro número de teléfono. Todos dejan ahora el cursor puesto en cuanto se abren, sin tener que tocarlos antes para poder escribir o dictar.
- Revisado también que ninguno de ellos reanuda el micrófono de fondo del modo conversación mientras sigue abierto (el fallo de la V0.21.95) — solo el modal de "solo me falta un dato" tenía ese problema concreto; el resto ya esperaba correctamente a cerrarse.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/conversation-mode.test.mjs` ampliado a los cinco modales; `tests/conversation.test.mjs` actualizado para reflejar el nuevo comportamiento.

## V0.21.95 · Modo conversación: arreglado el modal de "solo me falta un dato"

Reportado por el propietario: al pedir algo en modo conversación que necesitaba un dato más, aparecía el modal de pregunta pero no podía terminar la instrucción — ni hablando ni escribiendo.

- **Causa raíz**: ese modal trae su propio cuadro de texto y su propio botón "🎙️ Hablar", pero a la vez se reanudaba el micrófono de fondo del modo conversación — dos reconocedores de voz compitiendo por el mismo micrófono. Tocar el micro del modal fallaba en silencio porque el de fondo ya lo tenía ocupado, así que hablar no escribía nada y la instrucción se quedaba colgada. Corregido para que, igual que ya pasaba con el otro tipo de modal ("toca en la pantalla para continuar"), se espere a que este se cierre antes de reanudar la escucha de fondo.
- **Además**: el cuadro de texto se abría sin el cursor puesto — había que tocarlo primero para poder escribir. Ahora queda enfocado en cuanto se abre el modal.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 2 pruebas nuevas en `tests/conversation-mode.test.mjs`.

## V0.21.94 · Ocultar del todo los accesos directos, y elegirlos ya preparados

Aclaración del propietario justo después de la V0.21.93: "Gestionar accesos directos" permite borrar uno a uno, pero pedía además dejar la pantalla principal completamente limpia (ni la fila ni el "＋"), y poder elegir accesos ya preparados en vez de escribirlos a mano.

- **Nuevo "🙈 Ocultar accesos directos" en Ajustes**: oculta del todo la fila de la pantalla principal, incluido el "＋" — no queda nada a la vista. Se sincroniza entre dispositivos igual que los propios accesos.
- **"＋ Elegir acceso directo"** (antes "Crear acceso manual"): en vez de escribir el texto y buscar un icono a mano, se elige uno de una lista ya preparada (con su icono y su orden real) y se añade con un toque. Incluye los mismos accesos que trae la app por defecto —por si se borró alguno y se quiere recuperar— más "Nueva nota", "Añadir a la compra", "Mañana" y "Esta semana". "Crear uno personalizado" sigue disponible para lo que no encaje ahí.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 3 pruebas nuevas en `tests/shortcuts.test.mjs`.

## V0.21.93 · Gestionar accesos directos desde Ajustes, accesos rápidos de Llamar/WhatsApp y el micro ya no corta el dictado

- **Nuevo modal en Ajustes ("🗑️ Gestionar accesos directos")** para quitar de verdad un acceso directo de la pantalla principal — sustituye al antiguo flujo con un cuadro de texto del navegador para elegir el número a borrar.
- **Dos accesos rápidos nuevos** junto a Notas/Recordatorios/Calendario: Llamar y WhatsApp, mismas órdenes de siempre, solo un acceso más directo.
- **Corregido**: el micro de dictado general ("Toca para hablar") cortaba a los 1-3 segundos, obligando a hablar muy rápido y sin pausas. Causa: el reconocedor de voz daba la sesión por terminada nada más entregar el primer resultado. Ahora sigue escuchando hasta tocar el micro de nuevo o pulsar Enviar. El modo conversación y el micro rápido de la lista de la compra no se han tocado — ahí sí es correcto que cada sesión sea una sola orden.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 4 pruebas nuevas (gestión de accesos, accesos rápidos de llamar/WhatsApp, dictado sin cortes).

## V0.21.92 · Acceso directo al carrito y detalle de precios en el historial

Dos ajustes pedidos por el propietario justo después de probar el carrito de la V0.21.91.

- **"Ver carrito" pasa a ser un acceso directo**, junto a "Quitar comprados"/"Vaciar lista" — ya no hace falta pasar por el "⋮" para verlo.
- **Pulsar una compra del historial ahora enseña su ficha completa**: cada artículo con su cantidad y precio (y el precio por unidad si son varias), más el total de esa compra — antes el historial solo mostraba los nombres.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 3 pruebas nuevas en `tests/shopping.test.mjs`.

## V0.21.91 · Carrito de la compra e historial de compras

Pedido explícito del propietario, calcado de cómo funciona la app real de Mercadona: la lista habitual y la compra concreta del día son cosas distintas.

- **La lista de la compra no cambia en nada**: mismo buscador, mismo check de siempre, "Quitar comprados" y "Vaciar lista" tal cual estaban. Solo se añade un botón nuevo, "🛒 Añadir al carrito".
- **El check de la lista ahora sirve para elegir qué llevar hoy**: marca los artículos que necesitas, pulsa "🛒 Añadir al carrito" y se copian al carrito con su cantidad — el check de la lista vuelve a quedar vacío, pero el artículo sigue en la lista para la próxima vez (no se borra de ahí).
- **Carrito nuevo** (desde el "⋮" de la lista): la compra de hoy. Cada artículo tiene su propio check ("ya está en el carro") y su propia cantidad, independientes de la lista. "Finalizar compra" archiva lo marcado con la fecha de hoy; lo que no llegaste a comprar se queda en el carrito para la próxima.
- **Historial de compras nuevo** (también desde el "⋮"): un bloque por cada compra finalizada, con la fecha y lo que se compró esa vez.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: 9 pruebas nuevas en `tests/shopping.test.mjs` para el carrito y el historial (añadir/quitar, cantidades, finalizar compra dejando lo no comprado en el carrito), más una prueba explícita de que la lista de siempre no pierde ni cambia ninguno de sus elementos existentes.

## V0.21.90 · Accesos directos sincronizados entre dispositivos, sin scroll horizontal

Reportado por el propietario: en el móvil tenía 7 accesos directos y en el ordenador (PWA) solo 3 — no eran los mismos en cada sitio.

- **Causa raíz**: los accesos directos solo se guardaban en el `localStorage` de cada dispositivo, sin sincronizar nunca con Firestore — a diferencia de la lista de la compra o los ajustes de notas, que sí viven en la nube. Corregido guardando también en `users/{uid}/settings/shortcuts`: crear o eliminar un acceso en un dispositivo ahora se refleja en los demás. `localStorage` se mantiene como caché para abrir sin esperar a la red.
- **Migración transparente**: la primera vez que un dispositivo se conecta y la nube todavía no tiene ningún acceso guardado, sube los que ya tuviera ese dispositivo en vez de perderlos — mismo patrón ya usado para la lista de la compra.
- **Fila de accesos sin scroll horizontal**: con más accesos precargados, la fila con desplazamiento lateral escondía la mayoría fuera de la pantalla. Ahora la fila envuelve en varias líneas para que se vean todos de un vistazo, sin tener que desplazarse.
- Sin cambios en el backend; no requiere redespliegue (solo reglas de Firestore ya vigentes, que autorizan cualquier documento bajo `settings`).
- Tests: `tests/shortcuts.test.mjs` ampliado para comprobar la sincronización (guardado local + subida a la nube, migración si la nube está vacía) y que la fila envuelve en vez de desplazarse.

## V0.21.89 · Dietario: rango "Pendientes/Anteriores" y botón "+" para añadir sin salir

Pedido explícito del propietario, sin boceto previo (cambio acotado a un filtro y un botón dentro de una pantalla ya existente).

- **Nuevo filtro de rango "Pendientes/Anteriores"** junto a Hoy/Esta semana/Todo: hasta ahora, cualquier evento o aviso con fecha pasada que seguía activo (no cancelado ni completado) desaparecía del Dietario sin que ningún filtro lo mostrara — ni siquiera "Todo", que solo mira hacia delante desde hoy. Este rango mira hacia atrás en el tiempo (de lo más reciente a lo más antiguo) para recuperar justo eso.
- **Botón "+" dentro del propio Dietario**, junto a cerrar: abre el mismo desplegable de siempre (Añadir evento / Añadir aviso / Añadir nota / Añadir imagen / Añadir adjunto), cada uno reutilizando exactamente la misma función ya existente en cualquier otra parte de la app — sin tener que salir del Dietario a buscar el acceso.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/dietario.test.mjs` ampliado para cubrir el nuevo rango (orden de más reciente a más antiguo, y que no repite lo que ya enseñan los demás rangos) y la reutilización de las mismas funciones de siempre en el nuevo botón "+".

## V0.21.88 · Cuatro correcciones sobre el rediseño (revisión + reporte real del propietario)

Revisión de `chatgpt-codex-connector` sobre la PR del rediseño (V0.21.87) más un aviso real del propietario probando la app ya con el nuevo footer.

- **Sin voz, ya no se quedaba sin forma de escribir**: con el compositor de texto fijo ocultado en el rediseño, `start()` salía sin hacer nada en un navegador sin `SpeechRecognition` — no había ninguna otra vía para escribir una instrucción a mano. Ahora siempre abre primero el modal de borrador (`openDraft()`) y solo omite arrancar el dictado si no hay reconocimiento de voz disponible.
- **Un aviso push de recordatorio abría la app sin enseñar nada**: `focusPendingReminder()` intentaba hacer scroll hasta la entrada dentro de `#list`, que en el rediseño se quedó oculto para siempre. Ahora enseña la misma ficha (`ui.showEntryAction`) que ya se usa en el resto de la app para ver una entrada.
- **El modal de "¿a qué lista lo añado?" se podía dejar abierto**: al elegir una lista no se cerraba el modal antes de añadir, así que un toque accidental de más podía añadir el artículo dos veces. Ahora cada opción cierra el modal (`closeLayers()`) antes de continuar.
- **Reportado en real por el propietario**: al tocar "⋮" en una lista de la compra para cambiar el nombre o eliminarla, el modal salía oculto detrás de la propia pantalla de la lista — parecía que no había pasado nada hasta cerrar la lista, momento en el que aparecía. Causa raíz: el mismo problema de z-index ya arreglado para el Dietario en V0.21.x — `#shoppingLibrary` comparte la clase `.media-library` (z-index:8), por delante de `.action-modal` (z-index:6), y el menú rápido de la lista abre ese modal sin cerrar antes la pantalla de fondo. Corregido bajando `#shoppingLibrary` a z-index:4, igual que ya se hizo con `#dietarioLibrary`.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: nueva prueba en `tests/shopping.test.mjs` que comprueba en `styles.css` que `#shoppingLibrary` queda por detrás de `.action-modal`, igual que la ya existente para `#dietarioLibrary`.

## V0.21.87 · Rediseño de la pantalla principal

Pedido explícitamente por el propietario, con un boceto visual aprobado antes de tocar código.

- **Mic central + dos laterales**: a la izquierda, un botón nuevo "🛒 añadir rápido" — se dice solo el producto y va directo al buscador de Mercadona (con el modal de confirmación ya existente), preguntando a qué lista añadirlo si hay más de una. A la derecha, el modo conversación pasa de botón de texto a círculo, a juego con el resto.
- **Se quita el feed de "Conversación" de la vista principal** — sigue guardándose todo igual por dentro (Firestore), solo deja de ocupar la pantalla.
- **Accesos rápidos nuevos** debajo de los atajos: Notas, Recordatorios y Calendario — cada uno abre el mismo compositor de siempre para crear uno nuevo, solo cambia el camino para llegar.
- **Footer nuevo**: fuera el cuadro de texto con micrófono y flecha de enviar. Se quedan Cámara, Fotos y Archivo como iconos directos (antes escondidos tras el "+"), y un botón destacado en medio para crear un evento de Calendar directamente.
- Todas las funciones son las mismas de siempre — solo cambian los accesos para llegar a ellas.
- Sin cambios en el backend; no requiere redespliegue.

## V0.21.86 · Correcciones: dictado no disparaba la búsqueda, y la búsqueda no ignoraba acentos

- Al tocar el micrófono del buscador de una lista y decir "café", no salía ningún resultado. Causa real: `target.value=...` asignado desde JavaScript durante el dictado nunca dispara un evento `input` nativo, así que el buscador (que reacciona a ese evento para lanzar la búsqueda en vivo) nunca se enteraba de que el texto había cambiado. Corregido despachando el evento `input` manualmente tras cada actualización del dictado — beneficia a cualquier campo dictado con `oninput` propio, no solo al buscador de la compra.
- Investigando más a fondo con el propietario apareció el fallo real: escribir "cafe" (sin tilde) tampoco encontraba "Café" en el catálogo. Corregido en el backend comparando sin acentos en los dos lados (la búsqueda y los nombres del catálogo), para que dé igual cómo se haya escrito o dictado la tilde.
- Otro caso real encontrado a continuación: "café cápsula" (singular) no encontraba "Café en cápsulas" (plural). Corregido con el mismo enfoque ya usado en la lista de la compra: se prueban ambas reducciones del plural español (+s / +es) como candidatas al comparar.
- Deploy: backend redesplegado en Cloud Run (acentos y singular/plural en `mercadona_catalog.search`).
- Tests: nuevas pruebas en `backend/test_shopping_mercadona.py` para acentos y singular/plural.

## V0.21.85 · Listas de la compra con nombre propio, buscador como primer paso

Pedido a partir de una captura real de la app de Mercadona ("así me va perfecto, haz lo mismo en la nuestra"), con un boceto visual aprobado antes de tocar código.

- **Varias listas con nombre**, como "Fran"/"Mamá" en Mercadona: al tocar 🛒 se abre "Mis listas" (una tarjeta por lista, con miniaturas y contador), tocar una entra en su detalle, y "Crear nueva lista" añade otra. Cada lista tiene sus propios artículos, independientes de las demás. Se puede cambiar el nombre o borrar una lista desde el "⋮" de su tarjeta.
- **El buscador es ahora el primer paso**, no un botón aparte: dentro de una lista, escribir ya busca en vivo en Mercadona (con indicador "Mercadona · en vivo"), cada resultado con foto y precio para añadir con un toque; solo si ninguno vale, un enlace al final permite añadir el texto tal cual.
- **Un solo artículo por voz o texto ahora abre un modal de confirmación** con la búsqueda de Mercadona ya lanzada — pedido explícitamente: "agrega leche a la lista de Fran" ya no lo vincula en silencio por detrás, deja elegir el producto exacto en el momento. Con varios artículos a la vez, o si la tienda es Consum, se siguen añadiendo directos como antes.
- **Los comandos de voz/texto ahora entienden el nombre real de una lista**: "añade leche a la lista de Fran", "busca cerveza en la lista de Mamá", "vacía la lista de Fran" — si no se nombra ninguna, se usa la que se tenía abierta.
- **Total aproximado** al pie de cada lista, sumando el precio de los artículos ya vinculados a un producto real de Mercadona.
- Migración automática y transparente: la lista única que ya existía se convierte en una lista llamada "Mi lista" la primera vez que se abre, sin perder nada.
- Sin cambios en el backend ni en `firestore.rules`; no requiere redespliegue.
- Tests: `tests/shopping.test.mjs` ampliado a 38 pruebas (gestión de varias listas, reconocimiento del nombre real de una lista incluyendo tildes, migración del formato antiguo).

## V0.21.84 · Cabecera: quitado el icono de Calendario (no cabía en el móvil)

- Reportado: en el móvil, con el nuevo icono 🛒, la cabecera ya no cabía y el icono de Ajustes quedaba fuera de la pantalla. Quitado el icono de Calendario (🗓️) de la cabecera — ya existe el mismo acceso abajo, en "🗓️ Hoy" / "🗓️ Próxima semana".
- **Anotado, sin arreglar todavía** (pendiente explícito del propietario): el Dietario → "Eventos" no refleja el Calendar real, solo lo que Angeli ha creado él mismo como entrada — no consulta Google Calendar en vivo. Documentado en `PROJECT_MEMORY.md` con la causa raíz y por qué es un cambio de arquitectura, no un arreglo rápido.
- Sin cambios en el backend; no requiere redespliegue.

## V0.21.83 · Lista de la compra: botón de búsqueda explícito

Reportado probando en el móvil: no había ningún botón para buscar — solo micrófono y "+" (que añade el texto tal cual) — así que la búsqueda en vivo al escribir pasaba completamente desapercibida. Además, decir exactamente "busca leche en la lista de la compra" (sin mencionar Mercadona) no se reconocía como búsqueda y se guardaba "busca leche" como artículo literal.

- Añadido un botón "🔍" explícito junto al campo de la lista de la compra: busca al momento, sin esperar a dejar de escribir. Se ve claramente "Buscando en Mercadona…" mientras tarda y "Sin resultados en Mercadona" si no encuentra nada — antes, sin resultados simplemente no pasaba nada visible.
- "busca X en la lista de la compra" (o "en la lista del súper"), sin nombrar una tienda, ahora se entiende como búsqueda en Mercadona — el único catálogo con búsqueda real por ahora.
- Añadida una pista bajo el campo ("🔍 busca en Mercadona · ＋ añade el texto tal cual") para que la diferencia entre buscar y añadir sea explícita, no algo que haya que descubrir.
- Sin cambios en el backend; no requiere redespliegue.
- Tests: `tests/shopping.test.mjs` ampliado a 25 pruebas (la frase exacta reportada).

## V0.21.82 · Lista de la compra: catálogo de Mercadona más fiable, cantidades con +/- y búsqueda ampliada

Todo probado directamente en la app real (producción) con la sesión del propietario, siguiendo su petición explícita de dejar primero el buscador/añadir/lista perfectamente pulidos antes de tocar la voz.

- **El catálogo de Mercadona perdía categorías enteras en silencio**: "leche" no encontraba ninguna leche de verdad (solo café con leche, chocolate con leche...), y "leche Hacendado" tampoco. Comprobado con la API real de Mercadona que sí existen ("Leche semidesnatada Hacendado" y variantes están ahí). Causa: si una subcategoría fallaba al construir el catálogo (~150 peticiones concurrentes, cualquier fallo transitorio), se descartaba sin reintento y sin dejar rastro, y el catálogo incompleto se cacheaba igualmente 12 horas. Corregido: cada categoría se reintenta hasta 3 veces; si la construcción sale con muchos menos productos de los esperados (por debajo de 1500, el catálogo completo tiene ~4600), se usa igual si no hay nada mejor pero se reintenta a los 5 minutos en vez de esperar 12h, y nunca se descarta un catálogo previo más completo por uno peor.
- **Falso positivo por subcadena**: "leche entera" encontraba "Chocolate ... almendras enteras" porque "entera" es subcadena de "enteras". Corregido: coincidencia por palabra completa.
- **El buscador solo mostraba 6 resultados** — pedido explícitamente ampliarlo para explorar de verdad (p. ej. ver varias marcas de cerveza). El buscador manual de la lista ahora pide hasta 20; el backend admite hasta 30 si se solicitan.
- **"leche" y "2 leches" creaban dos filas separadas** en vez de sumarse, por comparar el nombre en plural/singular como si fueran distintos. Corregido con un emparejado que reconoce singular y plural (leche/leches, yogur/yogures).
- **No había forma de cambiar la cantidad de un artículo ya en la lista** — pedido explícitamente un "+" y un "−" en la misma línea del artículo, sin campo de texto ni scroll. Añadido.
- **"busca leche en la lista de mercadona" se enviaba como nota** — reconocido ahora como una búsqueda ("busca/mira/enséñame/dime X en/de mercadona o consum"), independiente de la frase "lista de la compra": abre la lista y lanza la búsqueda directamente.
- Deploy: backend redesplegado en Cloud Run (recorrido del catálogo con reintentos y umbral mínimo).
- Tests: `tests/shopping.test.mjs` ampliado a 24 pruebas; `backend/test_shopping_mercadona.py` ampliado con la construcción del catálogo contra red simulada (reintento, umbral mínimo, no perder un catálogo mejor) y el falso positivo de subcadena.

## V0.21.81 · Lista de la compra: 4 fallos reales corregidos tras la primera prueba

Reportados todos por el usuario probando la V0.21.80 en real:

- **No sincronizaba entre dispositivos** (añadido en el móvil, no aparecía en el ordenador). Causa real: el documento de la lista se guardaba en `users/{uid}/lists/shopping`, una ruta que `firestore.rules` no autoriza (solo permite `entries` y `settings`). Firestore rechazaba en el servidor tanto la escritura como la lectura sin avisar de forma visible; el dispositivo que la creó la veía igual porque la actualización local es optimista, pero nunca llegaba a guardarse de verdad ni a otros dispositivos. Corregido moviendo el documento a `users/{uid}/settings/shopping`, ruta ya autorizada — sin tocar `firestore.rules` ni necesitar otro despliegue.
- **El modal de dictado se quedaba fijo en pantalla** al añadir un artículo por voz desde el botón normal de dictar (no el modo conversación). Causa: `openDraft()` ya había abierto el modal antes de procesar el texto; el atajo de la lista de la compra limpiaba el campo pero nunca cerraba ese modal, a diferencia del resto de instrucciones, que lo actualizan con la confirmación. Corregido cerrando también el modal en ese caso.
- **Desde el modo conversación, un comando de la lista se coló como si fuera una nota** ("añade colacao a la lista de la compra" acabó pidiendo un título de nota). Causa: `conversationActiveQuestionEntry()` busca en *todas* las entradas cualquier interacción pendiente sin resolver ("awaiting_input"), sin relación con la instrucción actual — y el atajo de la lista de la compra exigía que no hubiera ninguna interacción activa para dispararse, así que una pregunta pendiente de otra nota (probablemente la de "patatas" del fallo anterior) absorbió la orden nueva como si fuera su respuesta. Corregido: un comando inequívoco de la lista de la compra ya no exige que no haya ninguna interacción pendiente — se reconoce siempre, no se cuela en otra conversación sin relación.
- **El buscador de Mercadona no ofrecía nada para elegir** — solo dejaba añadir el texto tal cual, sin mostrar coincidencias reales, y la pantalla no tenía micrófono para dictar directamente ahí. Añadida búsqueda en vivo (con un pequeño retraso al escribir) que muestra hasta 6 coincidencias reales del catálogo de Mercadona con su precio para elegir con un toque, y un botón de micrófono en la propia pantalla de la lista.
- Extra pedido de paso: ahora se puede indicar cantidad ("añade 2 leches y tres yogures a la lista de la compra"); si el artículo ya estaba pendiente, la cantidad se suma en vez de duplicar la fila.
- Sin cambios en el backend ni en `firestore.rules`; no requiere redespliegue.
- Tests: `tests/shopping.test.mjs` ampliado a 19 pruebas (cantidades, "una leche" como artículo y no como número). Los fallos de sincronización, modal e interacción cruzada se verificaron a mano en el navegador (no automatizables sin una sesión real firmada), comprobando en cada caso el estado exacto del DOM antes/después.

## V0.21.80 · Nueva función: Lista de la compra, con búsqueda real en el catálogo de Mercadona

- Pedido por el usuario: poder decir "añade leche a la lista de la compra" y, cuando se dice "de mercadona", que se busque el artículo de verdad en Mercadona. Es una función nueva y separada de las notas — necesita marcar artículos uno a uno, así que tiene su propia pantalla (botón 🛒 en la cabecera), no es otra entrada de la conversación.
- Reconoce por voz o texto: añadir uno o varios artículos ("apunta en la lista de la compra leche, pan y huevos"), indicar tienda por artículo ("la leche de mercadona"), quitar uno, marcarlo como comprado ("ya tengo el pan"), vaciar la lista o abrirla sin más ("lista de la compra"). Todo esto se reconoce de forma local y determinista (`js/shopping.js`), nunca pasa por la IA — así que, igual que las protecciones ya existentes de calendario y llamadas, un fallo aquí no puede tocar notas, recordatorios ni eventos. La lista se guarda en Firestore (`users/{uid}/lists/shopping`), un documento por usuario, igual que los ajustes de notas o de avisos.
- **Sobre "consultar los artículos de Mercadona y Consum" que pediste**: investigado a fondo antes de montar nada.
  - **Mercadona**: no tiene una API oficial para terceros. La búsqueda real de su web pasa por Algolia con credenciales internas que rotan sin aviso — reproducirla se rompería sola con el tiempo. En cambio, `tienda.mercadona.es/api/categories/` es público, no necesita sesión ni pasa por el Akamai que protege las operaciones autenticadas, y da el catálogo completo (nombre, precio, foto, enlace) tal cual lo ve cualquier visitante anónimo. Se ha montado sobre esta vía, más lenta pero estable: el backend recorre las ~150 categorías una vez (`backend/mercadona_catalog.py`), cachea el catálogo 12 horas, y una nueva ruta `/shopping/mercadona/search` hace el emparejado por nombre. Cuando dices "la leche de mercadona", Angeli busca de verdad y, si encuentra, guarda precio y enlace al producto junto al artículo.
  - **Consum**: no se ha encontrado ninguna API pública. Su tienda online es una SPA de Angular sobre una plataforma de terceros ("Aktios TOL") que probablemente exige sesión/tienda seleccionada incluso para listar productos — reproducirla exigiría ingeniería inversa mucho más pesada y frágil que Mercadona, sin garantía de que siga funcionando dentro de unos meses. De momento, un artículo etiquetado "de consum" se guarda igual en la lista (para saber dónde comprarlo), pero sin búsqueda de producto ni precio real. Queda como posible ampliación futura si de verdad compensa el mantenimiento.
  - **Sobre sincronizar con tu cuenta real de Mercadona (que estás logueado)**: no se ha implementado y no se va a implementar por esta vía. Escribir en tu cesta real requeriría reutilizar tu sesión autenticada de Mercadona (cookies/credenciales), algo que Angeli no puede ni debe manejar seguro — no es una cuestión de dificultad técnica sino de no tocar tus credenciales ni tu cuenta de terceros. Angeli solo consulta el catálogo público (precio, nombre, enlace) para identificar el artículo; el enlace al producto (`Ver en Mercadona`) sí lo abre directamente en su web para que la compra la termines tú.
- Deploy: nueva ruta en el backend (`backend/app.py`, `backend/mercadona_catalog.py`) — requiere el redespliegue en Cloud Run que ya se hizo como parte de esta entrega.
- Tests: `tests/shopping.test.mjs` (parseo de comandos, gestión de la lista — 15 pruebas) y `backend/test_shopping_mercadona.py` (emparejado sobre un catálogo simulado + la ruta HTTP, sin tocar la red real de Mercadona en ningún test).

## V0.21.79 · Corrección: tocar un aviso push ahora lleva a la entrada, no a la pantalla en blanco

- Reportado por el usuario: al tocar la notificación de un recordatorio, la app se abría pero no llevaba a lo que había provocado el aviso. El backend (`backend/push_notifications.py`) ya mandaba la URL `./?reminder=<id>` en cada push, pero el frontend nunca leía ese parámetro.
- Corregido: al abrir la app desde un aviso, Angeli ahora reajusta los filtros si hacía falta, busca esa entrada en la conversación, hace scroll hasta ella y la resalta un momento. La URL se limpia después para no repetir el resaltado si se recarga la página.
- Comprobado también el otro punto que preguntó el usuario, si el aviso llega con la app completamente cerrada: el service worker (`sw.js`) ya mostraba la notificación en segundo plano vía `onBackgroundMessage`, y el envío ya usa `Urgency: high` para que Android la entregue aunque el móvil esté en reposo (V0.21.x anterior). Este mecanismo depende de que el navegador siga vivo en segundo plano (normal en Android con la PWA instalada); si el navegador se cierra del todo en el ordenador, ningún sitio web puede recibir push — es una limitación del propio sistema operativo/navegador, no de Angeli. Pendiente de que el usuario confirme con una prueba real en cada dispositivo.
- Sin cambios en el backend; no requiere redespliegue.
- Sin test automatizado nuevo: la lógica vive dentro de `render()` en `js/app.js`, acoplada al DOM y al estado de notas ya cargadas (mismo patrón que las funciones de red real de `google.js`, que tampoco tienen test automatizado en este proyecto). Verificado manualmente con la suite completa en verde (sin regresiones) y revisando el flujo a mano.

## V0.21.78 · Corrección: borrar una entrada no retiraba su evento o aviso de Calendar

- Reportado por el usuario al preguntar si borrar del Dietario también borraba de Calendar: no lo hacía. Borrar una entrada (desde el Dietario o desde "Borrar" en la conversación) solo la quitaba de Angeli; si tenía un evento sincronizado o un aviso programado, se quedaban huérfanos en tu Calendar real.
- Corregido: borrar una entrada ahora también cancela su evento y/o aviso en Calendar, igual que ya hacía "Anular" desde la agenda. Si Calendar no responde, la entrada se borra igualmente en Angeli y se avisa para revisarlo a mano.
- Sin cambios en el backend; no requiere redespliegue.

## V0.21.77 · Seguimientos manuales: "recuérdamelo en 2 días" ya calcula la fecha sola

- Base para los seguimientos de contacto que pediste ("si Ana no me contesta en dos días, recuérdamelo"): decidimos que sea Angeli quien lo diga explícitamente cuando toque (tú marcas manualmente que alguien no ha contestado), y ahora la fecha se calcula sola. Antes, "en/dentro de N días" (en dígitos o en palabras: "en 2 días", "dentro de tres días"...) no tenía ningún soporte local — dependía por completo de que la IA hiciera bien la aritmética de fechas, sin red de seguridad.
- Corrección relacionada encontrada de paso: "recuérdame**lo**" (con el pronombre pegado, muy natural — "recuérdamelo", "recuérdamela") no se reconocía como orden de recordatorio ni en el clasificador local ni en la protección de llamadas de la versión anterior; ahora sí.

## V0.21.76 · Limpieza del Dietario: las consultas de agenda ya no se acumulan en "Sin fecha"

- Cada vez que preguntabas por tu agenda (incluidos los accesos "Hoy"/"Próxima semana"), quedaba una entrada permanente sin fecha en "Sin fecha" — nunca se marca como hecha ni se reutiliza, así que se acumulaba cada vez que repetías la misma pregunta.
- Esas entradas ya no ocupan hueco en el Dietario. Las que ya existían en tus datos siguen ahí (puedes borrarlas desde la conversación normal si quieres), pero ya no aparecerán en el Dietario.
- Pendiente, señalado pero no abordado aún porque toca una parte más sensible del código: evitar que cada consulta siga creando una entrada nueva. De momento solo se ha resuelto que no se vean en el Dietario.

## V0.21.75 · Corrección: "llama a X" podía guardarse como nota en vez de llamar

- Reportado por el usuario en real: pidió llamar a Ana y la app la guardó como nota. Causa: la interpretación final depende de lo que devuelve la IA, y para frases en primera persona ("quiero llamar a X") a veces clasifica mal la intención.
- Corregido con una protección local (igual que ya existía para cambiar o cancelar eventos de calendario): una orden de llamada clara sin fecha ni hora ("llama/llamar a X") ahora fuerza `contact.call` aunque la IA responda nota o tarea, sin tocar los casos en los que la IA ya acierta ni las llamadas con fecha/hora futuras (que siguen siendo recordatorio, como hasta ahora).
- No afecta a "recuérdame llamar a X" (sigue siendo un recordatorio) ni a frases como "el proyecto se llama X" (llamarse, no llamar a alguien).

## V0.21.74 · Ajustes → Voz de Angeli: elegir voz, velocidad y tono

- Nueva sección en Ajustes, "Voz de Angeli": selector con las voces que ya tiene instaladas el teléfono, y deslizadores de velocidad y tono, con botón "Probar voz".
- La app no puede instalar voces nuevas (eso es del sistema operativo); si detecta pocas voces en español, lo explica y dirige a Ajustes del sistema en vez de prometer algo que una web no puede hacer.
- La preferencia se guarda en este dispositivo y se aplica a todo lo que Angeli dice por voz (modo conversación, coletillas, módulo de charla aparte).

## V0.21.73 · Modo conversación: la petición de tocar la pantalla ahora es específica de cada caso

- Cuando hacía falta tocar la pantalla (crear un evento con aviso, completar una nota, elegir entre varias notas...), Angeli decía siempre la misma frase fija ("Necesito que elijas una opción en la pantalla para continuar"), sin relación con si era una nota, un recordatorio o cualquier otra cosa.
- Ahora lee el título y la explicación reales de esa pantalla (que ya eran distintos para cada caso) y, cuando hay una acción principal clara, nombra el botón exacto a pulsar — por ejemplo "Completar nota. ¿Qué título quieres ponerle a esta nota? Toca «Revisar cambios» para continuar" en vez de la frase genérica de siempre.

## V0.21.72 · Módulo de charla aparte: coletillas generadas por IA, no solo una lista fija

- Nuevo endpoint de backend `/chat/aside`, completamente separado del intérprete de órdenes (prompt, modelo de respuesta y caché propios, sin esquema JSON): genera una reacción corta y variada de verdad en vez de elegir siempre entre las mismas 10 frases fijas.
- El modo conversación lo usa primero; si tarda más de un margen corto (0,9s) o falla por cualquier motivo, cae automáticamente a la lista fija ya existente — la garantía de "Angeli siempre contesta algo" nunca depende de que este módulo nuevo funcione.
- Es la base para, más adelante y como decisión aparte, una charla más libre no atada a notas/recordatorios/agenda.
- **Requiere volver a desplegar el backend en Cloud Run** para que `/chat/aside` exista en producción (igual que la caché de contexto de V0.21.70).

## V0.21.71 · Modo conversación: Angeli contesta siempre, no solo al final

- Antes, al hablar en modo conversación, Angeli se quedaba callada (solo el modal en texto) hasta tener la respuesta completa de Gemini — se notaba como si "hablaras contra una máquina". Ahora, nada más capturar la frase, dice una coletilla corta y variada ("¡Vale, voy!", "Mmm, a ver…", "¡Marchando!"...) elegida al azar, con tono cercano de compañera, mientras Gemini procesa de fondo.

## V0.21.70 · Corrección crítica: el modo conversación duplicaba entradas reales

- Al dictar una frase con una pausa breve a mitad ("llama a Vicente mañana"), el reconocedor de voz podía entregarla en dos resultados "finales" separados dentro de la misma sesión de escucha. El modo conversación procesaba ambos como turnos independientes en paralelo, duplicando la entrada guardada (por ejemplo, dos recordatorios idénticos). Detectado por el propietario probando la app en real, con datos reales. Corregido descartando cualquier resultado posterior al primer turno ya lanzado en esa sesión.

## Backend · Caché de contexto en Vertex AI para el intérprete

- El prompt de sistema que se manda a Gemini en cada interpretación pesa ~48.000 caracteres (~12.000-13.000 tokens) y es idéntico siempre. Ahora se cachea en Vertex AI (`client.caches`) y se reutiliza por nombre en vez de reenviarlo entero en cada llamada — menos tokens facturados y menos tiempo de red por petición, sobre todo notable con el modo conversación (varias llamadas seguidas en poco tiempo).
- Si la caché no se puede crear o falla al usarse (caducó, se borró...), la interpretación sigue funcionando exactamente igual que antes, enviando el prompt completo en esa llamada — la caché nunca puede ser la causa de que una orden falle.
- Cambio exclusivo de `backend/app.py` (servicio `angeli-ai-interpreter` en Cloud Run); no toca el frontend ni requiere una nueva versión de la PWA. **Requiere volver a desplegar el backend en Cloud Run para que surta efecto en producción.**

## V0.21.69 · Botón "⋮" del Dietario, tamaño táctil real (44px)

- El botón "⋮" de acciones rápidas del Dietario medía 26px, luego se subió a 40px — ambos por debajo del mínimo táctil recomendado (44px iOS / 48px Android) que la propia corrección citaba. Detectado en revisión externa antes de fusionar. Ahora mide 44×44px de verdad, y el test de regresión exige ese mínimo en vez de aceptar un valor menor.

## V0.21.68 · Corrección: el menú rápido del Dietario quedaba oculto detrás del propio Dietario

- Al pulsar "⋮" en un elemento del Dietario para marcarlo como hecho o eliminarlo, el menú se abría correctamente pero quedaba tapado detrás del panel del Dietario — solo cerrando el Dietario (perdiendo el sitio en la lista) se podía volver a verlo y pulsarlo. Causa: ese menú abre la ficha de acción sin cerrar antes el Dietario, y el Dietario tenía una prioridad visual más alta que la ficha. Ahora la ficha aparece siempre por delante, con el Dietario visible (atenuado) detrás.

## V0.21.67 · Modo conversación (escucha continua con respuesta hablada)

- Nuevo botón «💬 Modo conversación» (sustituye al saludo fijo «Hola, dime lo que necesites») que abre una pantalla de conversación a pantalla completa: se habla con naturalidad, sin tocar nada entre frases, y Angeli contesta en voz.
- Reutiliza sin modificarlo el mismo `add()` del compositor normal: cada frase reconocida se manda por el mismo camino que ya usa el dictado de toda la vida, así que el intérprete, las confirmaciones de calendario/recordatorios y todo lo que costó ajustar para que Angeli entendiera bien una orden queda intacto.
- Cuando Angeli necesita un dato que falta («¿a qué hora?»), lo pregunta en voz y sigue escuchando la respuesta, encadenando turnos automáticamente.
- Cuando la acción exige elegir entre varias opciones o confirmar algo con matices (crear un evento, elegir entre varias notas, revisar una nota antes de guardarla…), el modo conversación lo anuncia, pausa el micrófono y espera a que se resuelva en pantalla — no se ha forzado ninguna decisión de este tipo por voz, para no tocar ese flujo ya validado.
- Usa reconocimiento de voz de una sola tanda encadenada automáticamente (el mismo modo que ya funciona de forma fiable en el dictado normal en dispositivos reales), no reconocimiento continuo, que es poco fiable en iOS/Safari.

## V0.21.65 · Corrección: adjuntar una foto o archivo suelto se quedaba bloqueado

- Adjuntar una foto o un archivo directamente desde el compositor (sin pasar por una nota) rompía en silencio: el modal para elegir motivo, categoría y relación nunca llegaba a abrirse, dejando a la persona sin ninguna forma de continuar salvo descartar el adjunto. Causa: `normalizeMediaContext` recibía `null` (el valor inicial antes de la primera clasificación) y un `= {}` en la firma de la función no cubre `null`, solo `undefined`. Encontrado probando la aplicación real de punta a punta.
- En Galería/Archivos, algunas notas antiguas mostraban un chip «🔗 none» — el identificador interno de «sin relación» filtrándose como si fuera una relación real. `settingLabel` ya no devuelve ese identificador como etiqueta cuando no hay ninguna configurada.

## V0.21.64 · Relación explícita entre adjuntos y notas

- Guardar una foto o un archivo suelto (sin convertirlo en nota), o una tarea sin fecha, mostraba un mensaje fijo sin ningún dato real («Guardado — La entrada se ha guardado en tu conversación»). Ahora muestra el tipo, la descripción real y la clasificación (motivo, categoría, relación) que se acaba de elegir.
- La ficha de un adjunto (Galería/Archivos) ya dice explícitamente con qué está relacionado: si pertenece a una nota, muestra su título, contenido y estado; si no, muestra la persona/cliente/proyecto elegido al clasificarlo, o «Sin nota ni persona relacionada» cuando no se indicó ninguna.
- El listado de Galería/Archivos añade un indicador «📝 Nota vinculada» junto a cada adjunto que pertenece a una nota, visible de un vistazo sin tener que abrir la ficha.

## V0.21.63 · Fichas del Dietario y botón de acciones rápidas

- Abrir un aviso desde el Dietario cerraba su ficha solo a los 1.8 segundos: reutilizaba `showEntryAction`, pensada para una confirmación justo tras crear algo, no para repasar una entrada que ya existía. Nueva ficha persistente (`showDietarioDetail`) sin autocierre para eventos, avisos y el resto de tipos.
- Abrir un adjunto (foto o archivo) desde el Dietario mostraba el mensaje genérico «La entrada se ha guardado en tu conversación», que no era cierto. Ahora abre la ficha real ya existente del adjunto (la misma de Galería y Archivos).
- La pulsación larga para el menú rápido (marcar como hecho/eliminar) no era fiable en dispositivos táctiles reales: el gesto de scroll de la lista competía con el temporizador. Se sustituye por un botón «⋮» siempre visible en cada línea.

## V0.21.62 · Corrección de filtros del Dietario

- Los chips de periodo y tipo del Dietario no hacían nada al tocarlos: el manejador genérico de filtros de la conversación se ejecutaba después y sobrescribía su `onclick`, además de vaciar el estado «activo» de todos los chips `.filter` del documento en cada clic. Los chips del Dietario pasan a tener su propia clase y su propio contenedor con delegación de eventos, como ya hacían Notas y Galería.
- La fila de filtros por tipo se recortaba sin poder desplazarse cuando no cabían los cinco chips (Todo, Eventos, Avisos, Notas, Adjuntos); `.library-filters` gana desplazamiento horizontal.
- Pulsación larga sobre una línea del Dietario: abre un menú rápido para marcar como hecho/reabrir o eliminar la entrada sin tener que abrir antes su ficha completa.

## V0.21.61 · Dietario: agenda unificada por día

- Nuevo icono «Dietario» en la cabecera, independiente del icono «Calendario» (antes «Agenda»): agrupa por día los eventos de Calendar, avisos, notas y adjuntos ya guardados en Firestore, con una sección final «Sin fecha» para lo que no tiene fecha asignada.
- Filtros por periodo (Hoy, Esta semana, Todo) y por tipo de elemento (Eventos, Avisos, Notas, Adjuntos). Cada línea abre la ficha real ya existente de esa entrada: el Dietario no crea datos nuevos ni duplica los modales existentes, solo los agrupa por fecha.
- El icono «Calendario» (🗓️) conserva exactamente su comportamiento anterior (consulta directa de Calendar); solo cambia su etiqueta para no confundirse con el nuevo Dietario.
- Vive por completo en el cliente: nuevo módulo `js/dietario.js` con la lógica de agrupación, cubierto por `tests/dietario.test.mjs` e incluido en `integration-gate`.

## V0.21.60 · Corrección del arranque

- Se corrige el cierre de la acción «Añadir nota» en la ficha de Galería y Archivos, cuyo error de sintaxis impedía retirar la pantalla de carga en ordenador y móvil.
- El flujo se comprueba además con el motor real de Chrome para detectar errores que no reprodujo el análisis de Node.

## V0.21.59 · Notas enlazadas con fotos y archivos

- El editor de notas permite añadir fotos y documentos desde el selector del dispositivo.
- Los adjuntos de una nota aparecen también en Galería o Archivos con la misma clasificación y relación.
- La ficha de una foto o archivo permite añadirle una nota completa; la entrada pasa a estar disponible también en Notas sin duplicar el adjunto.
- Las fichas y tarjetas de notas muestran sus adjuntos enlazados.

## V0.21.58 · Biblioteca de notas y fichas de adjuntos

- Notas abre una biblioteca propia con búsqueda y filtros por estado y categoría.
- Cada nota puede abrirse, reclasificarse, marcarse como hecha o borrarse desde esa biblioteca.
- Ver ficha en Galería y Archivos muestra el contexto real del adjunto y permite clasificar imágenes antiguas o modificar su clasificación.

## V0.21.57 · Contexto de adjuntos y Agenda

- Al elegir una foto o un archivo, Angeli pregunta para qué se guarda, su categoría y su relación opcional con una persona, cliente, proyecto o evento.
- La clasificación se sincroniza con la entrada en Firestore y reutiliza las categorías configurables de Notas.
- La galería, el buscador y las fichas muestran el motivo y la relación para que cada adjunto pueda localizarse y entenderse después.
- La cabecera incorpora Agenda y consulta directamente los próximos eventos de Calendar.

## V0.21.56 · Avisos móviles puntuales en segundo plano

- Los avisos Web Push se envían con urgencia alta para que Android pueda despertar la PWA cuando el móvil está en reposo.
- La entrega conserva un día de vigencia si el dispositivo está temporalmente sin conexión.

## V0.21.55 · Cabecera funcional

- La cabecera sustituye los accesos sin uso de enviar y buscar por cuatro secciones directas: Galería, Archivos, Notas y Recordatorios.
- Galería y Archivos abren la biblioteca con el filtro correspondiente; Notas abre todas las notas y Recordatorios muestra los pendientes.
- El logotipo permanece a la izquierda y Ajustes a la derecha, con una distribución compacta para móvil.

## V0.21.54 · Biblioteca de fotos y archivos

- La cabecera incorpora un apartado propio que reúne todos los adjuntos guardados en las entradas de Firestore.
- La biblioteca permite buscar, separar fotos y archivos y filtrar por la categoría de su entrada.
- Las imágenes se amplían dentro de Angeli; cada elemento permite volver a su ficha y compartir el archivo original mediante el menú del dispositivo, con descarga como alternativa.
- Drive continúa siendo la única copia de los archivos y las miniaturas se recuperan solo al abrir la biblioteca.

## V0.21.53 · Avisos fiables con Angeli cerrada

- Las tareas con fecha y hora permanecen activas para el entregador aunque no utilicen el objeto `schedule` de Calendar.
- Una caída temporal de FCM ya no consume el aviso antes de enviarlo; Cloud Tasks puede repetir la misma entrega.
- La puerta obligatoria ejecuta también las pruebas unitarias específicas del servicio de notificaciones.

## V0.21.52 · Enlaces de adjuntos en Google Sheets

- El registro externo incluye ahora en `Archivo` los nombres de fotos y ficheros adjuntos y en `Enlace` sus URL de Google Drive.
- Si una referencia antigua no conserva `webViewLink`, Angeli recompone el enlace de Drive a partir del identificador remoto.
- Las entradas sin adjuntos mantienen ambos campos vacíos.

## V0.21.51 · Banner de escritorio en primer plano

- Cuando Angeli está abierta en un ordenador, el mensaje recibido usa el canal nativo de notificaciones de la ventana para que Chrome y la PWA instalada muestren el banner de macOS.
- En móvil y con Angeli cerrada se mantiene la entrega mediante el service worker.

## V0.21.50 · Prueba dirigida al dispositivo actual

- «Probar aviso» espera a que el navegador obtenga y registre su token antes de enviar la prueba.
- El backend exige ese token y no usa los demás dispositivos como alternativa; una prueba iniciada en el ordenador se dirige únicamente al ordenador.
- Cuando Angeli está abierta, la recepción también se confirma dentro de la PWA, además de solicitar la notificación del sistema.
- Las tareas con fecha y hora se programan al guardarlas y se vuelven a programar cuando cambian los ajustes.
- Las llamadas futuras respetan el selector de llamadas; un seguimiento posterior puede programarse aunque la hora original ya haya pasado.
- Los reintentos de Cloud Tasks no duplican avisos ya entregados y la interfaz informa si alguna reprogramación falla.

## V0.21.48 · Botón visible para probar avisos

- «Probar aviso» permanece visible en Ajustes cuando los avisos están activos, en móvil y ordenador.
- La corrección no modifica permisos, dispositivos registrados ni recordatorios programados.

## V0.21.47 · Avisos propios de Angeli

- Cada instalación móvil o de escritorio puede activar sus avisos desde Ajustes y enviar una notificación de prueba.
- Los recordatorios confirmados conservan su evento y aviso de Google Calendar y programan además una notificación propia de Angeli mediante FCM y Cloud Tasks.
- Modificar, completar o cancelar el recordatorio actualiza o retira la entrega pendiente; el backend descarta tareas antiguas antes de enviar.
- Los tokens de dispositivo y la programación permanecen en la base `angelifirebase`; la entrega acepta únicamente la identidad de servicio dedicada.

## V0.21.46 · Título y contenido de notas

- La ficha usa el contenido interpretado de la nota, sin copiar la orden de creación cuando hay detalle disponible.
- El respaldo elimina la fórmula de creación y la categoría del contenido. Si el título repite la orden o faltan datos, pide completarlos en el editor antes de confirmar el guardado.
- Modificar contenido mantiene alineados el texto de la nota y el detalle interpretado.
- Regresión cubierta en las pruebas del coordinador; comprobación móvil pendiente con la frase original del usuario.

## V0.21.45 · WhatsApp preparado desde Contactos

- Angeli entiende peticiones naturales como «Envía un WhatsApp a Monse diciendo…» y mantiene la conversación si falta el destinatario o el mensaje.
- Reutiliza la conexión existente de Google Contacts, permite elegir entre varios teléfonos y corregir el texto antes de salir de Angeli.
- Abre WhatsApp mediante su enlace oficial con el mensaje escrito; el envío final siempre lo confirma la persona dentro de WhatsApp y Angeli no afirma que se haya enviado.
- Se añade el acceso directo «💬 WhatsApp» sin introducir otra cuenta, OAuth, secreto ni servicio externo.
- La puerta automática cubre extracción, conversación, números españoles e internacionales, duplicados, URL codificada y textos de confirmación.

## V0.21.44 · Conexiones comprobadas al abrir

- Al abrir Angeli se validan realmente la sesión, Contactos, Calendar y Drive; un secreto guardado ya no basta para afirmar que están conectados.
- El menú distingue conexión comprobada, reconexión necesaria, permisos insuficientes y fallo temporal.
- Si alguna comprobación falla aparece un único modal con el detalle y acceso a Conexiones; si todo está bien no aparece nada.
- Las comprobaciones se repiten al volver a la aplicación o recuperar la red, sin abrir ventanas OAuth automáticamente.
- Los errores de una acción identifican la integración afectada y no confunden un resultado vacío con una desconexión.
- Drive comprueba su grant y su API sin crear archivos; la carpeta y la subida reales siguen cubiertas por P06 en la puerta de integración.

## V0.21.43 · Botones uniformes en agenda

- «Ver» y «Anular» ocupan una fila inferior de dos columnas iguales, incluso con títulos largos.
- La fixture de 40 citas comprueba automáticamente la geometría real y el scroll al abrirse en un navegador.

## V0.21.42 · Consultas directas de notas y recordatorios

- «Ver las notas que tenemos hechas» abre las notas completadas, no las pendientes.
- «Ver recordatorios pendientes», «mis recordatorios» y la petición breve «recordatorios» se interpretan siempre como consultas y nunca como notas nuevas.
- Una consulta sin coincidencias responde claramente que no hay recordatorios pendientes.

## V0.21.41 · Gestor flotante de notas, recordatorios y agenda

- Las consultas abren un listado profesional, desplazable y seleccionable; cada elemento conduce a su ficha completa.
- Las notas permiten editar, marcar como hechas o pendientes y borrar con confirmación.
- Los recordatorios permiten modificar título, fecha, hora, ubicación y descripción, completar o cancelar, sincronizando el cambio con Calendar.
- Los eventos de agenda muestran todos sus campos y permiten modificarlos o anularlos desde la misma ficha.
- «Este mes», «últimos 30 días» y «próximos 60 días» aplican intervalos reales a notas y recordatorios.

## V0.21.40 · Ubicación editable en Calendar

- Todos los modales de creación de Calendar permiten añadir o cambiar la ubicación antes de guardar.
- La ubicación continúa siendo opcional: Angeli no añade una pregunta innecesaria cuando no se dicta.
- La ficha muestra siempre el campo, incluso cuando todavía está vacío, y conserva el valor en el payload real de Calendar.

## V0.21.39 · Preguntas siempre en español

- Angeli genera en la propia PWA las preguntas de seguimiento correspondientes al dato que falta.
- Una pregunta devuelta por Gemini en otro idioma ya no llega literalmente al usuario.
- La prueba de conversación cubre título, fecha, hora, ubicación y contacto pendientes.

## V0.21.38 · Peticiones normales restauradas

- Las órdenes escritas o dictadas sin usar un acceso directo vuelven a procesarse con normalidad.
- Las utilidades de accesos directos aceptan explícitamente la ausencia de etiqueta y no intentan leer `action` de un valor nulo.
- Una prueba reproduce la regresión que bloqueaba consultas y otras peticiones normales tras V0.21.37.

## V0.21.37 · Fecha y hora editables

- Los modales de evento, recordatorio y evento con aviso permiten corregir fecha y hora antes de guardar en Calendar.
- Un recordatorio actualiza la fecha real de su aviso, no solo el texto mostrado.
- Al mover un evento con aviso vinculado se conserva automáticamente la antelación existente del aviso.

## V0.21.36 · Accesos directos operativos

- Los seis accesos incluidos conservan la intención elegida aunque la IA devuelva otra clasificación.
- Los accesos antiguos del dispositivo se enriquecen automáticamente, sin obligar a recrearlos.
- Recordatorio, evento y cancelación preparan una orden explícita antes del dictado.
- Hoy, Próxima semana y Llamar contacto ejecutan directamente la consulta necesaria sin una tarjeta intermedia.
- Las pruebas recorren los seis accesos, la migración heredada y la ejecución directa de Calendar y Contactos.

## V0.21.35 · Ciclo completo de notas

- Las consultas muestran acciones para editar, completar o reabrir y borrar cada nota.
- «Notas pendientes», «notas hechas» y «todas las notas» consultan el estado solicitado sin crear otra entrada.
- Editar vuelve al mismo listado; completar o reabrir actualiza Firestore y refresca los resultados.
- Borrar exige confirmación, elimina la nota compartida y retira sus adjuntos de Drive cuando existen.
- Una prueba recorre creación, edición, finalización, consulta de hechas, reapertura y borrado.

## V0.21.34 · Categorías inteligentes

- La IA recibe las categorías y tipos de relación configurados por la cuenta antes de interpretar una nota.
- «Anota en Bodas…» asigna la categoría personalizada `Bodas` y no la duplica como relación.
- «Relaciona esta nota con…» conserva su significado de relación; ambas expresiones tienen pruebas de regresión independientes.
- El contrato del intérprete admite identificadores personalizados validados sin volver a limitarse a las opciones originales.

## V0.21.33 · Ajustes de notas

- Ajustes incorpora una sección propia para administrar categorías y tipos de relación.
- Las opciones pueden crearse, renombrarse y eliminarse; si están usadas, Angeli avisa y reasigna las notas afectadas de forma explícita.
- La ficha de una nota usa inmediatamente la configuración personalizada.
- La configuración pertenece a la cuenta y se sincroniza mediante `users/{uid}/settings/notes` en la base `angelifirebase`.

## V0.21.32 · Confirmación real de notas

- Una nota nueva permanece como borrador y no llega a Firestore ni a Google Sheets hasta pulsar `Guardar nota`.
- La ficha previa muestra título, contenido, categoría, relación, motivo y etiquetas.
- `Modificar` permite corregir todos esos campos y regresar a la ficha antes de confirmar.
- Cancelar descarta el borrador y limpia sus posibles adjuntos remotos, sin dejar una entrada oculta.

## V0.21.31 · Notas clasificadas y consultables

- Las notas conservan un título útil, ámbito, relación opcional, motivo y hasta cinco etiquetas sin exigir datos para poder guardarlas.
- Angeli consulta las notas por asunto, texto, persona, cliente, proyecto, evento o etiqueta, sin crear una nota nueva con la propia pregunta.
- Firestore sincroniza la clasificación entre dispositivos y Google Sheets sigue recibiendo cada nota mediante el contrato ya existente, sin cambiar esa integración.
- El modal y las tarjetas muestran la clasificación; las pruebas automáticas cubren creación, serialización, filtros y consultas naturales.

## V0.21.30 · Cambios externos de avisos

- Al consultar recordatorios, Calendar vuelve a ser la referencia efectiva de título, descripción, fecha y hora.
- Los cambios realizados directamente en Google Calendar se guardan en Firestore y se reflejan en móvil y escritorio.
- `P03-external-update` modifica un aviso real fuera de Angeli y comprueba la reconciliación completa antes de limpiar la prueba.

## V0.21.29 · Avisos naturales con hora pendiente

- Reconoce «avísame» y «tienes que avisarme» como variantes de un aviso vinculado.
- Si el evento tiene día pero no hora, conserva toda la operación y pregunta solamente la hora.
- La respuesta horaria completa el evento y el aviso sin perder título, ubicación, tarea ni antelación.
- P05 real reproduce la orden de discomóvil en el Complejo San Marcos de Gandía.

## V0.21.28 · Cancelación conjunta de evento y aviso

- Al cancelar un evento creado con aviso vinculado, Angeli elimina también ese aviso de Calendar.
- Las búsquedas de modificación o cancelación no muestran el aviso vinculado como otro evento principal.
- P05 real comprueba la relación, la cancelación de ambos recursos y la ausencia del aviso residual.

## V0.21.27 · Ubicación y contexto del aviso vinculado

- Corrige el evento con aviso vinculado para separar siempre el recinto del título.
- El aviso anterior incluye el evento y la ubicación para ser comprensible fuera de Angeli.
- La confirmación muestra la ubicación aunque falte y permite añadirla o cambiarla por voz o texto.
- Amplía P05 con la frase real del Complejo San Marcos de Gandía y validación en Calendar.

## V0.21.26 · Evento con aviso vinculado

- P05 entiende en una sola frase un evento principal y «recuérdame N días
  antes…», conservando título, fecha, hora y ubicación del evento junto al
  título y momento del aviso anterior.
- El modal enseña ambos elementos y los confirma con una sola acción. Calendar
  crea los dos relacionados; si el aviso falla, Angeli retira el evento para
  no dejar una operación a medias.
- La edición del título o descripción actúa sobre el evento principal y
  «Cambiar aviso» actúa solo sobre la tarea anterior. Las acciones del aviso no
  se confunden con órdenes de modificar el evento y se respetan horas de mañana
  indicadas expresamente.
- Si Calendar crea el evento pero también falla su retirada compensatoria,
  Angeli conserva su ID y muestra el estado parcial para que pueda recuperarse.
- El vínculo queda registrado en las propiedades privadas del aviso y en la
  entrada sincronizada de Firestore. Las consultas de recordatorios incluyen
  también estos avisos vinculados.
- `P05-linked` crea y lee los dos elementos en Calendar real aislado, comprueba
  su relación y los elimina al terminar. Cada ejecución usa IDs nuevos para
  que Calendar no rechace una repetición tras haber borrado la prueba anterior.

## V0.21.25 · Objetivo semántico al modificar

- «Cámbiame la hora con María» busca por `María`, no por la expresión literal
  `hora con María`, y puede localizar eventos como «Quedada con María».
- La PWA separa de forma general el campo que se modifica —hora, fecha, día,
  ubicación, lugar o título— del identificador estable del evento.
- La misma normalización se aplica al objetivo de Gemini, al respaldo local y
  en la frontera de búsqueda de Calendar para que un error de formulación no
  vuelva a producir una consulta vacía.
- P11 reproduce la frase real contra Calendar aislado, encuentra el evento, lo
  modifica y lo elimina automáticamente al terminar.

## V0.21.24 · Cancelación por persona

- «Anula cita con Miguel» encuentra también eventos titulados «Quedada con
  Miguel»: la búsqueda usa la persona y no exige que Calendar conozca los
  sinónimos de Angeli.
- La normalización cubre cita, quedada, reunión, llamada, cena, comida, evento,
  aviso y recordatorio sin perder la confirmación previa al borrado.
- La IA vuelve a mandar sobre el objetivo semántico: las protecciones locales
  conservan cancelar/modificar y su confirmación, pero ya no sustituyen
  `Miguel` por la frase literal dictada.
- `P04-name` reproduce el caso contra Calendar real y elimina todos sus eventos
  aislados al terminar; `P11` hace lo mismo con «cámbiame la hora de Miguel».

## V0.21.23 · Descripciones sincronizadas

- Firestore conserva `calendarDescription`; ya no desaparece entre la edición
  del modal y la creación del evento en Google Calendar.
- La misma prueba de ida y vuelta confirma que la descripción de los
  recordatorios permanece dentro de su programación.
- La serialización compartida pasa a un módulo puro con prueba automática para
  impedir que una futura lista de campos vuelva a descartar estas descripciones.

## V0.21.22 · Ficha completa de Calendar

- Eventos y recordatorios enseñan antes de guardar el título exacto, la fecha y
  hora, la ubicación separada y la descripción que recibirá Calendar.
- Si los datos dictados ya están completos, el camino normal sigue necesitando
  únicamente confirmar «Añadir» o «Programar».
- El mismo modal permite cambiar el título o añadir/cambiar una descripción por
  voz o texto, sin abandonar la operación activa.
- Los avisos programados guardan también ubicación y dejan de usar la frase
  original como descripción oculta.
- Se automatiza la igualdad entre la ficha confirmada y el payload real de
  Calendar para eventos y recordatorios.

## V0.21.21 · Calendar reconciliado

- Las consultas de recordatorios comprueban en Google Calendar si sus avisos
  vinculados siguen existiendo antes de mostrarlos como pendientes.
- Un evento borrado directamente desde Calendar deja de aparecer activo en
  Angeli y el cambio se replica entre dispositivos mediante Firestore.
- Los fallos técnicos no se confunden con borrados: se conserva el aviso y se
  informa de que Calendar no pudo comprobarse.
- Se añaden pruebas PWA, backend y `P03-external` contra Calendar aislado.

## [0.21.20] - 2026-08-27

- «Cámbiame la hora de llamar a Miguel» tiene prioridad como modificación de
  un recordatorio existente y nunca abre el flujo de llamada inmediata.
- Se amplían las variantes flexionadas con pronombre: cámbiame, modifícame,
  pásame, muéveme, retrásame, adelántame y reprográmame.
- La instrucción del intérprete Gemini explicita que «llamar» puede describir
  el evento objetivo y no debe ocultar la orden principal de cambio.
- Protección local adicional: una clasificación errónea de la IA como
  `contact.call` se corrige antes de presentar cualquier acción.

## [0.21.19] - 2026-08-26

- Las órdenes para pasar, cambiar, mover, retrasar, adelantar o reprogramar
  recordatorios existentes aceptan frases naturales y separan el objetivo de
  la nueva fecha u hora.
- Si falta el nuevo momento, la conversación permanece abierta y una respuesta
  breve como «a las once» completa la misma modificación.
- Angeli busca automáticamente las coincidencias en Calendar, permite elegir
  cuando hay varias y, después de modificar la seleccionada, actualiza también
  la fecha y hora del recordatorio guardado en Angeli.
- Pruebas automáticas del lenguaje flexible, continuidad conversacional,
  búsqueda normalizada y sincronización del recordatorio seleccionado.

## [0.21.18] - 2026-08-26

- Los borradores y preguntas conversacionales incluyen un micrófono propio en
  el modal; no es necesario recurrir al micrófono del teclado del teléfono.
- El teclado deja de abrirse automáticamente y el modal se adapta al viewport
  visible para mantenerse por encima del teclado o del panel de dictado.
- El botón del modal muestra cuándo Angeli está escuchando. Prueba automática
  del control de voz, ausencia de autofoco y contrato visual móvil.

## [0.21.17] - 2026-08-26

- «Ya he llamado a Miguel» vuelve a encontrar recordatorios programados aunque
  su conversación de creación ya esté cerrada.
- Completar un recordatorio retira primero su aviso de Google Calendar y solo
  después lo marca como hecho en Angeli. Si Google falla, ambos quedan pendientes.
- P03 comprueba el orden de la operación localmente y elimina un aviso real en
  el Calendar aislado del arnés.

## [0.21.16] - 2026-08-26

- Las consultas de agenda recorren todas las páginas devueltas por Calendar; dejan de quedar cortadas en 20 eventos.
- Un límite defensivo convierte una paginación anómala en error visible, nunca en un falso listado completo.
- P10 fuerza dos páginas reales en Calendar de pruebas; el modal de 40 eventos conserva scroll, Ver, Anular y Cerrar.

## [0.21.15] - 2026-08-26

- «Llamar a Miguel» sin tiempo explícito deja de convertirse por defecto en recordatorio aunque la IA pida una fecha.
- La tarjeta permite Llamar ahora, Crear recordatorio o Agendar llamada. Solo las dos últimas piden fecha/hora, reutilizando la misma entrada.
- Pruebas de interpretación IA/fallback, llamadas futuras y continuidad al elegir programar. Sin cambios en conexiones ni APIs.

## [0.21.14] - 2026-08-26

- Cada resultado de una consulta permite Ver y Anular el evento elegido.
- El detalle vuelve a la misma agenda. Anular conserva la confirmación existente; solo tras éxito se consulta de nuevo y se actualiza el recordatorio asociado.
- Doble pulsación bloqueada durante la cancelación. Rechazar o fallar no marca el evento como cancelado.
- Pruebas automáticas de botones/ID, detalle/vuelta, cancelación/refresco y rechazo/error. No cambia OAuth, Calendar API ni Firestore.

## [0.21.13] - 2026-08-26

- Los listados largos se desplazan dentro del emergente sin sacar el cierre
  de la pantalla. No cambia las acciones ni las búsquedas de agenda.
- Fixture visual de 40 eventos y prueba automática del contrato de estilos.

## [0.21.12] - 2026-08-26

- Revisión del mismo PR de cancelación: si no hay coincidencias en los próximos
  90 días, se informa del límite y se permite buscar otra fecha dentro del modal.
  No se exige fecha al inicio ni se presenta el rango vacío como ausencia global.

## [0.21.11] - 2026-08-26

- Cancelar por nombre busca directamente en Calendar sin exigir fecha ni hora.
- «No lo sé» mantiene una cancelación activa; no la convierte en una lista de consulta sin acciones.
- Las consultas de recordatorios permiten elegir uno y confirmar su cancelación.
- El borrado confirmado desde Angeli marca cancelado el recordatorio enlazado;
  no implementa aún reconciliación de borrados externos.
- Regresión automática del coordinador y selección/confirmación visual; P04-name
  crea tres llamadas en Calendar real, busca por nombre y cancela solo una.
- Sin cambios en OAuth, permisos, Firestore ni las integraciones existentes.

## [0.21.10] - 2026-08-26

- Se acepta la hora Gemini HH:MM:00 normalizándola a HH:MM, sin alterar su
  valor. Segundos no nulos y horas imposibles siguen rechazándose.
- Evidencia completa y muestra de regresión documentadas para BUG 4.
- Test del endpoint (503 antes / 200 después) y P05-model-time con Calendar
  real, además de pruebas negativas y límites de hora.

## [0.21.9] - 2026-08-26

- `Pasado mañana` suma dos días, antes de reconocer `mañana`. La expresión
  `de la mañana` no impone por sí sola un día futuro.
- Las fechas relativas explícitas de recordatorios se contrastan con la
  referencia actual, incluso si la IA propone incorrectamente el día siguiente.
- Pruebas fijas de días, límites de mes/año y P05-relative en Calendar real.
- Evidencia del formato de hora de Gemini documentada antes de corregirlo,
  en `docs/BUGS-2026-08-26.md`; su arreglo irá en un PR separado.

## [0.21.8] - 2026-08-26

### Corregido

- Las llamadas programadas recuperan el nombre del título interpretado o del
  dictado cuando falta `contactName`; modal y Calendar comparten el título.
- Calendar conserva también la instrucción original en la descripción.
- Regresión P05-summary: constructor PWA con transcripción y respuesta IA
  parcial controladas, creación y lectura en Calendar real de pruebas.
- Documentada la falta de reconciliación con cambios externos de Calendar;
  no se modifica la sincronización en esta versión.

## [0.21.7] - 2026-08-26

### Corregido

- `¿Qué recordatorios tengo de Miguel?` consulta los recordatorios pendientes
  guardados en Angeli y muestra el que sigue activo después de completar otro.
- La consulta no crea una nota, no incluye recordatorios terminados y no se
  desvía hacia Google Calendar.
- Un recordatorio programado sigue pendiente aunque su conversación esté cerrada.

### Pruebas

- Añadida una regresión posterior a P03 con dos recordatorios de Miguel: uno
  completado y otro pendiente, verificando que solo se recupera el pendiente.
- Cobertura de consulta general, coincidencia por persona, estados cerrados y
  respaldo de solo lectura cuando falla la IA (proveedor simulado).

## [0.21.6] - 2026-08-24

### Añadido

- `Ya he llamado a Miguel` completa el pendiente existente y no crea una nota
  ni una tarea duplicada.
- Si hay varios pendientes coincidentes, Angeli muestra las opciones y exige
  elegir uno; si no encuentra ninguno, lo indica sin alterar los datos.

### Pruebas

- P03 queda cubierto en la puerta automática para coincidencia única,
  ambigüedad, exclusión de entradas terminadas y ausencia de coincidencias.

## [0.21.5] - 2026-08-24

### Corregido

- Una llamada con una referencia temporal parcial ya no abre el marcador de
  inmediato: `llama a Miguel mañana` pregunta la hora y `llama a Miguel a las
  siete` programa la próxima ocurrencia.
- La llamada sin fecha ni hora conserva el comportamiento inmediato.

### Pruebas

- La puerta automática incorpora pruebas del coordinador conversacional para
  P01/P02, recordatorios completos, cierre de interacciones y llamadas futuras.
- Recorrido P01/P02 comprobado también en la PWA publicada con la IA real,
  sin errores de consola y sin ejecutar la acción externa de prueba.

## [0.18.4] - 2026-08-21

### Fixed

- Al abrir la PWA se intenta recuperar de forma silenciosa la identidad temporal necesaria para consultar las conexiones persistentes de Google. Contactos y Calendar no vuelven a solicitar sus permisos si sus autorizaciones siguen guardadas en Secret Manager.
- Los estados de Ajustes distinguen entre una conexión realmente confirmada, una sesión que se está comprobando y una identidad que necesita confirmarse; ya no afirman erróneamente que una integración está desconectada.
- Los recordatorios entienden horas como `a las 2 y 15 minutos` y `a las dos y cuarto`. Para un recordatorio sin día explícito se usa la próxima ocurrencia de esa hora; la tarjeta siempre solicita confirmación antes de crear el aviso de Calendar.
- Si Calendar no puede crear un evento o aviso, la entrada local conserva un estado de error reintentable en lugar de aparentar que quedó programada.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.18.4 · Sesiones y avisos`.

### Pending validation

- Pendiente de comprobar en Android la recuperación silenciosa tras cerrar y abrir la PWA, y la programación confirmada de un aviso en Google Calendar.

Este archivo registra los cambios funcionales relevantes de Angeli Secretaria. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Unreleased]

### Added

- Arnés de integración real aislado para Calendar y Drive. Usa secretos de prueba independientes (`angeli-test-google-*-grant`), la cuenta de pruebas y datos con prefijo borrable; no accede a las autorizaciones de producción.
- Separación estricta del cliente OAuth del arnés: las rutas y el runner de pruebas exigen `ANGELI_TEST_GOOGLE_WEB_CLIENT_ID` y no reutilizan el Client ID de producción.
- Página de autorización exclusiva de pruebas y rutas de Cloud Run desactivadas por defecto. Solo al habilitarlas expresamente pueden guardar los tres grants de prueba; las sesiones personales de Contactos, Calendar y Drive no se consultan ni se modifican.
- Puerta automática de integración para Pull Requests: autentica GitHub Actions mediante Workload Identity Federation, ejecuta el arnés real y conserva su informe como artefacto. Los PR de ramas `codex/*` se fusionan automáticamente solo después de superar el check obligatorio.

### Changed

- La documentación y las reglas de proyecto exigen comprobar de extremo a extremo los recursos externos y ejecutar el arnés aislado cuando esté configurado antes de declarar validado un cambio funcional de integración.

### Verified

- Ejecución real aislada en la cuenta de pruebas: P04 (cancelación), P10 (consulta), P11 (modificación de hora) de Calendar y P06 (subida/eliminación en Drive). Los recursos generados usan el prefijo `ANGELI-TEST-*` y se eliminan al finalizar.

## [0.21.4] - 2026-08-24

### Fixed

- Una conversación pendiente ya no intercepta órdenes nuevas escritas o dictadas en el compositor principal. Por ejemplo, una confirmación antigua sobre Pepe no puede convertir «¿Qué tengo mañana?» ni «Llama a Montse» en una respuesta a esa operación.
- Solo el campo `Continuar` del popup asociado a una pregunta puede completar esa misma interacción.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.21.4 · Flujo aislado`.

## [0.21.3] - 2026-08-24

### Fixed

- Las preguntas de rango a Calendar, como `¿Qué tengo mañana?`, ya no envían la frase completa como filtro textual de título. Se consultan únicamente por el intervalo solicitado.
- Las búsquedas de modificación o cancelación limpian el verbo de orden y los datos temporales del texto antes de enviarlo como coincidencia de Calendar.
- Un fallo de autorización o de API de Calendar se informa como error de integración, no como si la agenda estuviera vacía.

### Changed

- Creación, consulta, modificación y borrado confirman explícitamente el mismo calendario efectivo: `primary`.
- Identificación visible y caché PWA actualizadas a `V0.21.3 · Calendar fiable`.

## [0.21.2] - 2026-08-24

### Fixed

- Las confirmaciones finales de éxito se muestran brevemente y se cierran solas; ya no se exige un toque adicional para cerrar una acción de Calendar, un aviso programado o un guardado simple.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.21.2 · Flujo directo`.

## [0.21.1] - 2026-08-24

### Fixed

- Cuando Angeli necesita un dato, la misma tarjeta de conversación conserva la pregunta, el campo de respuesta, el micrófono, `Continuar` y `Cancelar`; ya no obliga a cerrar una ventana y abrir otra para responder.
- La tarjeta no se cierra al tocar accidentalmente el fondo durante una interacción activa.
- Los mensajes y tarjetas dejan de exponer detalles técnicos de interpretación local o IA; Angeli explica únicamente cuándo necesita confirmar un dato antes de actuar.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.21.1 · Conversación fluida`.

## [0.21.0] - 2026-08-24

### Added

- Conversación persistente para completar una misma instrucción en varios turnos: Angeli conserva intención, datos recogidos y la pregunta pendiente dentro de la entrada sincronizada.
- Nuevo módulo `js/conversation.js`, dedicado a resolver, cancelar o completar interacciones sin mezclar esta lógica con la interfaz o las integraciones.

### Changed

- La IA recibe el contexto limitado de la interacción activa. Respuestas como una hora o una confirmación completan la misma operación en lugar de crear una nota independiente.
- Los accesos directos, texto y dictado entran por el mismo coordinador de conversación.
- Las acciones externas completadas o canceladas cierran su interacción activa para no bloquear la siguiente petición.
- Identificación visible y caché PWA actualizadas a `V0.21 · Conversación`.

### Fixed

- Los fallos de IA, JSON inválido o baja confianza dejan un aviso claro de respaldo local; ya no se presentan silenciosamente como una interpretación correcta de IA.

### Pending validation

- Requiere desplegar el backend Cloud Run y comprobar en Android/móvil-escritorio una instrucción incompleta, su respuesta posterior, confirmación, cancelación y el respaldo visible cuando falle IA.

## [0.20.8] - 2026-08-21

### Fixed

- Las fotos y archivos dejan de crearse con la cuenta de servicio de Cloud Run, que Google no permite usar como propietaria de archivos en Mi unidad por no tener cuota. Drive se vincula ahora, de forma independiente y persistente, con el Gmail que posee las carpetas.
- La vinculación de Drive solicita únicamente `drive.file`: Angeli puede crear, leer y borrar los adjuntos que ella misma genera, sin acceder al resto de Mi unidad.

### Changed

- Drive deja de considerarse listo solo por tener IDs de carpetas; requiere tanto las rutas fijas como la autorización OAuth persistente de Drive.
- Identificación visible y caché PWA actualizadas a `V0.20.8 · Drive`.

## [0.20.7] - 2026-08-21

### Added

- La animación de Angeli se reutiliza durante todos los estados de trabajo: interpretar, guardar, subir adjuntos y consultar Google. El texto inferior cambia según la operación en curso; las confirmaciones y resultados conservan sus tarjetas sin animación ni bloqueo.

### Fixed

- La pantalla inicial crítica usa el mismo fondo oscuro que la bienvenida y precarga el GIF, evitando el destello blanco entre la apertura de la PWA y la animación.

### Changed

- Identificación visible, fondo nativo y caché PWA actualizados a `V0.20.7 · Animación`.

## [0.20.6] - 2026-08-21

### Added

- Pantalla de bienvenida a pantalla completa con la animación original de Angeli. Se mantiene un mínimo de 2,6 segundos mientras la PWA inicializa sesión y datos, y se retira automáticamente para no bloquear la aplicación si hay un problema de red.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.6 · Bienvenida`.

## [0.20.5] - 2026-08-21

### Fixed

- La PWA apunta explícitamente a la base Cloud Firestore real `angelifirebase`, en lugar de a `(default)`. Las entradas de móvil y escritorio pasan a leer y escribir el mismo registro remoto.
- El estado de sincronización espera la confirmación de las escrituras pendientes de Firestore antes de declarar que los datos están sincronizados.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.5 · Sincronización`.

### Pending validation

- Pendiente de comprobar una entrada de texto creada desde Android y vista en Mac, y otra creada desde Mac y vista en Android, con la misma cuenta Angeli.

## [0.20.4] - 2026-08-21

### Fixed

- Las subidas de fotos y archivos renuevan específicamente el token de Firebase antes de iniciarse, sin alterar Calendar, Contactos o IA.
- El backend diferencia una sesión de Angeli no autorizada de un rechazo de Drive en carga, lectura o borrado de adjuntos; los diagnósticos de Cloud Run ya no atribuyen ambos errores a la carpeta.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.4 · Adjuntos`.

### Pending validation

- Pendiente de desplegar Cloud Run y comprobar desde Android y Mac: una foto, un archivo y la aparición de esa misma entrada en el otro dispositivo.

## [0.20.3] - 2026-08-21

### Fixed

- La confirmación de Firestore ya no mantiene bloqueada la tarjeta de progreso. La sincronización continúa en segundo plano y expone su estado en Ajustes, mientras que la persona puede continuar con la propuesta de Calendar, Contactos o cualquier otra acción.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.3 · Flujo libre`.

## [0.20.2] - 2026-08-21

### Fixed

- Cada envío muestra de inmediato una tarjeta de progreso y bloquea las dos flechas hasta que Angeli termina, evitando pulsaciones repetidas durante la comunicación con el servidor.
- Un adjunto que Drive no puede subir se elimina de la petición fallida para que no bloquee órdenes posteriores de IA, Calendar o Contactos.
- Si un medio ya llegó a Drive pero después falla la interpretación o el guardado remoto, Angeli intenta retirarlo para evitar adjuntos huérfanos.
- Los errores de acceso de medios indican que Drive no puede acceder a la carpeta configurada y dejan un diagnóstico técnico seguro en Cloud Run.

### Changed

- Identificación visible y caché PWA actualizadas a `V0.20.2 · Flujo seguro`.

## [0.20.1] - 2026-08-21

### Fixed

- Al enviar una foto o archivo, Angeli bloquea ambas flechas y muestra un estado de subida hasta que termina; pulsaciones repetidas ya no pueden iniciar varias cargas.
- Los medios se dirigen a carpetas fijas compartidas con la cuenta de servicio de Cloud Run. Se elimina por completo la creación automática de carpetas raíz, de tipo, año o mes.
- Una entrada nueva espera la confirmación de Firestore antes de considerarse guardada. Si falla, el borrador y sus adjuntos preparados permanecen disponibles y el estado de sincronización muestra un diagnóstico útil.

### Changed

- Drive deja de requerir una conexión OAuth en cada dispositivo: el servidor usa la cuenta de servicio compartida en la carpeta raíz de Angeli. Quedan configurados destinos para imágenes, archivos, bandeja, notas de voz y datos, aunque por ahora solo se usan imágenes y archivos.
- Identificación visible y caché PWA actualizadas a `V0.20.1 · Datos y Drive`.

### Pending validation

- Pendiente de desplegar Cloud Run con los IDs de carpetas y comprobar una foto, un archivo y la sincronización de una entrada entre Android y Mac.

## [0.20.0] - 2026-08-21

### Added

- Google Drive como almacenamiento permanente de fotos y archivos nuevos. Cada adjunto se guarda en `Angeli Secretaria/Fotos/<año>/<mes>` o `Angeli Secretaria/Archivos/<año>/<mes>` y la entrada de Firestore conserva solamente su referencia.
- Conexión independiente de Drive mediante el alcance mínimo `drive.file`, con autorización persistente guardada únicamente en Secret Manager.
- Estado visible de sincronización de Angeli y conexión de Drive en Ajustes.

### Changed

- Cloud Firestore pasa a ser la única fuente de verdad de las entradas entre móvil y escritorio. Las notas y blobs heredados del navegador no se leen, no se migran y no se mezclan con los datos remotos.
- La limpieza de dispositivo elimina solo la caché técnica y el borrador local: no borra las entradas ni los adjuntos guardados en la nube.
- El intérprete tolera campos opcionales ajenos a la intención solicitada para evitar descartar una interpretación válida por información inofensiva de Calendar.

### Pending validation

- Pendiente de desplegar Cloud Run y validar en Android y escritorio: conexión única de Drive, foto, PDF, persistencia tras cerrar y abrir, sincronización cruzada y borrado de entrada con adjuntos.

## [0.19.0] - 2026-08-21

### Added

- Firebase Auth como sesión persistente de Angeli y Cloud Firestore como fuente de verdad compartida para las entradas entre móvil y escritorio.
- Migración segura e idempotente de entradas existentes desde `localStorage`: no elimina la copia local ni los medios IndexedDB mientras no se confirme su sincronización.
- Reglas de Firestore que restringen cada entrada a su usuario autenticado.

### Changed

- Cloud Run valida tokens de Firebase del correo propietario autorizado mediante `ALLOWED_FIREBASE_EMAILS`; ya no depende del token efímero de Google Identity Services para interpretar una orden o consultar el estado de las conexiones.
- Ajustes separa la sesión persistente de **Cuenta Angeli** de las conexiones independientes de Contactos y Calendar.

### Pending validation

- Pendiente de desplegar reglas de Firestore y backend, y de validar en Android/escritorio la sesión persistente, la migración y la sincronización en tiempo real.

## [0.18.3] - 2026-08-21

### Fixed

- Se evita leer dos veces el cuerpo de una autorización OAuth de Contactos o Calendar, que causaba el error `JSON de entrada no válido` tras conectar IA.

## [0.18.2] - 2026-08-21

### Fixed

- Se valida el retorno OAuth contra la lista de orígenes permitidos en lugar de compararlo directamente con un encabezado del navegador; corrige el `400` que impedía vincular Contactos y Calendar.
- La primera vinculación de Contactos o Calendar solicita consentimiento y selección de cuenta, necesarios para conservar la autorización segura en Secret Manager.

## [0.18.1] - 2026-08-21

### Fixed

- Se corrige un error de sintaxis en el módulo de conexiones Google que impedía iniciar el JavaScript de la PWA y dejaba los controles sin responder.

## [0.18.0] - 2026-08-21

### Changed

- Las autorizaciones de Google se preparan para persistir de forma segura en Cloud Run y Secret Manager, separadas para Contactos y Calendar; los refresh tokens no se guardan en el teléfono ni en GitHub.
- La conexión de IA usa el flujo OAuth de código con selector explícito de cuenta, evitando depender exclusivamente de One Tap en Android.

### Pending validation

- Pendiente de validación real en Android tras desplegar Cloud Run: conexión inicial de IA, Contactos y Calendar con cuentas distintas, y persistencia después de cerrar y reabrir la PWA.

## [0.17.0] - 2026-08-21

### Added

- Las acciones futuras usan un modelo local `schedule`: fecha/hora, zona horaria, acción prevista, estado, entrega y referencia de Calendar. Una llamada futura se conserva como acción de llamada pendiente y no abre el marcador al crearla.
- La tarjeta operativa permite confirmar, reintentar, abrir y cancelar un aviso programado sin perder la entrada original.
- Al confirmar, Angeli crea un evento privado y transparente de Google Calendar con aviso emergente a la hora indicada; el identificador y enlace se guardan junto a la acción para evitar duplicados.

### Changed

- El intérprete de IA y el fallback local distinguen una llamada inmediata de una llamada con fecha y hora. Por ejemplo, «Llama a Miguel Ibiza mañana a las nueve» se propone como recordatorio programado; «Llama a Miguel Ibiza» sigue siendo una llamada inmediata.
- La PWA se identifica como `V0.17 · Acciones programadas` y renueva todos los recursos de caché.

### Pending validation

- Pendiente de validación manual en Android: creación, aviso de Calendar, persistencia, apertura y cancelación. La notificación propia de Angeli con la PWA cerrada queda pendiente de un planificador externo autenticado; no se simula como implementada.

## [0.16.6] - 2026-08-21

### Changed

- El compositor inferior usa dos columnas verticales de iconos: adjuntar/dictar a la izquierda y enviar/borrar borrador a la derecha, liberando el espacio central para el texto.
- El acceso directo `Llamar contacto` inicia el borrador con `Llama a ` y el dictado, para que el nombre pronunciado complete una orden de contacto en vez de crear una nota.

## [0.16.5] - 2026-08-21

### Changed

- La tarjeta emergente pasa a ser el espacio operativo principal: conserva el borrador de voz o texto hasta enviar y mantiene las acciones de Calendar y Contactos abiertas hasta completar o cancelar el flujo.
- El micrófono grande permanece disponible durante toda la sesión y la versión de prueba se muestra permanentemente en la cabecera.
- Al buscar un contacto, la PWA solicita la conexión a Contactos solo si hace falta y, tras volver, muestra los teléfonos encontrados dentro de la misma tarjeta para abrir el marcador con un toque.
- Calendar crea el evento después de la confirmación de la tarjeta, sin una segunda confirmación nativa.

### Added

- `styles-flow.css`, hoja acotada al flujo de dictado, tarjeta de trabajo y opciones de contacto.

## [0.16.4] - 2026-08-21

### Fixed

- Se renuevan de forma completa los identificadores de recursos y caché PWA de la interfaz V0.16 para evitar que Android conserve un módulo JavaScript anterior con error de sintaxis y muestre una pantalla sin interacción.
- Se corrige una plantilla HTML sin cerrar en `ui.js`, que impedía cargar todo el JavaScript de la PWA y dejaba la interfaz sin interacción.
- La versión se identifica como `V0.16.4 · Angeli Asistente` en cabecera y Ajustes.
- El Service Worker usa red primero para JavaScript y CSS, con caché únicamente como respaldo sin conexión.

## [0.16.0] - 2026-08-21

### Changed

- La interfaz móvil pasa de una bandeja de formularios a una conversación con Angeli Asistente: cabecera fija, zona central desplazable y compositor fijo inferior.
- El dictado conserva el texto en el borrador hasta que la persona pulsa explícitamente `Enviar`; tras enviar, la propuesta se muestra en una tarjeta emergente antes de ejecutar acciones externas.
- Búsqueda, filtros, conexiones y mantenimiento dejan de ocupar la pantalla principal de forma permanente; se muestran bajo demanda desde búsqueda y Ajustes.
- Se adopta la identidad visual basada en el icono de Angeli y se actualizan manifest, recursos y caché PWA a `V0.16 · Angeli Asistente`.

### Added

- Accesos directos locales para consultas y órdenes recurrentes, con creación manual o por dictado y gestión desde Ajustes.
- `Limpiar vista`, que oculta temporalmente el historial visible sin borrar entradas ni medios guardados.

### Pending validation

- Pendiente de validación manual en Android: dictado interrumpido/continuado, envío explícito, tarjeta emergente, Calendar, Contacts, cámara, fotos, archivos, accesos directos, búsqueda, Ajustes y actualización PWA.

## [0.15.6] - 2026-08-21

### Changed

- Una modificación de Calendar busca el evento existente por el objetivo original, no por la nueva fecha u hora indicada en `changes`.
- Las consultas de agenda pueden conservar un intervalo explícito mediante `rangeStart` y `rangeEnd`; se añade soporte para «esta semana» y «la semana que viene».
- La instrucción estructurada de Gemini refuerza la separación entre título, ubicación, evento objetivo y cambios solicitados.
- Se actualiza la identificación y la caché PWA a `V0.15.6 · Calendario contextual`.

### Pending validation

- Pendiente de validación manual en Android: mover un evento existente a otra fecha, consultar la semana siguiente y crear un evento con recinto/ubicación.

## [0.15.5] - 2026-08-21

### Changed

- Los eventos de Calendar creados desde IA usan el título estructurado devuelto por la interpretación, en lugar de reutilizar todo el texto dictado.
- La instrucción del intérprete distingue explícitamente el título breve del evento de su ubicación física.
- La ubicación se conserva en la entrada y se envía al campo `location` de Google Calendar, que puede mostrarla como enlace de Maps.
- Las entradas existentes con una intención IA guardada recuperan su título estructurado al abrir la aplicación.
- Se añade `calendar.query`: consulta limitada de eventos del calendario principal sin conservarlos localmente.
- Las propuestas de cancelar o modificar buscan eventos coincidentes y muestran cada coincidencia antes de ejecutar la acción.
- Las operaciones de cancelar y modificar solicitan una confirmación final con el título y hora concretos del evento.
- Al cancelar un evento creado por Angeli, su entrada asociada queda marcada como cancelada; al modificarlo, se actualizan sus datos locales conocidos.
- Se actualiza la identificación y la caché PWA a `V0.15.5 · Calendario bidireccional`.

### Pending validation

- Pendiente de validación manual en Android: creación con título/ubicación, consulta, selección de coincidencias, modificación y cancelación real.

## [0.15.3] - 2026-08-20

### Changed

- Una interpretación remota de IA válida pasa a ser la fuente de intención, tipo y datos de la entrada; no se reinterpreta con reglas locales.
- La clasificación local se usa exclusivamente cuando la IA no está conectada, no responde, falla o devuelve una respuesta que no supera la validación estructural.
- Las respuestas parciales pero seguras del modelo se normalizan en el intérprete antes de llegar a la PWA, para evitar perder una orden válida por campos opcionales ausentes.
- La interfaz distingue una propuesta de IA de una clasificación local de respaldo.
- Se actualiza la identificación y la caché PWA a `V0.15.3 · IA prioritaria`.

### Security

- La PWA mantiene una lista cerrada de intenciones, valida los datos recibidos y conserva la confirmación humana antes de cualquier acción sensible. La IA no ejecuta acciones externas directamente.

### Pending validation

- Pendiente de validación manual en Android: creación, modificación y cancelación propuestas por IA; confirmación de acciones sensibles; y mensaje claro cuando se use el respaldo local.

## [0.15.2] - 2026-08-20

### Added

- Conexión opcional y separada de Google para la capa IA, limitada a una credencial de identidad temporal de la sesión.
- Proveedor remoto en `ai.js` que envía únicamente el texto y contexto temporal al intérprete seguro de Cloud Run.

### Security

- La credencial de identidad solo permanece en memoria; no se guarda en `localStorage`, IndexedDB ni GitHub.
- El intérprete remoto valida la identidad y una lista privada de cuentas autorizadas antes de usar Gemini. Si no hay conexión, la identidad caduca o el servicio falla, la PWA usa la clasificación local existente.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.15.2 · IA real`.

### Pending validation

- Pendiente de validación manual en Android: conexión IA con la cuenta autorizada, interpretación de órdenes naturales, fallback sin conexión y conservación de Contactos, Calendar, medios, dictado y Sheets.

## [0.15.1] - 2026-08-20

### Added

- Las propuestas y confirmaciones de creación de eventos muestran la ubicación detectada cuando existe.
- Las entradas de Calendario guardan la ubicación y recuperan la de las entradas V0.15 que solo la tenían dentro de su intención IA.

### Changed

- La creación de eventos de Google Calendar envía el texto detectado al campo oficial `location`, sin geocodificación ni permisos adicionales.
- El extractor local conserva ubicaciones con comas y números, como restaurantes y direcciones.
- Se actualiza la identificación y la caché PWA a `V0.15.1 · Ubicaciones`.

### Pending validation

- Pendiente de validación manual en Android: visualización de ubicación en la confirmación, creación de evento con población/restaurante/dirección y persistencia tras recargar.

## [0.15] - 2026-08-20

### Added

- Capa de interpretación estructurada con proveedor simulado intercambiable, validación de esquema, lista cerrada de intenciones y fallback local.
- Propuestas visibles para crear, modificar o cancelar eventos, llamar, crear tareas y preparar recordatorios.

### Security

- Las intenciones sensibles requieren confirmación y no ejecutan código ni integraciones desde una respuesta del proveedor.
- No se añade ninguna clave, secreto ni llamada a una API de IA.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.15 · IA estructurada`.

### Pending validation

- Pendiente de validación manual en Android con el proveedor simulado; las operaciones reales de actualizar/cancelar Calendar siguen pendientes.

## [0.14.1] - 2026-08-20

### Added

- Detección de fechas naturales: mañana, días de semana y fechas como `28 de agosto`.
- Detección de horas naturales: franja mañana/tarde/noche, medias y cuartos.

### Changed

- La clasificación prioriza recordatorio, tarea y contacto; las entradas restantes con fecha y hora pasan a Calendario.
- Las notas existentes se recalifican únicamente cuando ahora cumplen inequívocamente la regla de Calendario.
- Los títulos de los nuevos eventos eliminan las expresiones temporales detectadas.
- Se actualiza la identificación y la caché PWA a `V0.14.1 · Temporal inteligente`.

### Pending validation

- Pendiente de validación manual en Android con órdenes naturales y creación real de eventos.

## [0.14] - 2026-08-20

### Changed

- Refactor interno a módulos ES: interfaz, almacenamiento, clasificación, temporal, Google, Sheets y coordinación se separan en archivos independientes.
- `index.html` queda como estructura y carga del punto de entrada modular.
- Se actualiza la identificación y la caché PWA a `V0.14 · Arquitectura modular` y se precarga el grafo de módulos en el Service Worker.

### Pending validation

- Pendiente de regresión manual completa en Android; no se añade funcionalidad nueva.

## [0.13.1] - 2026-08-20

### Added

- Controles separados para conectar, cambiar cuenta y desconectar Contactos y Calendar dentro de la sesión actual.

### Changed

- El estado visible ya no mezcla ambas integraciones de Google.
- Una búsqueda de contacto sin conexión muestra una explicación persistente en la entrada.
- Se actualiza la identificación y la caché PWA a `V0.13.1 · Cuentas Google`.

### Security

- Desconectar elimina únicamente los tokens temporales y los resultados de Contactos de la sesión; no revoca permisos concedidos en Google.

### Pending validation

- Pendiente de validación manual en Android con cuentas distintas para Contactos y Calendar.

## [0.13] - 2026-08-20

### Added

- Creación confirmada de eventos de una hora en el calendario principal de Google para entradas clasificadas como Calendario que tengan fecha y hora detectadas.
- Estado local de calendario (`pending`, `synced`, `error`), identificador del evento y enlace de apertura cuando Google lo proporciona.

### Security

- Se solicita de forma incremental únicamente el alcance `calendar.events` al confirmar la creación del evento.
- El token de Calendar permanece solo en memoria y no se persiste en la aplicación.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.13 · Google Calendar`.

### Pending validation

- Pendiente de validación manual en Android con autorización de Google: creación real, ausencia de duplicados y recuperación ante error.

## [0.12.3] - 2026-08-20

### Added

- Hoja de estilos externa `styles.css`, incluida en el precaché de la PWA.

### Changed

- Renovación visual SaaS de cabecera, formularios, filtros, tarjetas, chips, acciones y controles de mantenimiento.
- Se actualiza la identificación y la caché PWA a `V0.12.3 · SaaS UI`.

### Pending validation

- Pendiente de validación visual manual en Android y escritorio.

## [0.12.2] - 2026-08-20

### Added

- Conexión opcional a Google mediante OAuth para buscar por nombre en Google Contacts.
- Búsqueda limitada a nombre y teléfonos mediante People API, con selección explícita cuando hay varias coincidencias o números.

### Security

- Se solicita exclusivamente el alcance `contacts.readonly` al pulsar `Conectar Google`.
- Los tokens de acceso y los resultados de contactos se mantienen solo en memoria; no se persisten en la aplicación ni se envían al endpoint público de Sheets.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.12.2 · Contactos Google`.

### Pending validation

- Pendiente de validación manual en Android con la cuenta autorizada de Google.

## [0.12.1] - 2026-08-20

### Changed

- Se amplía la clasificación de intenciones de llamada y el reconocimiento de teléfonos españoles dictados.

### Validated

- V0.12.1 validada manualmente en Android: teléfono escrito o dictado, clasificación Contacto y apertura del marcador mediante `tel:`.

## [0.12] - 2026-08-20

### Added

- Acciones contextuales para calendario, contactos, tareas y recordatorios.
- Extracción local básica de teléfonos, fecha y hora para preparar acciones futuras.

### Changed

- Se actualiza la identificación y la caché PWA a `V0.12 · Acciones`.

## [0.11] - 2026-08-20

### Added

- Clasificación local automática de las entradas y filtro por tipo.
- Opción de mantenimiento para eliminar explícitamente todos los datos locales de prueba.

### Changed

- Se añade el campo `type` a nuevas entradas y se clasifica/persiste automáticamente en las existentes al abrir la aplicación.
- Se actualiza la identificación y la caché PWA a `V0.11 · Clasificación`.

### Validated

- V0.11 validada manualmente en Android: clasificación de tarea, recordatorio, calendario, contacto, foto y archivo, prioridad de texto sobre adjuntos y persistencia de textos y medios.

## [0.10] - 2026-08-20

### Changed

- V0.10 · IndexedDB validada manualmente en Android.
- Se alinea la identificación visible y la caché PWA en `V0.10 · IndexedDB`.
- Las fotos e imágenes se guardan como blobs en IndexedDB en lugar de Data URLs en `localStorage`.
- Los archivos adjuntos se conservan localmente como blobs y se pueden abrir desde la entrada.
- Las imágenes Data URL existentes se migran de forma segura a IndexedDB al iniciar.

### Validated

- Dictado/texto, cámara, selección de fotos, archivos, persistencia tras actualizar/reabrir, visualización de medios y envío a Google Sheets.

## [0.9] - 2026-08-20

### Added

- Bandeja de entrada de notas con creación, búsqueda, filtros de estado, marcado como hecha/reapertura y borrado.
- Persistencia local de entradas mediante `localStorage`.
- Dictado en español compatible con `SpeechRecognition` y `webkitSpeechRecognition`.
- Captura/selección de imágenes y selección de archivos; previsualización de imágenes y metadatos de archivo en la entrada.
- Envío de los datos de entrada a Google Apps Script/Google Sheets.
- Configuración PWA con manifest, iconos y Service Worker para caché offline.
- Página independiente de prueba de micrófono.

### Known limitations

- El envío a Google se realiza en modo `no-cors`, por lo que el cliente no puede confirmar la respuesta del servidor.
- Imágenes y entradas dependen de la cuota de `localStorage`; los archivos adjuntos no se suben actualmente.
- Las versiones visibles y de caché no están completamente alineadas: la interfaz muestra `V0.9` y manifest/Service Worker usan `0.8.1`.
## V0.21.49 · Configuración completa de avisos Angeli

- Añade un modal en Ajustes para activar, probar y desactivar avisos en cada dispositivo.
- Sincroniza por cuenta el aviso a la hora, la antelación, la repetición posterior y los tipos de entrada.
- Respeta un horario de descanso configurable y permite entregar después los avisos aplazados.
- Reprograma los avisos pendientes al guardar cambios y admite avisos propios para eventos normales de Calendar.
