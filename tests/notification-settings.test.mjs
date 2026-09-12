import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNotificationSettings} from '../js/notification-settings.js';

test('ajustes de avisos aplican valores iniciales seguros',()=>{
 const value=normalizeNotificationSettings();
 assert.equal(value.atTime,true);
 assert.equal(value.afterMinutes,60);
 assert.equal(value.quiet.start,'22:30');
 assert.equal(value.types.events,false);
});

test('ajustes de avisos validan minutos y horas antes de sincronizar',()=>{
 const value=normalizeNotificationSettings({beforeMinutes:-4,afterMinutes:20000,quiet:{start:'99:00',end:'07:15'},types:{reminders:false,events:true}});
 assert.equal(value.beforeMinutes,0);
 assert.equal(value.afterMinutes,10080);
 assert.equal(value.quiet.start,'22:30');
 assert.equal(value.quiet.end,'07:15');
 assert.equal(value.types.reminders,false);
 assert.equal(value.types.events,true);
});
