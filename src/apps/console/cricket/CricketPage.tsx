// /console/cricket: batting practice (phase 2 of Console Cricket, branch console/cricket only)
import { Nets } from "./Nets";
import "./cricket.css";

export function CricketPage() {
  return (
    <div className="cc">
      <header className="cc-head">
        <div>
          <p className="cc-eyebrow">Console · Brian Lara Cricket 96</p>
          <h1>Batting practice</h1>
          <p className="cc-lead">Face a bowling machine that thinks like the original game's bowler: rebuilt from the Mega Drive cartridge, not emulated.</p>
        </div>
        <span className="cc-badge">Work in progress · phase 2</span>
      </header>
      <Nets />
    </div>
  );
}
