// The delivery loop (sub_00E13E) as a sequence of phases, and one game-logic tick in the order of
// sub_00EDBC. Display-only routines (sprites, camera, scoreboard, sound) are left out.
//
// Each step() is one pass of the current loop. The original runs a pass as
// [work, tick, wait for the frame] then [after-the-frame checks]; step() runs the previous pass's
// checks first, then this pass's work and tick, which matches where the emulator's state is sampled.

import { Ram, ROM } from "./mem";
import { Context } from "./context";
import { ballStep } from "./ball";
import { bowlerTick, paceMeter } from "./bowler";
import { fielderHasBall, ballTrack, registerStumps, stumpsAftermath, swapObjectLists, testObjects, hitBatsman, hitStumps } from "./collide";
import { closeFieldersTick, hitFielder, closeFieldersBusy } from "./fielders";
import { batsmanTick, registerBatsman, contact, bounceAssist, batPad } from "./batsman";
import {
  newDeliverySetup, crowdNoise, computerAim, computerButton, scatter, markerTick, meterBlink,
  computerSwingButton, computerMeterButton, paceInit,
} from "./delivery";
import { rngNextAt } from "./rngAt";
import { padPresses, padHeld } from "./pads";
import { addToTotal } from "./score";
import { projectCam } from "./project";
import { angleTo } from "./trig";
import { w, l, muls, setLo } from "./m68k";

export interface Input {
  held: number; // pad bits S A C B R L D U (bit 7..0), 1 = pressed
  pressed: number; // bits that went down since the previous tick
}

/** why the ball-live loop ($E528) ended */
export type EndReason =
  | "dead" // the ball stopped, or a wide was called ($BEDA)
  | "wicket" // $BEE2 set (bowled, lbw, caught)
  | "fielder" // a close fielder has the ball
  | "offscreen" // the ball left the batting view: the fielding view takes over
  | "settled"; // a rebound or a ball behind the stumps ran its $860C countdown out

export type Phase =
  | { kind: "preaim"; left: number }
  | { kind: "aim" }
  | { kind: "settle" }
  | { kind: "swing" }
  | { kind: "meterWait" }
  | { kind: "meterA" }
  | { kind: "meterB" }
  | { kind: "meterC" }
  | { kind: "paceWait" }
  | { kind: "runup"; left: number }
  | { kind: "live" }
  | { kind: "handover"; left: number }
  | { kind: "done"; reason: EndReason };

/** passes between the per-delivery set-up and the aim (camera settle, 13 passes, 1 more) */
export const PREAIM_PASSES = 15;
export const RUNUP_PASSES = 75;

export class Engine {
  phase: Phase;
  private checkDue = false;
  constructor(public m: Ram, public ctx: Context, phase: Phase = { kind: "live" }, checkDue = false) {
    this.phase = phase;
    this.checkDue = checkDue;
  }

  /** set up a new delivery (sub_00E13E up to the aim) */
  newDelivery(): void {
    newDeliverySetup(this.m, this.ctx);
    this.phase = { kind: "preaim", left: PREAIM_PASSES };
    this.checkDue = false;
  }

  /** one pass of the current loop */
  step(input: Input): void {
    const m = this.m;
    // VBlank input handler: held buttons and the pressed latch of the human's pad. The previous
    // pass's checks run after the frame wait, so they already see this tick's pad.
    const pb = batPad(m) >= 0 ? batPad(m) : 0xfbf8;
    m.ww(pb + 4, input.held); m.ww(pb + 6, input.held);
    m.ww(pb + 2, m.rw(pb + 2) | input.pressed);
    // after-the-frame part of the previous pass: checks and transitions
    if (this.checkDue) {
      this.checkDue = false;
      this.afterPass();
    }
    const ph = this.phase;
    switch (ph.kind) {
      case "preaim":
        if (ph.left === PREAIM_PASSES - 1) {
          // after the camera has settled: pad latches read and the crowd timer ($E2A4)
          this.consumeLatch();
          crowdNoise(m);
        }
        this.tick(input);
        ph.left--;
        this.checkDue = true;
        return;
      case "aim":
      case "settle":
        computerAim(m, this.ctx); // sub_04336A
        this.tick(input);
        this.checkDue = true;
        return;
      case "swing": {
        const d0 = computerSwingButton(m); // sub_04BE9E
        if (d0 & m.rw(0xc0c2)) { this.endSwing(); return this.step(input); }
        if (d0 & 4) m.ww(0xe954, -1);
        else if (d0 & 8) m.ww(0xe954, 0);
        this.tick(input);
        this.checkDue = true;
        return;
      }
      case "meterWait":
      case "paceWait":
        this.tick(input);
        this.checkDue = true;
        return;
      case "meterA":
        computerMeterButton(m); // called, result ignored, in this stage
        this.meterAdvance();
        this.tick(input);
        this.checkDue = true;
        return;
      case "meterB": {
        const d0 = computerMeterButton(m);
        if (d0 & m.rw(0xc0c2)) { this.phase = { kind: "meterC" }; return this.step(input); }
        this.meterAdvance();
        this.tick(input);
        this.checkDue = true;
        return;
      }
      case "meterC":
        this.meterAdvance();
        this.tick(input);
        this.checkDue = true;
        return;
      case "runup":
        if (ph.left > 0) {
          paceMeter(m, (c) => padHeld(m, c)); // sub_04C154
          this.tick(input); // loop at $E4EE
          ph.left--;
          return;
        }
        this.startBowler(); // after the loop, then straight into the ball-live loop
        this.phase = { kind: "live" };
      // falls through
      case "live":
        this.tick(input); // loop at $E528
        if (m.rw(0xe958) >= 0) {
          paceMeter(m, (c) => padHeld(m, c)); // sub_04C154
          m.aw(0xe958, -1);
        }
        this.checkDue = true;
        return;
      case "handover":
        computerAim(m, this.ctx); // sub_04336A
        this.tick(input);
        this.checkDue = true;
        return;
      case "done":
        return;
    }
  }

  /** $ED2E: the ball left the batting view ("offscreen" / "settled"). The batting view keeps running
   *  for 15 passes (sub_00ED82 with d7 = 14) before the fielding view takes over; done again after. */
  handOver(): void {
    const m = this.m;
    // sub_03AD7C
    if (m.rw(0xc8a2) >= 0 && m.rw(0xc8a2) !== 2) m.ww(0xc8a2, 2);
    m.wb(0xbf22, 0xff);
    padPresses(m, 0); padPresses(m, 1); // sub_00425E: presses so far are dropped
    this.phase = { kind: "handover", left: 14 };
    this.checkDue = false;
  }

  private meterAdvance(): void {
    this.m.ww(0xe956, (this.m.rw(0xe956) + this.m.rw(0xe952)) & 0x7ff);
  }

  /** the checks after the frame wait of the pass that just ran */
  private afterPass(): void {
    const m = this.m;
    const ph = this.phase;
    switch (ph.kind) {
      case "preaim":
        if (ph.left === 0) {
          // sub_00425E: button presses made so far are dropped; then $E31A
          const pad = batPad(m);
          if (pad >= 0) m.ww(pad + 2, m.rw(pad + 2) & 0x0f);
          m.ww(0xe58c, 0); m.ww(0xd1d4, 0);
          this.phase = { kind: "aim" };
        }
        return;
      case "aim": {
        const btn = computerButton(m); // sub_043A38
        if (m.rw(0xd1d4) < 0 || (btn & m.rw(0xc0c2))) { scatter(m); this.phase = { kind: "settle" }; }
        return;
      }
      case "settle":
        computerButton(m);
        if (m.rw(0xd1bc) === 4 && m.rw(0xd1d6) === m.rw(0xd1b8) && m.rw(0xd1da) === m.rw(0xd1ba)) {
          if (m.rw(0xd28e) === 0) this.startMeter();
          else { m.ww(0xe950, 1); m.ww(0xe95c, 0xe1); m.ww(0xe944, 0); this.phase = { kind: "swing" }; } // sub_04BDFA
        }
        return;
      case "swing":
        if (m.rw(0xe95c) < 0) this.endSwing();
        return;
      case "meterWait":
        computerButton(m);
        if (m.rw(0xe95c) < 0) this.phase = { kind: "meterA" };
        return;
      case "meterA": {
        m.aw(0xe952, 4);
        const lim = m.rw(0x8604) === 0 ? 0x3c : m.rw(0x8604) === 1 ? 0x44 : 0x50;
        if (m.rw(0xe952) === lim) this.phase = { kind: "meterB" };
        return;
      }
      case "meterC":
        if (m.aw(0xe952, -8) <= 0) {
          m.ww(0xe952, 0);
          paceInit(m); // sub_04C10A
          this.phase = { kind: "paceWait" };
        }
        return;
      case "paceWait":
        computerButton(m);
        if (m.rw(0xe95c) < 0) this.phase = { kind: "runup", left: RUNUP_PASSES };
        return;
      case "live": {
        const end = this.endCheck();
        if (end) this.phase = { kind: "done", reason: end };
        return;
      }
      case "handover":
        if (computerButton(m) !== 0 || --ph.left < 0) {
          m.ww(0xbf22, 0); m.ww(0xe58c, 0); m.wb(0x87f6, 0xff); m.ww(0x87f8, 0);
          this.phase = { kind: "done", reason: "offscreen" };
        }
        return;
      default:
        return;
    }
  }

  /** end of sub_04BDFA, then sub_04BF62's set-up */
  private endSwing(): void {
    this.m.ww(0xd29e, this.m.rw(0xe954));
    this.m.ww(0xe95c, -1);
    this.startMeter();
  }
  private startMeter(): void {
    const m = this.m;
    m.ww(0xe950, 2); m.ww(0xe95c, 0x28); m.ww(0xe944, 0);
    this.phase = { kind: "meterWait" };
  }

  private consumeLatch(): void {
    const pad = batPad(this.m);
    if (pad >= 0) this.m.ww(pad + 2, 0);
  }

  /** end of the run-up wait: $E514 e958 = 99, sub_046E4C (field gaps), sub_0441D8 (bowler starts) */
  startBowler(): void {
    const m = this.m;
    m.ww(0xe958, 0x63);
    buildFieldGaps(m); // sub_046E4C
    // sub_0441D8
    m.ww(0xd28a, 0);
    m.ww(0xd28c, 1);
    const fielders = [0xe1b4];
    const extra = m.rw(0xbe1a);
    if (extra !== 0) fielders.push(0xe1b8);
    if (extra !== 0 && extra !== 1) fielders.push(0xe1bc);
    fielders.forEach((p, i) => {
      const a0 = m.rl(p) & 0xffff;
      m.ww(a0 + 0x108, 0); m.ww(a0 + 0x10c, 0); m.ww(a0 + 0x10a, 0);
      m.ww(a0 + 0x10e, (rngNextAt(m) & 0xf) + 0x10 + [0, 0x20, 0x30][i]);
    });
  }

  /** the end-of-pass checks of the ball-live loop ($E554-$E696) */
  endCheck(): EndReason | null {
    const m = this.m;
    if (m.rw(0xbeda) !== 0) return "dead";
    if (fielderHasBall(m)) return "fielder";
    if (m.rw(0xbee2) !== 0) return "wicket";
    if (m.rw(0xe5a2) === 0) return null;
    let sp = l(muls(m.rw(0xe5a8), m.rw(0xe5a8)) + muls(m.rw(0xe5b0), m.rw(0xe5b0)));
    if (m.rw(0xe5a2) !== 3) {
      sp = l(sp + muls(m.rw(0xe5ac), m.rw(0xe5ac)));
      sp = setLo(sp, w(sp) + w(muls(m.rw(0xe5b8), 0x6666) >>> 16));
    }
    if (sp <= 0x30) return "dead";
    let sx = projectCam(m, m.rw(0xe5b4), 0, m.rw(0xe5bc))[0];
    if (sx < 8 || sx >= 0x138) return "offscreen";
    if (m.rw(0xe5b0) < 0) {
      const d = w(m.rw(0xe5bc) - m.rw(0xd270));
      if (d < 0x50) return "offscreen";
    } else {
      if (!closeFieldersBusy(m)) return null;
      if (m.rw(0xe5bc) >= 0x400 && m.rw(0x860c) === -1) m.ww(0x860c, 8);
    }
    if (m.rw(0x860c) < 0) return null;
    if (m.aw(0x860c, -1) === 0) return "settled";
    sx = projectCam(m, m.rw(0xe5b4), 0, m.rw(0xe5bc))[0];
    if (sx < 0x20 || sx >= 0x120) return "offscreen";
    return null;
  }

  /** the phase of the last tick (for checks against emulator traces) */
  tickPhase = "";

  tick(input: Input): void {
    const m = this.m;
    this.tickPhase = this.phase.kind;
    markerTick(m); // sub_0436F2 -> sub_043720 -> sub_0439BA
    ballStep(m, () => bounceAssist(m)); // sub_0486DC
    ballTrack(m); // sub_048910
    batsmanTick(m, this.ctx); // sub_04472A
    registerBatsman(m); // sub_04471E
    closeFieldersTick(m); // sub_0471D8, sub_047C76, sub_047246, sub_047CB2
    bowlerTick(m, this.ctx); // sub_044236
    wideCheck(m); // sub_0484B8
    stumpsAftermath(m); // sub_00EE9C -> sub_00EED6
    registerStumps(m);
    // sub_04BA94: a requested ball reset
    if (m.rw(0xe934) !== 0) {
      m.ww(0xe5a2, 0); m.ww(0xe936, 0); m.ww(0xe934, 0);
    }
    m.ww(0xe936, m.rw(0xe5a2)); // sub_04BAA8
    swapObjectLists(m); // sub_048BF8
    contact(m, this.ctx); // sub_0458E0
    testObjects(m, HANDLERS); // sub_048C26
    meterBlink(m); // sub_04C190
  }
}

const HANDLERS = {
  0x48d00: hitBatsman,
  0x00f256: (m: Ram) => hitStumps(m),
  0x47bd4: hitFielder,
  0x47bde: hitFielder,
  0x47be8: hitFielder,
};

/** sub_0484B8: an unplayed ball that passes the stumps more than $78 wide is called wide */
function wideCheck(m: Ram): void {
  if (m.rw(0xe576) !== 0 || m.rw(0xe5a2) === 0) return;
  if (m.rw(0x8606) !== 0 || m.rw(0x8608) !== 0 || m.rw(0xbee2) !== 0) return;
  if (m.rw(0xe5bc) < 0x400) return;
  m.ww(0xe576, -1);
  if (Math.abs(m.rw(0xe5b4)) < 0x78) return;
  // sub_048504
  m.ww(0xe578, 2); m.ww(0xe57e, 0); m.ww(0xe57c, 5); m.ww(0xe57a, 2);
  m.ww(0xbe68 + 0x4e, m.rw(0xbe68 + 0x4e) + 1); // sub_00C482(1): extras
  addToTotal(m, 1); // sub_00C3C4(1)
  m.ww(0xbeda, -1);
  m.aw(0xbed8, 1);
}

/** sub_046E4C: the field-gap table $E080: 128 sectors (16 angle steps each), high byte = how well the
 *  fielding side covers that direction from the batsman ($370), low byte = sector number */
export function buildFieldGaps(m: Ram): void {
  for (let i = 0; i < 128; i++) m.ww(0xe080 + 2 * i, i);
  let a0 = m.rl(0xb522) & 0xffff;
  for (let k = 0; k < 11; k++, a0 += 0x68) {
    const ang = angleTo(m.rw(a0 + 0x34), m.rw(a0 + 0x36), 0, 0x370);
    let d2 = ((((ang - 0x200) & 0x7ff) >>> 3) - 6) & 0xfe;
    for (let j = 0; j < 7; j++) {
      const a = 0xe080 + d2;
      m.wb(a, m.rb(a) + (ROM.rw(0x46eae + 2 * j) & 0xff));
      d2 = (d2 + 2) & 0xfe;
    }
  }
}
