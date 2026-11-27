import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HistoricalBcvRateNote from './HistoricalBcvRateNote';

const render = (props: React.ComponentProps<typeof HistoricalBcvRateNote>) =>
  renderToStaticMarkup(React.createElement(HistoricalBcvRateNote, props));

test('avisa cuando no hay tasa histórica y el campo está vacío', () => {
  const html = render({ date: '2024-05-15' });
  assert.match(html, /No hay tasa BCV histórica vigente para el 15\/05\/2024/);
  assert.match(html, /Ingrese la tasa manualmente o actualice el historial desde Inventario/);
  assert.match(html, /text-amber-700/);
});

test('no muestra una alerta ámbar si ya hay una tasa escrita manualmente', () => {
  const html = render({ date: '2024-05-15', appliedRate: 38.25 });
  assert.match(html, /Tasa ingresada manualmente/);
  assert.doesNotMatch(html, /text-amber-700/);
});

test('muestra el origen Inventario de la tasa sugerida', () => {
  const html = render({
    date: '2024-05-15',
    suggestion: { rate: 38.25, effectiveDate: '2024-05-01', origin: 'INVENTORY' },
    appliedRate: 38.25
  });
  assert.match(html, /38,25/);
  assert.match(html, /Inventario/);
  assert.match(html, /aplicada al registro/);
});
