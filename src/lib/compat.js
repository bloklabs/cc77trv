// These identifiers are the on-device and encrypted-wire contract inherited
// from CC77 Wander. Renaming them would strand existing IndexedDB records,
// local preferences, or shared spaces. OS3 Concierge must keep them forever.

export const LEGACY_COMPAT = Object.freeze({
  databaseName: 'wander',
  databaseVersion: 1,
  itemStore: 'items',
  spaceKey: 'wander.space',
  seedFlag: 'wander.seeded',
  autocompletePrefix: 'wander.ac.',
  geoKey: 'wander.geo',
  pbkdf2Salt: 'wander-cc77-v1',
  pbkdf2Iterations: 100000,
  shareCodePrefix: 'wander1',
  payloadVersionKey: 'wander',
  payloadVersion: 1,
})
