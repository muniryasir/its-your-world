/** RAM the engine does not model: display, VDP command list, stack, sound, frame counters ... */
export const IGNORE: [number, number][] = [
  [0x0000, 0x0400], // stack
  [0x0400, 0x6900], // screens: decompression and text buffers
  [0x6900, 0x695c], [0x6a00, 0x7000], // screens
  [0x87f8, 0x8a00], // sprite list
  [0x8b40, 0x8c00], [0x8cd0, 0x8f00], // VDP / scroll shadows
  [0x9000, 0x9c00], // display objects (fielding view; checked by checkField)
  [0xe9b2, 0xe9b4], // frame counter
  [0xe9c0, 0xf600], // VDP command list
  [0xfbc0, 0xfc00], [0xfc1c, 0xfcc8], // pads (raw), sound queue (entries from $FC48)
  [0x86f0, 0x8760], // VBlank task nodes
  [0x87f6, 0x87f8], // fade flag
  [0xbe18, 0xbe1a], // scratch index of the player lookups
  [0xbf12, 0xbf1e], [0xbf8a, 0xbfb0], // scoreboard text
  [0xc8a4, 0xc8b6], [0xcac0, 0xccc0], // pitch overlay display
  [0xd1b4, 0xd1ce], // aim marker corners (display)
  [0xe8d4, 0xe8e8], [0x7000, 0x7200], [0xe8ea, 0xe8ee], // scratch of the collision test and the divide helper
  [0xe9b0, 0xe9b2], // sound request
  [0xe96c, 0xe970], // the celebration's display object (allocated)
  [0xc068, 0xc06c], [0xc89e, 0xc8a2], [0xc7f8, 0xc7fc], [0xe960, 0xe966], [0xe96a, 0xe96c], // display objects' pointers (scoreboard, map panel, overlay, marker) and a tile base
  [0x69c4, 0x6a00], // text buffer of the bowler menu
  [0xa676, 0xa68e], // the ranked-players list (scratch of sub_00B116; also run by the scorecard screens, sub_034332)
];

/** Screen state of the original's own between-ball screens (scorecards, banners, menus, the map panel's
 *  position) that the engine never reads. Not compared, and the engine's bytes are never refreshed from
 *  the recording either: if the engine did depend on one of them, later comparisons would fail. */
export const UI: [number, number][] = [
  [0xc06e, 0xc07a], [0xc07e, 0xc080], [0xc0a8, 0xc11a], // scoreboard / banner text state (a long name runs on to $C079)
  [0xc27a, 0xc2c0], // the batting-order screen's list (sub_0203EA)
  [0xc2ec, 0xc364], // text buffers, layout and objects of the over-end, innings and pitch-report screens
  [0xc614, 0xc618], // pitch report
  [0xc2c0, 0xc2ca], // bowler menu, the result's text code
  [0xc61e, 0xc6c2], // menu and screen variables
];
/** The run-out replay's close-up (sub_039F0E) re-uses the runners' structs for its flying bails */
export const REPLAY: [number, number][] = [[0xc83c, 0xc89c]];
