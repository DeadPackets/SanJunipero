// A coined verb arrives as a slug — `recipe:plank`, `express:mourn`, `dig_channel`. The
// namespace and the separators are machine ids, and `recipe:` names the verb "make".
export const verbWords = (verb: string): [string, ...string[]] => {
  const coined = verb.startsWith('recipe:')
  const bare = coined ? verb.slice('recipe:'.length) : verb.replace(/^express:/, '')
  const [head, ...rest] = bare.split(/[_:]/).filter((w) => w !== '')
  if (head === undefined) return [verb]
  return coined ? ['make', head, ...rest] : [head, ...rest]
}

/** The slug said in the present, for a name rather than a count. */
export const verbPhrase = (verb: string): string => verbWords(verb).join(' ')

// Both call sites read "has/have <verb>", so this is the past participle, not the simple past.
const IRREGULAR_PARTICIPLE: Record<string, string> = {
  bring: 'brought',
  build: 'built',
  catch: 'caught',
  cut: 'cut',
  dig: 'dug',
  do: 'done',
  draw: 'drawn',
  drink: 'drunk',
  eat: 'eaten',
  fall: 'fallen',
  find: 'found',
  give: 'given',
  go: 'gone',
  hold: 'held',
  leave: 'left',
  light: 'lit',
  make: 'made',
  put: 'put',
  read: 'read',
  run: 'run',
  say: 'said',
  see: 'seen',
  sing: 'sung',
  sit: 'sat',
  sleep: 'slept',
  speak: 'spoken',
  stand: 'stood',
  swim: 'swum',
  take: 'taken',
  teach: 'taught',
  think: 'thought',
  wake: 'woken',
  wear: 'worn',
  weave: 'woven',
  write: 'written',
}

// One vowel between consonants doubles the last one: chop -> chopped, but craft -> crafted.
const DOUBLES_FINAL_CONSONANT = /^[^aeiou]*[aeiou][^aeiouwxy]$/

export const pastParticiple = (verb: string): string => {
  const irregular = IRREGULAR_PARTICIPLE[verb]
  if (irregular !== undefined) return irregular
  if (verb.endsWith('e')) return `${verb}d`
  if (DOUBLES_FINAL_CONSONANT.test(verb)) return `${verb}${verb.slice(-1)}ed`
  return `${verb}ed`
}

/** "3 people have express:mourned 7 times" -> "3 people have mourned 7 times". */
export const verbPhrasePast = (verb: string): string => {
  const [head, ...rest] = verbWords(verb)
  return [pastParticiple(head), ...rest].join(' ')
}
