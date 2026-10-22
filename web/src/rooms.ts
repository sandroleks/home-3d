import type { RoomInfo } from './manifest';

export function pointInTriangle(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

export class RoomLocator {
  constructor(private rooms: RoomInfo[]) {}

  locate(x: number, z: number, previous: string | null): string | null {
    for (const room of this.rooms) {
      const f = room.floor;
      for (let k = 0; k + 5 < f.length; k += 6) {
        if (pointInTriangle(x, z, f[k], f[k + 1], f[k + 2], f[k + 3], f[k + 4], f[k + 5])) return room.id;
      }
    }
    return previous;
  }
}
