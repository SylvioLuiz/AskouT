import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendsLine, rollingMeta } from './venue-story.ts';
import type { PublicProfile, RollingNowItem } from './types.ts';

const person = (username: string) => ({ userId: username, username }) as unknown as PublicProfile;
const base: RollingNowItem = { venue: { id: 'v', name: 'Bar', category: null, logoUrl: null }, stories: [], event: null, distanceM: null, interest: false, friendsGoingCount: 0, friendsGoing: [] };

test('friendsLine: sem amigos, um amigo e vários', () => {
  assert.equal(friendsLine(base), null);
  assert.equal(friendsLine({ friendsGoing: [person('ana')], friendsGoingCount: 1 }), 'ana vai');
  assert.equal(friendsLine({ friendsGoing: [person('ana'), person('bia')], friendsGoingCount: 2 }), 'ana e mais 1 amigo vão');
  assert.equal(friendsLine({ friendsGoing: [person('ana')], friendsGoingCount: 4 }), 'ana e mais 3 amigos vão');
});

test('rollingMeta: distância, depois amigos ou interesse', () => {
  assert.deepEqual(rollingMeta(base), []);
  assert.deepEqual(rollingMeta({ ...base, distanceM: 800, interest: true }), ['800 m', 'Tem a ver com você']);
  assert.deepEqual(rollingMeta({ ...base, distanceM: 2600, interest: true, friendsGoing: [person('ana')], friendsGoingCount: 1 }), ['2,6 km', 'ana vai']);
});
