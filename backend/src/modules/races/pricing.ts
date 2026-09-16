export type PrizeTier = { position: number; amountCents: number };

export const PRIZE_MULTIPLIERS = [
  { position: 1, multiplier: 3 },
  { position: 2, multiplier: 2 },
  { position: 3, multiplier: 1.5 },
  { position: 4, multiplier: 1 },
  { position: 5, multiplier: 0.5 },
] as const;

export const TROPHY_SCALE = [6, 4, 3, 2, 1, 0, -1, -2, -3, -4] as const;

export function prizeScheduleForEntryFee(entryFeeCents: number, rankedPositions = 10): PrizeTier[] {
  return PRIZE_MULTIPLIERS.filter((tier) => tier.position <= rankedPositions).map((tier) => ({
    position: tier.position,
    amountCents: Math.round(entryFeeCents * tier.multiplier),
  }));
}

export function totalPrizeCents(prizes: PrizeTier[]): number {
  return prizes.reduce((sum, prize) => sum + prize.amountCents, 0);
}

export function trophiesForPosition(position: number, positionCount: number): number {
  if (position < 1 || position > positionCount) {
    throw new Error(`position ${position} out of range for a ${positionCount}-slot race`);
  }
  return TROPHY_SCALE[position - 1] ?? 0;
}
