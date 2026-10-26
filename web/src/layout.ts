import { CONFIG } from './config';
import { isStateMap, type StateMap } from './presence';

/** The kitchen opened up into the Sala, as planned (the model as saved), or walled off, as it is now (?kitchen=wall). */
export type Kitchen = 'open' | 'wall';

export function kitchenFrom(params: URLSearchParams): Kitchen {
  return params.get('kitchen') === 'wall' ? 'wall' : 'open';
}

/** Where a layout's own assets are: its model, lightmaps, collision and manifest. Climate, sound and the
 * neighbourhood are shared and stay in CONFIG.assetsBase. */
export function assetsFor(kitchen: Kitchen): string {
  return kitchen === 'wall' ? `${CONFIG.assetsBase}${CONFIG.kitchenWallAssets}` : CONFIG.assetsBase;
}

/** This page with the other kitchen; the rest of the query (?room=, ?sun=, ...) stays. */
export function urlFor(href: string, kitchen: Kitchen): string {
  const url = new URL(href);
  if (kitchen === 'wall') url.searchParams.set('kitchen', 'wall');
  else url.searchParams.delete('kitchen');
  return url.toString();
}

/** What carries over the reload into the other kitchen: where the visitor stands and looks, the time, and the doors,
 * lights and screens (the other layout ignores the ones it doesn't have). */
export interface Carry {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  utc: number;
  state: StateMap;
}

const CARRY_KEY = 'walkthrough.carry';

export function saveCarry(storage: () => Pick<Storage, 'setItem'>, carry: Carry): void {
  try {
    storage().setItem(CARRY_KEY, JSON.stringify(carry));
  } catch {
    // Storage is blocked: the other kitchen opens at the entrance, now.
  }
}

/** Read once: a later reload starts afresh. */
export function takeCarry(storage: () => Pick<Storage, 'getItem' | 'removeItem'>): Carry | null {
  try {
    const raw = storage().getItem(CARRY_KEY);
    storage().removeItem(CARRY_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Carry>;
    const nums = [c.x, c.z, c.yaw, c.pitch, c.utc];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n)) || !isStateMap(c.state)) return null;
    return c as Carry;
  } catch {
    return null;
  }
}
