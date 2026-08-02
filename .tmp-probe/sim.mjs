import fs from 'node:fs';
import { createPlay, advance, RESULT, RESULT_NAME, TICK_HZ } from '../src/pieces/play-sim/sim.js';
import { hash } from '../src/foundation/rng.js';
const PLAYBOOK = JSON.parse(fs.readFileSync(new URL('../src/data/playbook.json', import.meta.url)));
const PLAYERS = JSON.parse(fs.readFileSync(new URL('../src/data/players.json', import.meta.url)));
const CLUBS = Object.keys(PLAYERS.byTeam);
for (const seed of [7]) {
  const teamA='NYC', teamB='CHI';
  const pick=(list,salt)=>list[hash(seed,salt)%list.length];
  const st = createPlay(seed, pick(PLAYBOOK.offense,3), pick(PLAYBOOK.defense,4),
    PLAYERS.byTeam[teamA], PLAYERS.byTeam[teamB], PLAYBOOK.formation);
  let g=0; while (st.result === RESULT.LIVE && g++ < 1200) advance(st);
  console.log('seed', seed, 'result', RESULT_NAME[st.result], 'ticks', st.tick);
  for (const e of st.events) console.log(' ', (e.tick/TICK_HZ).toFixed(3), e.kind, e.slot||'', e.sack?'SACK':'');
}
