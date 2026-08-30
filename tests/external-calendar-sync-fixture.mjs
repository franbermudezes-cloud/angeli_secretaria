import { reconcileReminderEntries } from "../js/google.js";

const event = JSON.parse(process.argv[2]);
const original = {
  id: "external-calendar-sync",
  text: "Recuérdame revisar el equipo",
  type: "reminder",
  status: "pending",
  scheduledDate: "2026-09-04",
  scheduledTime: "10:00",
  aiIntent: { intent: "reminder.create", title: "Revisar el equipo", date: "2026-09-04", time: "10:00" },
  schedule: {
    status: "scheduled",
    dueAt: "2026-09-04T10:00:00",
    title: "Revisar el equipo",
    description: "",
    calendarEventId: event.id,
    calendarUrl: ""
  }
};

const [reconciled] = reconcileReminderEntries([original], new Map([[event.id, { exists: true, event }]]));
process.stdout.write(JSON.stringify(reconciled));
