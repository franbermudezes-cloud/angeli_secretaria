import { localCalendarCancellation } from '../js/ai.js';
import { resolveConversationTurn } from '../js/conversation.js';
import { buildCalendarSearch } from '../js/google.js';
const interpretation = localCalendarCancellation('Anula llamada a Miguel Ibiza');
if (process.argv[2]) interpretation.target.date = process.argv[2];
const turn = resolveConversationTurn({text:'Anula llamada a Miguel Ibiza',
  interpretation:{...interpretation,missingFields:['date','time']}});
if (turn.interaction.status !== 'pending_confirmation') throw new Error('Cancelación bloqueada por fecha/hora');
const search = buildCalendarSearch(turn.interpretation, 'calendar.delete');
console.log(JSON.stringify({query:search.query,params:search.params.toString()}));
