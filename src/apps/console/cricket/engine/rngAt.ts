// sub_049B34 with its state in engine RAM ($FFE8E8).
import { Ram } from "./mem";
import { rngNext } from "./rng";

export function rngNextAt(m: Ram): number {
  const v = rngNext(m.rw(0xe8e8));
  m.ww(0xe8e8, v);
  return v;
}
