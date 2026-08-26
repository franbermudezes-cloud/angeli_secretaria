import { readFileSync } from 'node:fs';
import { scheduleFor } from '../js/schedule.js';
import { scheduledReminderEvent } from '../js/google.js';
const {text, interpretation:aiIntent}=JSON.parse(readFileSync(0,'utf8'));
console.log(JSON.stringify(scheduledReminderEvent({id:crypto.randomUUID(),text,aiIntent,schedule:scheduleFor(aiIntent,text)})));
