export type NarratorVoice = 'chronicler' | 'neighbour' | 'almanac'

export const NARRATOR_VOICE: NarratorVoice = 'chronicler'

const BIOGRAPHY_SHAPE =
  'Three paragraphs and no more: who they are, what they did this week, what changed in them. ' +
  'Never a tick and never an event number in a sentence.'

type VoiceInstructions = { chapter: string; era: string; biography: string }

export const NARRATOR_VOICES: Record<NarratorVoice, VoiceInstructions> = {
  chronicler: {
    chapter:
      'Write the day in third person and the past tense, plain and warm, two or three short paragraphs. ' +
      'Name people and give each of them one thing they did. A place is a place, never a coordinate.',
    era: 'Write the week in third person and the past tense, one warm paragraph on how it turned.',
    biography: `Write a life in third person and the past tense, plain and warm. ${BIOGRAPHY_SHAPE}`,
  },
  neighbour: {
    chapter:
      'Write the day as the village telling it about itself: "we", past tense, short sentences. ' +
      'One concrete detail for each person you name — what their hands were doing, what they carried, where they stood.',
    era: 'Write the week as the village telling it about itself: "we", short sentences, one paragraph.',
    biography: `Write a life as the village telling it: "we" knew them, short sentences, one concrete detail apiece. ${BIOGRAPHY_SHAPE}`,
  },
  almanac: {
    chapter:
      'Write the day as an almanac entry, dated and terse. Weather first, one clause. ' +
      'Then one line per happening, the shortest form that still says who and what. Set every name in **bold**.',
    era: 'Write the week as an almanac entry: the season first, then one line per day that mattered. Set every name in **bold**.',
    biography: `Write a life as an almanac would keep it: terse lines, no flourish, every name in **bold**. ${BIOGRAPHY_SHAPE}`,
  },
}
