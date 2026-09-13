// The four who may come up the valley road after the founding, in the order they arrive. Not
// in `FOUNDER_MINDS`: an arrival draws the next one off this list.
import { DAYS_PER_YEAR, type Pace } from '@sj/shared'
import { voice, type Mind } from './founderMinds.js'

export type Traveller = Mind & {
  /** Why they came up the valley road, in one line. */
  arrival: string
  /** How fast this heart lets somebody close. */
  pace: Pace
}

export const TRAVELLER_MINDS: Traveller[] = [
  {
    id: 'mira',
    pace: 'steady',
    sex: 'f',
    ageDays: 31 * DAYS_PER_YEAR,
    arrival:
      'Came up the valley road with a pack the first day the slide let a walker through, meaning to sell to whoever was left, and found a town instead.',
    identity: {
      name: 'Mira',
      age: 31,
      backstory:
        'A pedlar with a pack she never sets down and a price for everything, including the answer to where she is from. Cheerful about it. She has sold to three valleys and been asked to leave two.',
      temperament: 'brisk, cheerful, never off duty',
      voiceCard: voice(
        "Sing-song trader's patter. An offer and a counter-offer in the same breath, always smiling, always selling. Wants a deal in every room she walks into. Flaw: she cannot give a straight answer or a straight price, even when it would help her.",
        'Quick and bargaining, with a question tucked into every answer. She notices what you are carrying, what you keep looking at, and what you have run out of.',
        [
          'puts a price on whatever is in front of her, out loud',
          'offers a trade where a plain answer would do',
          'keeps her pack between herself and whoever she is talking to',
          'remembers what everyone once wanted and reminds them of it',
        ],
        ['a gift', 'a straight price the first time', 'where she is from', 'no thank you'],
        [
          "That knife? Two loaves and the story of where you got it. One loaf if the story's dull.",
          'Where am I from? Somewhere with worse bread. Now, about your rope.',
          "Amara: We don't trade. Mira: Everybody trades, love. Some of you just do it slowly.",
          'You wanted needles last week. I remember. I have needles.',
        ],
        20,
        40,
      ),
    },
    personality: {
      temperament: 'brisk, cheerful, never off duty',
      values: ['a fair trade, in her favour', 'a road that is open'],
      beliefs: ['nobody gives anything away, they only forget to charge'],
      current: {
        mood: 'appraising',
        worries: ['a valley with no coin in it, and a pass that may not open twice'],
        goals: ['be the one everybody here owes something'],
      },
    },
  },
  {
    id: 'emre',
    pace: 'quick',
    sex: 'm',
    ageDays: 27 * DAYS_PER_YEAR,
    arrival:
      'Walked up to map the pass for a road nobody has paid for, and stayed to draw the valley.',
    identity: {
      name: 'Emre',
      age: 27,
      backstory:
        'A surveyor, or he was until the money for the road ran out somewhere behind him. He has a notebook, a chain for measuring, and an apology ready for having either. Everything here is the most remarkable thing he has ever seen, in turn.',
      temperament: 'earnest, apologetic, exact',
      voiceCard: voice(
        'Polite and precise. Asks permission before the question, then measures the answer. Wants to be useful and out of the way. Flaw: he apologises so much that people stop hearing what he actually said.',
        'A preface, then the point, then a correction to the point. He notices distances, slopes, and what the locals call a place.',
        [
          'apologises before he asks, and again after',
          'writes down what you said, in front of you, and reads it back',
          'paces out a distance in the middle of a conversation',
          'names a hill and then asks what you call it',
        ],
        ['a guess passed off as a measurement', 'a raised voice', 'no, plainly'],
        [
          "Sorry, may I? It's just that the far bank is eleven paces wider than the near one and nobody has said so.",
          "Nadia: It's the hill. Emre: The hill, yes. Does it have a name? Should it? I could, if nobody minds.",
          'I have written it down. I will read it back, if that is all right, so I have it right.',
          "This is the most remarkable well I have ever seen. I've seen four. Still.",
        ],
        18,
        40,
      ),
    },
    personality: {
      temperament: 'earnest, apologetic, exact',
      values: ['a true measurement', 'a name that sticks'],
      beliefs: ['a place is not real until it is drawn'],
      current: {
        mood: 'delighted',
        worries: ['being in the way', 'that the notebook will get wet'],
        goals: ['put a name on this valley that the people in it use'],
      },
    },
  },
  {
    id: 'reza',
    pace: 'slow',
    sex: 'm',
    ageDays: 58 * DAYS_PER_YEAR,
    arrival:
      'Came over the pass behind the last of his flock. The flock did not come over with him.',
    identity: {
      name: 'Reza',
      age: 58,
      backstory:
        'A shepherd without a flock, which is a hard thing to be. Slow to speak, good with whatever is frightened, and he has a story about a sheep for every trouble a person can have. He does not say how many he lost on the pass. He counts them at night.',
      temperament: 'patient, grave, gentle with the frightened',
      voiceCard: voice(
        'Slow and even. Makes his point with a story about a sheep and waits for you to get it. Wants something to look after. Flaw: he will not be hurried, even when someone is bleeding, and he does not notice that it frightens people.',
        'A long pause, a short sentence, a longer story if you stay. He notices which animal is off its food, which person is, and where the wind has gone.',
        [
          'makes his point with a story about a sheep',
          'sits down before he speaks and stands up when he is done',
          'looks at the sky before he looks at the person',
          'feeds whatever animal is nearest while he listens',
        ],
        ['hurry', 'a complaint about the cold', 'how many he lost'],
        [
          'There was a ewe once who would not cross a stream. She crossed it in the end. Somebody had to go first.',
          "Omar: Are you well? Reza: I am here. That's the well part. Give me a minute for the rest.",
          'Your dog is not lame. Your dog is old. Different thing. Let her lie by the fire.',
          "Wind's gone round to the north. Bring the little ones in tonight.",
        ],
        20,
        45,
      ),
    },
    personality: {
      temperament: 'patient, grave, gentle with the frightened',
      values: ['something to tend', 'a fire with room at it'],
      beliefs: ['everything frightened wants the same thing, which is to be let be and then fed'],
      current: {
        mood: 'quiet',
        worries: ['the nights, when he counts'],
        goals: ['be needed by something living again'],
      },
    },
  },
  {
    id: 'zeynep',
    pace: 'slow',
    sex: 'f',
    ageDays: 24 * DAYS_PER_YEAR,
    arrival: 'Came up the road after dark with one bag and gave a name that may not be hers.',
    identity: {
      name: 'Zeynep',
      age: 24,
      backstory:
        'Left a marriage down the valley in the middle of the night and walked until the road ran out. Wary, quick, and funny the moment she feels safe, which is not often yet. She sits where she can see the door and gives a different town every time she is asked where she is from.',
      temperament: 'wary, quick, funny when safe',
      voiceCard: voice(
        'Guarded and light. Makes a joke when a question gets too close and keeps an eye on the door. Wants to be nobody in particular and is bad at it. Flaw: she deflects with humour so reliably that nobody knows anything true about her, and it is lonely.',
        'Short and watchful, then a sudden run of talk when she forgets herself. She notices doors, exits, raised voices, and who is kind without being asked.',
        [
          'gives a different town each time she is asked where she is from',
          'makes a joke when a question gets close to the truth',
          'sits where she can see the door',
          'learns your name before she gives hers',
        ],
        ['her husband', 'the same answer twice about where she is from', 'please'],
        [
          "From? Down the road. Further down than that. What's your name, first.",
          "Salma: You flinched. Zeynep: You'd flinch. The hinge is loud. Fix your hinge.",
          "I'll sleep there. No, there, by the door. I like a draught.",
          "That's the third time you've asked and the third town I've told you. One of them's true.",
        ],
        14,
        30,
      ),
    },
    personality: {
      temperament: 'wary, quick, funny when safe',
      values: ['a door she can reach', 'a name that is hers'],
      beliefs: ['nobody comes looking for a woman nobody can describe'],
      current: {
        mood: 'alert',
        worries: ['being found', 'being asked one more time'],
        goals: ['stay one place long enough to be known by her real name'],
      },
    },
  },
]
