// /console/cricket: a match England v Australia, or practice in the nets (Console Cricket, branch
// console/cricket only)
import { useState } from "react";
import { Nets } from "./Nets";
import { Match } from "./Match";
import "./cricket.css";

type Tab = "match" | "nets";

/** `?cc-tab=nets` (or a nets option: `cc-mode`, `cc-demo`) opens the nets */
function initialTab(): Tab {
  if (typeof location === "undefined") return "match";
  const q = new URLSearchParams(location.search);
  return q.get("cc-tab") === "nets" || q.has("cc-mode") || q.has("cc-demo") ? "nets" : "match";
}

export function CricketPage() {
  const [tab, setTab] = useState<Tab>(initialTab);
  return (
    <div className="cc">
      <header className="cc-head">
        <div>
          <p className="cc-eyebrow">Console · Brian Lara Cricket 96</p>
          <h1>{tab === "match" ? "International match" : "Practice in the nets"}</h1>
          <p className="cc-lead">The Mega Drive game's rules, players and art, rebuilt from the cartridge's code, not emulated: a whole match with all the original's settings, or batting and bowling practice in the nets.</p>
        </div>
        <span className="cc-badge">Work in progress · phase 4</span>
      </header>
      <div className="cc-modes cc-m-tabs-top" role="tablist" aria-label="Match or nets">
        {(["match", "nets"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`cc-mode${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {t === "match" ? "Match" : "Nets"}
            <span>{t === "match" ? "13 teams, one day or a Test" : "bat or bowl, ball after ball"}</span>
          </button>
        ))}
      </div>
      {tab === "match" ? <Match /> : <Nets />}
    </div>
  );
}
