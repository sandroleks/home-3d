import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest';
import { pointInTriangle, RoomLocator } from '../src/rooms';
import { sampleManifest } from './fixtures';

describe('RoomLocator', () => {
  const locator = new RoomLocator(parseManifest(sampleManifest()).rooms);

  it('finds the room under a point', () => {
    expect(locator.locate(1, -1, null)).toBe('alpha');
    expect(locator.locate(4, -2, null)).toBe('beta');
  });

  it('keeps the previous room in doorways', () => {
    expect(locator.locate(3.1, -1.4, 'alpha')).toBe('alpha');
    expect(locator.locate(3.1, -1.4, null)).toBeNull();
  });

  it('pointInTriangle handles both windings', () => {
    expect(pointInTriangle(0.2, 0.2, 0, 0, 1, 0, 0, 1)).toBe(true);
    expect(pointInTriangle(0.2, 0.2, 0, 0, 0, 1, 1, 0)).toBe(true);
    expect(pointInTriangle(0.8, 0.8, 0, 0, 1, 0, 0, 1)).toBe(false);
  });
});
