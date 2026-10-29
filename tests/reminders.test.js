'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../src/renderer/js/reminders.js')).href);
// 23:00 on a day: "a las 12:30 am" is the next half past midnight
const NIGHT = new Date(2026, 9, 28, 23, 0, 0).getTime();

test('"hazme recordar", as it was asked, makes a reminder for 00:30', async () => {
  const { parseReminder } = await load();
  const r = parseReminder('Hazme recordar a las 12:30 am que debo de entregar un documento de razonamiento verbal a mi padre', NIGHT);
  assert.ok(r, 'no reminder');
  assert.equal(new Date(r.at).getHours(), 0);
  assert.equal(new Date(r.at).getMinutes(), 30);
  assert.match(r.text, /entregar un documento/);
});

test('the other ways to ask for one in Spanish (Peru)', async () => {
  const { parseReminder } = await load();
  for (const asked of [
    'hazme acordar en 10 minutos de sacar la ropa',
    'agrega un recordatorio en 10 minutos para llamar a mamá',
    'añade un recordatorio en 10 minutos de estudiar',
    'crea un recordatorio en 10 minutos de comer',
    'anota un recordatorio en 10 minutos: pagar la luz',
    'no me dejes olvidar en 10 minutos el pan',
  ]) assert.ok(parseReminder(asked, NIGHT)?.at, asked);
});

test('talking about reminders is not asking for one', async () => {
  const { parseReminder } = await load();
  assert.equal(parseReminder('los recordatorios funcionan?', NIGHT), null);
});
