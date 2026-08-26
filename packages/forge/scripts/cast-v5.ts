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
]

/** Omar first, and not by alphabet: his master sheet is the proportion reference every other
 *  founder's master call carries. Round 3 measured what happens without one — Nadia came back
 *  at 4.5 heads in a finer pixel, and her back figure faced the wrong way. */
export const PROPORTION_ANCHOR_ID = 'omar'
