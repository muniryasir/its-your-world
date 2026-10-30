// /console/cricket: practice in the nets, batting or bowling (Console Cricket, branch console/cricket only)
import { Nets } from "./Nets";
import "./cricket.css";

export function CricketPage() {
  return (
    <div className="cc">
      <header className="cc-head">
        <div>
          <p className="cc-eyebrow">Console · Brian Lara Cricket 96</p>
          <h1>Practice in the nets</h1>
          <p className="cc-lead">Bat against a bowling machine that thinks like the original game's bowler, or bowl to its batsman and field: rebuilt from the Mega Drive cartridge, not emulated.</p>
        </div>
        <span className="cc-badge">Work in progress · phase 3</span>
      </header>
      <Nets />
    </div>
  );
}
