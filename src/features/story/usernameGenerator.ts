const ADJECTIVES = [
  'Quiet', 'Tired', 'Salty', 'Lucky', 'Grumpy', 'Sleepy', 'Bold', 'Calm', 'Loud', 'Wild',
  'Fuzzy', 'Icy', 'Spicy', 'Rusty', 'Shiny', 'Dizzy', 'Brave', 'Cranky', 'Chill', 'Sneaky',
  'Rogue', 'Mellow', 'Feral', 'Jolly', 'Weary', 'Zesty',
];

const NOUNS = [
  'Otter', 'Pigeon', 'Waffle', 'Raccoon', 'Noodle', 'Falcon', 'Turtle', 'Goblin', 'Walrus', 'Penguin',
  'Badger', 'Hamster', 'Yeti', 'Panda', 'Ferret', 'Muffin', 'Wombat', 'Gecko', 'Toaster', 'Cactus',
  'Potato', 'Wizard', 'Pretzel', 'Koala', 'Comet', 'Biscuit',
];

/** "u/QuietOtter42" style fake username. Deterministic when a seed is given. */
export function generateFakeUsername(rng: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
  const num = Math.floor(rng() * 90) + 10;
  return `${adj}${noun}${num}`;
}

export function generateFakeUsernames(count: number, rng: () => number = Math.random): string[] {
  const used = new Set<string>();
  const names: string[] = [];
  let guard = 0;
  while (names.length < count && guard < count * 20) {
    guard++;
    const name = generateFakeUsername(rng);
    if (used.has(name)) continue;
    used.add(name);
    names.push(name);
  }
  return names;
}
