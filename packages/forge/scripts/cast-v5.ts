// The five founders, re-authored for the CONTEMPORARY valley from c8-founders.md. Those sheets
// say almost nothing about clothes, so the costumes below are DERIVED from role, age and
// period — that derivation is the part a human should argue with. Omar keeps CHAR_DESC_V4,
// the one design a human has signed off, and is not re-derived.
export type CastMember = {
  id: string
  /** swaps in for CHAR_DESC_V4 in the calibrated prompts */
  desc: string
  /** swaps in for FEATURE_CAP_V4 — the three-feature cap, named positively then closed */
  featureCap: string
}

export const CAST_V5: readonly CastMember[] = [
  {
    // 24, m — improviser, tinkerer, machine repair; keeper of the generator. The approved design.
    id: 'omar',
    desc:
      'a lanky young man of about twenty-four, about 3 heads tall, wearing a sage-green cap, a ' +
      'plain white short-sleeved T-shirt under honey-brown work overalls with the bib buckled, ' +
      'and a small brown tool satchel on one hip',
    featureCap:
      'Only THREE signature features: the sage-green cap, the honey-brown overalls, the brown ' +
      'tool satchel. No collar detail, no rolled sleeves, no tools in hand, no extra props.',
  },
  {
    // 38, f — nurse of eleven years' wards and agency nights; the bag is in her voice card.
    id: 'amara',
    desc:
      'a calm woman of about thirty-eight, about 3 heads tall, with dark hair tied back, wearing ' +
      'a slate-blue zip-up fleece over a cream long-sleeved top, plain dark trousers, and a flat ' +
      'canvas shoulder bag hanging at her hip on a WIDE strap across her chest',
    featureCap:
      'Only THREE signature features: the slate-blue fleece, the wide-strapped shoulder bag, the ' +
      'dark tied-back hair. No headscarf, no apron, no herbs, no jewelry, no extra props.',
  },
  {
    // 52, m — thirty years a joiner; "my saw, my hands, my roof". The belt is the trade, worn.
    id: 'yusuf',
    desc:
      'a solid, heavy-shouldered man of about fifty-two, about 3 heads tall, with a short grey ' +
      'beard, wearing a warm-grey padded work jacket over a cream shirt, honey-brown canvas work ' +
      'trousers, and a worn leather tool belt at his waist',
    featureCap:
      'Only THREE signature features: the short grey beard, the warm-grey work jacket, the leather ' +
      'tool belt. No flat cap, no tools in hand, no pencil behind the ear, no extra props.',
  },
  {
    // 29, f — planner, counts everything. Hands EMPTY: round 3 lost her three times to a ledger.
    id: 'nadia',
    desc:
      'a young woman of about twenty-nine, about 3 heads tall, with honey-brown hair in a single ' +
      'long braid over one shoulder, wearing a sage-green quilted body-warmer gilet over a cream ' +
      'long-sleeved shirt, and dark denim jeans tucked into short boots',
    featureCap:
      'Only THREE signature features: the single long braid, the sage-green gilet, the dark jeans. ' +
      'No sun hat, no ledger, no clipboard, no papers, no basket, no extra props. Both hands are ' +
      'EMPTY: nothing held in either hand.',
  },
  {
    // 45, f — cook and quartermaster; the apron is the office, the cardigan is the person.
    id: 'salma',
    desc:
      'a stout, comfortable woman of about forty-five, about 3 heads tall, with dark hair in a neat ' +
      'round bun, wearing a dusty-rose knitted cardigan over a cream top and a plain white cooking ' +
      'apron tied at the waist',
    featureCap:
      'Only THREE signature features: the round hair bun, the dusty-rose cardigan, the white apron. ' +
      'No spoon, no ladle, no kerchief, no oven glove, no extra props.',
  },
  // The seven who joined the founding, from `founderMinds.ts`; costumes derived from trade and
  // age the same way. Hands EMPTY throughout: a held thing is the thing the gates lose a sheet to.
  {
    // 37, f — tailor; the tape measure is the trade, the headscarf sets her apart from Salma's bun.
    id: 'farida',
    desc:
      'a slim, upright woman of about thirty-seven, about 3 heads tall, with dark hair tied back ' +
      'under a mustard-yellow headscarf knotted at the nape, wearing a plum-purple button-up ' +
      'cardigan over a cream blouse, charcoal trousers, and a yellow tape measure draped around ' +
      'her neck with both ends hanging down her front',
    featureCap:
      'Only THREE signature features: the mustard-yellow headscarf, the plum-purple cardigan, the ' +
      'tape measure around the neck. No pins, no scissors, no needles, no glasses, no extra props. ' +
      'Both hands are EMPTY.',
  },
  {
    // 39, m — fisherman; big, loud, and dressed for the water.
    id: 'bashir',
    desc:
      'a broad, big-bellied man of about thirty-nine, about 3 heads tall, with a short black ' +
      'beard, wearing a rust-orange knitted beanie, a navy-blue waterproof fishing jacket open ' +
      'over a cream T-shirt, and tall olive-green rubber boots up to the knee',
    featureCap:
      'Only THREE signature features: the rust-orange beanie, the navy-blue fishing jacket, the ' +
      'tall olive-green rubber boots. No fish, no rod, no net, no bucket, no extra props. Both ' +
      'hands are EMPTY.',
  },
  {
    // 54, m — smith and mender of the generator; the coverall is the office.
    id: 'kamal',
    desc:
      'a barrel-chested man of about fifty-four, about 3 heads tall, bald on top with a thick ' +
      'dark moustache, wearing a charcoal-grey work coverall with the sleeves rolled to the ' +
      'elbow, a coral-red neckerchief knotted at the throat, and heavy dark work boots',
    featureCap:
      'Only THREE signature features: the bald head with the dark moustache, the charcoal-grey ' +
      'coverall, the coral-red neckerchief. No hammer, no spanner, no apron, no goggles, no extra ' +
      'props. Both hands are EMPTY.',
  },
  {
    // 51, f — brewer; warm and pinned-up, the lavender keeps her off Salma's rose.
    id: 'leyla',
    desc:
      'a plump, smiling woman of about fifty-one, about 3 heads tall, with grey-streaked dark ' +
      'hair in a braid pinned up around her head, wearing a lavender-purple quilted body-warmer ' +
      'gilet over a cream long-sleeved dress that reaches mid-calf, and short brown boots',
    featureCap:
      'Only THREE signature features: the pinned-up grey-streaked braid, the lavender-purple gilet, ' +
      'the cream dress. No cup, no jug, no tray, no apron, no extra props. Both hands are EMPTY.',
  },
  {
    // 22, m — the son who will not be a smith; slouch, hood, torn knee.
    id: 'tariq',
    desc:
      'a thin, slouching young man of about twenty-two, about 3 heads tall, with shaggy black ' +
      'hair falling over his eyes, wearing a charcoal-grey hooded sweatshirt with the hood down, ' +
      'faded pale-blue jeans with a torn knee, and white canvas sneakers',
    featureCap:
      'Only THREE signature features: the shaggy black hair, the charcoal-grey hoodie, the ' +
      'pale-blue torn jeans. The hoodie is ONE dark charcoal-grey colour in every frame, worn ' +
      'open with no zip, no lighter panel and no shirt showing. No notebook, no pen, no guitar, ' +
      'no headphones, no extra props. Both hands are EMPTY.',
  },
  {
    // 67, m — the old schoolmaster; the waistcoat is the last of the classroom.
    id: 'halim',
    desc:
      'a stooped, thin old man of about sixty-seven, about 3 heads tall, with white hair combed ' +
      'back and a neat short white beard, wearing a moss-green wool waistcoat buttoned over a ' +
      'white shirt with the collar done up, tan corduroy trousers, and brown leather shoes',
    featureCap:
      'Only THREE signature features: the white beard, the moss-green waistcoat, the tan corduroy ' +
      'trousers. No walking stick, no glasses, no book, no hat, no extra props. Both hands are ' +
      'EMPTY.',
  },
  {
    // 33, f — hunter and trapper; cropped hair and a waxed jacket, nothing Nadia wears.
    id: 'dilara',
    desc:
      'a lean, wiry woman of about thirty-three, about 3 heads tall, with dark hair cropped ' +
      'short, wearing a dark olive-green waxed field jacket zipped over a grey T-shirt, khaki ' +
      'cargo trousers tucked into dark laced boots',
    featureCap:
      'Only THREE signature features: the cropped dark hair, the olive-green waxed jacket, the ' +
      'khaki cargo trousers. No bow, no rope, no knife, no snare, no bag, no extra props. Both ' +
      'hands are EMPTY.',
  },
  // The four travellers, from `travellerMinds.ts`.
  {
    // 31, f — pedlar; the pack never comes off, so it is one of her three.
    id: 'mira',
    desc:
      'a small, quick woman of about thirty-one, about 3 heads tall, with curly red-brown hair ' +
      'held back by a coral-red knitted headband, wearing a mustard-yellow anorak, dark trousers, ' +
      'and a large tan canvas backpack worn on both shoulders',
    featureCap:
      'Only THREE signature features: the coral-red headband, the mustard-yellow anorak, the tan ' +
      'backpack. No basket, no cart, no goods in hand, no hat, no extra props. Both hands are ' +
      'EMPTY.',
  },
  {
    // 27, m — surveyor; the vest says the trade without a single tool. Soft orange, not
    // high-visibility: the neon one measured 32 against a palette ceiling of 25.
    id: 'emre',
    desc:
      'a tall, thin young man of about twenty-seven, about 3 heads tall, with neat short brown ' +
      'hair and round glasses, wearing a soft peach-orange sleeveless work vest over a pale ' +
      'sky-blue long-sleeved shirt, grey trousers, and brown hiking boots',
    featureCap:
      'Only THREE signature features: the round glasses, the peach-orange work vest, the ' +
      'pale sky-blue shirt. No notebook, no tripod, no measuring pole, no clipboard, no extra ' +
      'props. Both hands are EMPTY.',
  },
  {
    // 58, m — shepherd without a flock; a long coat for the pass.
    id: 'reza',
    desc:
      'a weathered, broad man of about fifty-eight, about 3 heads tall, with a grey stubbled ' +
      'beard, wearing a brown flat cap, a long dark-brown wool overcoat reaching the knee over a ' +
      'cream jumper, and dark trousers over black boots',
    featureCap:
      'Only THREE signature features: the brown flat cap, the long dark-brown overcoat, the grey ' +
      'stubbled beard. No crook, no staff, no dog, no sheep, no extra props. Both hands are EMPTY.',
  },
  {
    // 24, f — came up the road at night with one bag; the jacket is borrowed and too big.
    id: 'zeynep',
    desc:
      'a slight young woman of about twenty-four, about 3 heads tall, with long straight black ' +
      'hair worn loose over one shoulder, wearing an oversized sky-blue denim jacket over a white ' +
      'T-shirt, black leggings, and black ankle boots',
    featureCap:
      'Only THREE signature features: the long loose black hair, the oversized sky-blue denim ' +
      'jacket, the black leggings. No bag, no hood, no scarf, no jewelry, no extra props. Both ' +
      'hands are EMPTY.',
  },
]

/** Omar first, and not by alphabet: his master sheet is the proportion reference every other
 *  founder's master call carries. Round 3 measured what happens without one — Nadia came back
 *  at 4.5 heads in a finer pixel, and her back figure faced the wrong way. */
export const PROPORTION_ANCHOR_ID = 'omar'
