// PIECE: game-flow
// OWNER: this directory ONLY. Never edit anything outside src/pieces/game-flow/.
// SLOT:  flow
// REGISTER VIA: registerFlow(impl)
// JUDGED ON: the state machine, the play boundary, and a game that actually plays
//
// WHAT THIS PIECE IS. Everything between the plays, and the rules of the plays themselves:
//
//   rules.js   downs, distance, scoring, the clock. Four downs to thirty yards, no
//              penalties, safety checked before touchdown. Pure state -> state.
//   kick.js    placekicks are AUTOMATIC by rule and say so with an overlay; the onside
//              kick is the one kick that is played, with a real input and a real skill.
//   pad.js     the Xbox control scheme, with its N64 heritage recorded per row.
//   coach.js   the AI play caller. Somebody has to choose between eighteen offensive
//              calls and nine defensive ones.
//   flow.js    the state machine that wires all of the above to the live simulation.
//
// THE SLOT WAS EMPTY UNTIL NOW, and that is worth stating plainly: rules, kicks and the
// control scheme were all built and tested, and none of them was connected to anything.
// index.js registered nothing, so the game ran the foundation's fallback -- a DEMO TIMER
// whose states advance on fixed ages and which cannot tell a down from a touchdown.
//
// THE PLAY BOUNDARY IS A PERFORMANCE CONTRACT, not a design one. The adaptive scaler
// queues EXPENSIVE rung changes (post pass count, shadow on/off, actor LOD) and they are
// committed in enterPlay() and nowhere else, behind the transition, where a hitch cannot
// be seen. That contract is preserved exactly from the fallback.

import { registerFlow, registerIsoShot } from '../../foundation/registry.js';
import flow from './flow.js';

export const PIECE = 'game-flow';

registerFlow(flow);

/**
 * The play-call screen mid-game, driven by the real flow rather than posed.
 *
 * Judged against the play-call panel: this is the state the player spends a third of the
 * game looking at, and it is the one screen where the shared playbook is visible as a
 * playbook rather than as behaviour on the field.
 */
registerIsoShot('iso_flow_playcall', {
  piece: PIECE,
  panel: 'playcall_def',
  camera: { pos: [-4.0, 12.0, 26.0], target: [6.0, 1.0, 0.0], fov: 36, roll: 0 },
  lens: { fStop: 5.6, focusDist: 30.0, bokehScale: 0.4, shutter: 1 / 250 },
  exposure: 1.0,
  ui: { screen: 'playcall' },
  hud: { visible: false },
  note: 'The play-call state as the flow machine actually enters it, between two live downs.',
});

export default flow;
