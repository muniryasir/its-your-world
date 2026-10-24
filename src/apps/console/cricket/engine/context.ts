// Values the original reads through player-record pointers (not stored in work RAM), fixed for a delivery.
// Everything else (pitch coefficients $C5BA-$C5CC, bowling table $D212, batting table $D2A4, difficulty
// $8604, controllers $B520/$B526, left-handed flag $D2C6, field table $E080, ...) lives in the engine RAM.

export interface Context {
  /** current bowler's attributes: +$12 (accuracy/pace rating) and +$14 (signed type; sign = bowling arm) */
  bowler: { a12: number; a14: number };
  /** current batsman: slot +$1C (balls faced so far), slot +$18 (left-handed), attributes +$0E, +$10, +$12 */
  batsman: { s1c: number; a0e: number; a10: number; a12: number; s18: number };
  /** ROM record at $DFDA: +$12 and +$18 */
  dfda12: number;
  dfda18: number;
}
