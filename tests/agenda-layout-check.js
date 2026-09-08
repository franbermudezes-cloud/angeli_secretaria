// Comprobación geométrica del listado renderizado; se ejecuta en la fixture.
export async function checkAgendaLayout() {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const rows = [...document.querySelectorAll('#modalBody .agenda-choice')];
  const errors = [];
  if (rows.length !== 40) errors.push('Se esperaban 40 citas');
  for (const [index, row] of rows.entries()) {
    const text = row.querySelector('.agenda-choice-content').getBoundingClientRect();
    const buttons = [...row.querySelectorAll('.agenda-row-actions button')];
    if (buttons.length !== 2) { errors.push(`Fila ${index}: faltan acciones`); continue; }
    const [view, cancel] = buttons.map(button => button.getBoundingClientRect());
    if (Math.abs(view.top - cancel.top) > 1 || Math.abs(view.width - cancel.width) > 1 || view.right > cancel.left || view.top < text.bottom || cancel.right > row.getBoundingClientRect().right) errors.push(`Fila ${index}: acciones desalineadas`);
  }
  const panel = document.querySelector('#modalBody');
  if (panel.scrollHeight <= panel.clientHeight) errors.push('La lista larga debe tener scroll');
  const report = document.createElement('output');
  report.id = 'layoutResult';
  report.textContent = errors.length ? `FAIL: ${errors.join('; ')}` : 'PASS: 40 citas, botones horizontales y scroll';
  document.querySelector('#modalLead').append(report);
}
