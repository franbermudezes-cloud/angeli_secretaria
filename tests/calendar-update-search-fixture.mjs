import { localCalendarUpdate, protectCalendarInterpretation } from '../js/ai.js';
import { buildCalendarSearch } from '../js/google.js';

const phrase=process.argv[2]||'Cámbiame la hora de Miguel';
const remoteTitle=process.argv[3]||'Miguel';
const local=localCalendarUpdate(phrase,new Date(2026,7,26,12));
const remote={intent:'calendar.update',confidence:.95,
  target:{title:remoteTitle,date:null,time:null},changes:null,
  requiresConfirmation:true,missingFields:['time'],source:'ai'};
const interpretation=protectCalendarInterpretation(remote,local);
const search=buildCalendarSearch(interpretation,'calendar.update');
console.log(JSON.stringify({query:search.query,params:search.params.toString()}));
