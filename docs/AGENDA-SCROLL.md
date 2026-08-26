# Listados largos — V0.21.13

Regresión: un modal centrado sin límite de altura desbordaba la pantalla y
ocultaba el botón Cerrar. El documento general no permite desplazamiento.

El modal limita su altura al contenedor y solo desplaza el cuerpo; la cabecera
y las acciones no se encogen. El modal de conversación conserva su estilo.

Prueba visual con 40 eventos ficticios en `tests/agenda-long.html`, viewport
390×844: modal de y=24 a y=820, cierre de y=760 a y=804. El contenido tenía
619 px visibles y 2615 px totales. Tras desplazar, el último evento quedó
visible y Cerrar retiró la clase `show`. No hubo escrituras en Google.

La prueba automática protege las reglas CSS. Las medidas y el desplazamiento
se verificaron con navegador real, no con el test estático de estilos.
