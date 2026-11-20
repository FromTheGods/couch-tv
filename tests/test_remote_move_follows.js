// The phone remote follows the show after a Move (docs/MOVE.md, "How to use it").
// App.jsx is a React component with no test runner of its own, so this cuts the two real handlers
// (chooseTv and onMove) out of remote/src/App.jsx and runs them with stand-ins for what they touch.
// It is the code the phone runs, not a copy: if either handler changes, this runs the new one.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Running phone remote "Move follows the show" tests...');

const src = fs.readFileSync(path.join(__dirname, '../remote/src/App.jsx'), 'utf8').replace(/\r\n/g, '\n');
function cut(start) {
  const a = src.indexOf(start);
  assert(a >= 0, `App.jsx must still have "${start.trim()}"`);
  const b = src.indexOf('\n  };', a);
  assert(b > a, `could not find the end of "${start.trim()}"`);
  return src.slice(a, b + 5);
}
const handlers = cut('  const chooseTv = (id) => {') + '\n' + cut('  const onMove = async (to, force = false) => {');

// One pretend phone: what it has stored, what it showed, what it asked the bridge.
function phone(answers, confirmAnswer) {
  const seen = { stored: 'unset', tvId: 'unset', said: [], calls: [], asked: 0, reach: null };
  const env = {
    store: { set: (k, v) => { assert.strictEqual(k, 'tv.tv'); seen.stored = v; } },
    setTvId: (v) => { seen.tvId = v; }, setTvIdState: () => {}, setWakeError: () => {}, setSheet: () => {},
    setReach: (v) => { seen.reach = v; },
    say: (text, kind) => seen.said.push([text, kind || 'ok']),
    t: (key, vars) => key + (vars && vars.tv ? ':' + vars.tv : ''),
    tBridge: (key, vars, fallback) => fallback || key,
    api: { move: (to, force) => {
      seen.calls.push([to, force]);
      const a = answers[seen.calls.length - 1];
      return a.ok ? Promise.resolve(a) : Promise.reject(a);
    } },
    window: { confirm: () => { seen.asked += 1; return confirmAnswer; } },
  };
  const names = Object.keys(env);
  const onMove = new Function(...names, handlers + '\n  return onMove;')(...names.map((n) => env[n]));
  return { seen, onMove };
}
const BEDROOM = { id: 'bedroom', name: 'Bedroom' };
const LIVING = { id: 'living-room', name: 'Living room' };
const IN_USE = { ok: false, status: 409, key: 'err_move_tv_in_use', message: 'That TV is in use.' };
const settle = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // 1. A move the bridge answered: the phone now drives the other TV, and remembers it.
  let p = phone([{ ok: true, note: 'Moved to Bedroom.' }]);
  await p.onMove(BEDROOM);
  assert.deepStrictEqual(p.seen.calls, [['bedroom', false]]);
  assert.strictEqual(p.seen.stored, 'bedroom', 'the phone remembers the TV the show went to');
  assert.strictEqual(p.seen.tvId, 'bedroom', 'later calls go to the TV the show went to');
  assert.deepStrictEqual(p.seen.said[p.seen.said.length - 1], ['Moved to Bedroom.', 'ok']);

  // 2. Back to the default TV: stored as "no choice", the same as picking it under Which TV.
  p = phone([{ ok: true, note: 'Moved to Living room.' }]);
  await p.onMove(LIVING);
  assert.strictEqual(p.seen.stored, '');
  assert.strictEqual(p.seen.tvId, null);

  // 3. The show was opened but has not started (a profile screen): the phone still follows, because
  //    the press that is left is on that TV.
  p = phone([{ ok: true, started: false, note: 'Opened, press OK on its remote.' }]);
  await p.onMove(BEDROOM);
  assert.strictEqual(p.seen.tvId, 'bedroom');

  // 4. A move that failed: the phone stays on the TV it had, and says why.
  p = phone([{ ok: false, status: 502, message: 'The move failed.' }]);
  await p.onMove(BEDROOM);
  assert.strictEqual(p.seen.stored, 'unset', 'a failed move must not change the stored TV');
  assert.strictEqual(p.seen.tvId, 'unset', 'a failed move must not change the TV in use');
  assert.deepStrictEqual(p.seen.said[p.seen.said.length - 1], ['The move failed.', 'err']);

  // 5. The other TV is in use and the person says no: nothing is taken over, the phone stays.
  p = phone([IN_USE], false);
  await p.onMove(BEDROOM);
  assert.strictEqual(p.seen.asked, 1, 'the phone asks before taking a TV that is in use');
  assert.deepStrictEqual(p.seen.calls, [['bedroom', false]], 'no second try after a no');
  assert.strictEqual(p.seen.tvId, 'unset');

  // 6. In use and the person says yes: one forced try, and the phone follows only once that worked.
  p = phone([IN_USE, { ok: true, note: 'Moved to Bedroom.' }], true);
  await p.onMove(BEDROOM);
  await settle();
  assert.deepStrictEqual(p.seen.calls, [['bedroom', false], ['bedroom', true]]);
  assert.strictEqual(p.seen.tvId, 'bedroom');

  // 7. In use, yes, and the forced try fails too: stays put, and does not ask a second time.
  p = phone([IN_USE, { ok: false, status: 502, message: 'The move failed.' }], true);
  await p.onMove(BEDROOM);
  await settle();
  assert.strictEqual(p.seen.asked, 1);
  assert.strictEqual(p.seen.tvId, 'unset');

  // 8. The bridge did not answer at all: stays put and shows the phone as cut off.
  p = phone([{ ok: false, status: 0, message: 'No answer.' }]);
  await p.onMove(BEDROOM);
  assert.strictEqual(p.seen.tvId, 'unset');
  assert.strictEqual(p.seen.reach, false);

  console.log('All phone remote "Move follows the show" tests passed successfully!');
})().catch((e) => { console.error(e); process.exit(1); });
