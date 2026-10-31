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
  [0xfbc0, 0xfc00], [0xfc1c, 0xfc50], // pads (raw), sound queue
  [0x86f0, 0x8760], // VBlank task nodes
  [0x87f6, 0x87f8], // fade flag
  [0xbe18, 0xbe1a], // scratch index of the player lookups
  [0xbf12, 0xbf1e], [0xbf8c, 0xbfb0], // scoreboard text
  [0xc8a4, 0xc8b6], [0xcac0, 0xccc0], // pitch overlay display
  [0xd1b4, 0xd1ce], // aim marker corners (display)
  [0xe8d4, 0xe8dc], [0xe8e4, 0xe8e6], [0xe8ea, 0xe8ee], // scratch of the collision test and the divide helper
  [0xe9b0, 0xe9b2], // sound request
];
