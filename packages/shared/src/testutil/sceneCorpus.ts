// Recorded, not written. Every `thought`, `speech`, `move` and `leave` below is a real answer a
// model gave to the scene prototype (`docs/superpowers/specs/v2/scene-proto`) on the pinned mind
// route and two stronger ones; `importance` replays the values the gate rehearsal's own turn
// answers carried. `gesture`, `stance` and `answer` are null because no recording has them.

/** One recorded answer, in the shape a scene turn is asked for. */
export type SceneCorpusLine = {
  /** The founder who said it, by id. */
  speaker: string
  thought: string
  speech: string
  move: 'press' | 'give_way' | 'deflect' | 'tease' | 'none'
  leave: boolean
  importance: number
}

export type SceneCorpusScene = {
  /** The prototype seed and the route that answered it. */
  seed: string
  model: string
  lines: SceneCorpusLine[]
}

export const SCENE_CORPUS: readonly SceneCorpusScene[] = [
  {
    seed: 'A',
    model: 'glm-5.3-flash (Wafer/DeepInfra)',
    lines: [
      {
        speaker: 'nadia',
        thought: 'He looks like a man carrying more than wood.',
        speech:
          "Omar. Planks. I know, I know, the little one. But I've told Salma and I've told Ruth they're coming, so I need a day. Today, tomorrow. Out loud, not soon.",
        move: 'press',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'omar',
        thought: "I wanted her to ask first. She didn't.",
        speech:
          "You told two people already, Nadia. Before you asked me how she keeps down the broth. That's the part I keep chewing on.",
        move: 'press',
        leave: false,
        importance: 3,
      },
      {
        speaker: 'nadia',
        thought: "Caught, and it stings more because he's right.",
        speech:
          "I told them because you said yes, Omar. That's the chain. You said yes first, I just... passed it on. And I did ask about the broth, I asked first, actually. Look. Sick child, I get it, I'm not a monster. But Ruth is counting on those planks for her roof and it's my name on it now, so give me a day. Today. Tomorrow at the latest. Say it and I'll leave you alone, I swear.",
        move: 'press',
        leave: false,
        importance: 2,
      },
      {
        speaker: 'omar',
        thought: 'She did ask. I owed her that.',
        speech:
          "She asked first. Fine, I'll give you that. Tomorrow, then. Before noon, and I'll carry them myself, so Ruth hears it from my mouth too. But Nadia, the girl ate a whole bowl this morning. You can tell them that part as well.",
        move: 'give_way',
        leave: false,
        importance: 5,
      },
      {
        speaker: 'nadia',
        thought: 'Relief, and a small sting of shame under it.',
        speech:
          "Tomorrow before noon, carried by your own arms, and Ruth hears it from you. That's better than I hoped for, honestly. And I'll tell them about the bowl. Whole bowl, your mouth, my word on it. Go sit with her.",
        move: 'give_way',
        leave: true,
        importance: 4,
      },
    ],
  },
  {
    seed: 'B',
    model: 'glm-5.3-flash (Wafer/DeepInfra)',
    lines: [
      {
        speaker: 'salma',
        thought: 'He knows I know. Good.',
        speech: 'You going to stand there all night, or until she walks past again.',
        move: 'tease',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'yusuf',
        thought: "She's seen it. No use pretending.",
        speech: "Until the fire burns down. You got a question, ask it plain or don't.",
        move: 'deflect',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'salma',
        thought: "He'll know why I asked. Good.",
        speech:
          'Plain. Fine. The third beam, the crooked one. That was on purpose, or were your hands cold?',
        move: 'tease',
        leave: false,
        importance: 7,
      },
      {
        speaker: 'yusuf',
        thought: "Her eyes are kind. That's the danger.",
        speech: "The third beam sits true. Ask Salma, she's slept under it twice.",
        move: 'deflect',
        leave: false,
        importance: 3,
      },
      {
        speaker: 'salma',
        thought: "He's guarding the wrong door.",
        speech:
          'He checked the beam for me. Very thorough, Yusuf. You check anything else of mine that close?',
        move: 'tease',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'yusuf',
        thought: "She hit close. I'm not ready for this.",
        speech: "Your firewood's damp. That's why it smokes.",
        move: 'deflect',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'salma',
        thought: 'Come on. Just say her name, Yusuf.',
        speech: "Damp wood. That the only thing of mine you've been keeping an eye on?",
        move: 'press',
        leave: false,
        importance: 5,
      },
      {
        speaker: 'yusuf',
        thought: "She's close. Too close, and I fed her.",
        speech:
          "Amara took the short beams yesterday. Saved me the walk. There's your keeping an eye on.",
        move: 'deflect',
        leave: false,
        importance: 5,
      },
      {
        speaker: 'salma',
        thought: 'He walked straight into it. Feels almost unfair.',
        speech: 'There it is. You brought her up all by yourself.',
        move: 'press',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'yusuf',
        thought: "Caught. She'll pry it out of me by spring.",
        speech: "Wood's popping. That's the damp, not me talking.",
        move: 'deflect',
        leave: false,
        importance: 4,
      },
    ],
  },
  {
    seed: 'C',
    model: 'glm-5.3-flash (Wafer/DeepInfra)',
    lines: [
      {
        speaker: 'amara',
        thought: "If she balks, I've already lost the morning.",
        speech: "Well's dry. I counted the buckets, Salma. Yours first, everyone after, agreed?",
        move: 'press',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'salma',
        thought: 'She keeps ledgers on people. Tiring.',
        speech: 'You counted my buckets at midnight? Get some sleep, Amara.',
        move: 'deflect',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'amara',
        thought: "Her laughing won't fill the well.",
        speech:
          "I don't sleep much. Doesn't change the numbers. Yours first, or somebody else decides for you.",
        move: 'press',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'salma',
        thought: "Being on anybody's list is the thing I can't stand.",
        speech:
          "Somebody else deciding for me. That's new. Didn't realize the well came with a landlord. I'll carry back double today, every day, and you can cross me off your list for good.",
        move: 'press',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'amara',
        thought: "She'll do it. I just need it said.",
        speech: "Double's fine. But the order stands. Yours first, say it.",
        move: 'press',
        leave: false,
        importance: 5,
      },
      {
        speaker: 'salma',
        thought: 'He wants the words, not the water. No.',
        speech:
          "Fine. I'm standing here, aren't I? Rope's in my hand. Write that down however you like.",
        move: 'give_way',
        leave: true,
        importance: 5,
      },
    ],
  },
  {
    seed: 'B',
    model: 'google/gemini-3.7-flash',
    lines: [
      {
        speaker: 'salma',
        thought: 'Spit it out, Yusuf.',
        speech: 'Amara was asking after you. Told her you forgot how to talk.',
        move: 'tease',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'yusuf',
        thought: 'She knows too much already.',
        speech: 'Fire is spitting sparks, Salma. Pine is too green.',
        move: 'deflect',
        leave: false,
        importance: 8,
      },
      {
        speaker: 'salma',
        thought: 'He dodges like a rabbit in brush.',
        speech: 'Pine is fine. Must be sparks turning your neck red.',
        move: 'tease',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'yusuf',
        thought: 'Too sharp by half, that woman.',
        speech: 'Wind is cold off the river. Sit down, Salma.',
        move: 'deflect',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'salma',
        thought: 'He will break before I do.',
        speech: "Cold river. Good thing you spent midday staring at Amara's porch.",
        move: 'tease',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'yusuf',
        thought: 'She knows too much.',
        speech: 'Her front step is leaning, Salma. Needs truing.',
        move: 'deflect',
        leave: false,
        importance: 5,
      },
      {
        speaker: 'salma',
        thought: 'He never was any good at lying.',
        speech: 'Needs truing. Must take three hours of hard staring, Yusuf.',
        move: 'tease',
        leave: false,
        importance: 2,
      },
      {
        speaker: 'yusuf',
        thought: 'She will not let a man sit quiet.',
        speech: 'A bad join takes time, Salma. Kick that log in.',
        move: 'deflect',
        leave: false,
        importance: 2,
      },
      {
        speaker: 'salma',
        thought: 'He is red as a beet.',
        speech: "Took three hours staring, Yusuf. Surprised the step didn't fix itself.",
        move: 'tease',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'yusuf',
        thought: "She won't let this bone go.",
        speech: 'Cedar burns too fast anyway. Pass me that green pine, Salma.',
        move: 'deflect',
        leave: false,
        importance: 6,
      },
    ],
  },
  {
    seed: 'B',
    model: 'openai/gpt-5.6-luna',
    lines: [
      {
        speaker: 'salma',
        thought: 'I want the truth, not the satisfaction.',
        speech: 'You go quiet whenever Amara passes. Very subtle, Yusuf.',
        move: 'tease',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'yusuf',
        thought: 'The cold is easier than this question.',
        speech: "The fire's loud enough. Pass me that split log, Salma.",
        move: 'deflect',
        leave: false,
        importance: 3,
      },
      {
        speaker: 'salma',
        thought: 'The silence between us feels almost useful.',
        speech: 'Of course. It drowns out all sorts of things.',
        move: 'tease',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'yusuf',
        thought: 'I want the fire, not her sharp eyes.',
        speech: 'That shutter’s hung wrong. Rain’ll find the bed by morning.',
        move: 'deflect',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'salma',
        thought: 'The cold isn’t the reason my hands shake.',
        speech: 'You noticed the shutter. Amara noticed you. Everybody’s observant tonight.',
        move: 'tease',
        leave: false,
        importance: 6,
      },
      {
        speaker: 'yusuf',
        thought: 'The fire is easier company than this question.',
        speech: 'Then everybody can mend what they notice. Hand me that hinge.',
        move: 'deflect',
        leave: false,
        importance: 3,
      },
      {
        speaker: 'salma',
        thought: 'His silence is warmer than the fire.',
        speech: 'You can fix wood. Shame about what you won’t name.',
        move: 'press',
        leave: false,
        importance: 5,
      },
      {
        speaker: 'yusuf',
        thought: 'The fire is easier company than this.',
        speech: 'The hinge is bent. Fetch the other one, Salma.',
        move: 'deflect',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'salma',
        thought: 'I want him to deny it, plainly, once.',
        speech: 'Fine. The hinge. Amara can keep the observing.',
        move: 'tease',
        leave: false,
        importance: 4,
      },
      {
        speaker: 'yusuf',
        thought: 'Glad for the cold, not her question.',
        speech: 'The door ought to face morning. Hold it, Salma.',
        move: 'deflect',
        leave: false,
        importance: 4,
      },
    ],
  },
]

/** Every recorded line, flattened, for a fake that only needs the next answer. */
export const SCENE_CORPUS_LINES: readonly SceneCorpusLine[] = SCENE_CORPUS.flatMap((s) => s.lines)
