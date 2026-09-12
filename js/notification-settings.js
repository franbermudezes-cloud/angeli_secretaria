export const DEFAULT_NOTIFICATION_SETTINGS={atTime:true,beforeMinutes:0,afterMinutes:60,types:{reminders:true,calls:true,linked:true,tasks:true,events:false},quiet:{enabled:true,start:"22:30",end:"08:00",deliverAfter:true}};

const minutes=value=>Math.max(0,Math.min(10080,Number.isFinite(Number(value))?Math.round(Number(value)):0));
const clock=(value,fallback)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||""))?String(value):fallback;

export function normalizeNotificationSettings(value={}){
 const types=value.types||{},quiet=value.quiet||{};
 return{atTime:value.atTime!==false,beforeMinutes:minutes(value.beforeMinutes??DEFAULT_NOTIFICATION_SETTINGS.beforeMinutes),afterMinutes:minutes(value.afterMinutes??DEFAULT_NOTIFICATION_SETTINGS.afterMinutes),types:{reminders:types.reminders!==false,calls:types.calls!==false,linked:types.linked!==false,tasks:types.tasks!==false,events:types.events===true},quiet:{enabled:quiet.enabled!==false,start:clock(quiet.start,"22:30"),end:clock(quiet.end,"08:00"),deliverAfter:quiet.deliverAfter!==false}};
}
