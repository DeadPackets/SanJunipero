// Founder cast identities for the production run (Asset Standard v3).
// Source of truth: docs/superpowers/specs/2026-08-15-san-junipero-design.md §10 +
// c8-founders.DRAFT.md persona sheets. Costumes are simplified to sprite scale per
// the v3 ruling (2-3 signature features; detail lives in portraits later).
// The approved reference character (CHAR_DESC_V4: young-adult, sage cap, white tee,
// honey overalls, satchel) maps to OMAR — the only young-adult male founder, and the
// dockside tinkerer the cap+satchel silhouette was designed around. Omar is NOT
// regenerated here.
export type CastMember = {
  id: string
  desc: string // swaps in for CHAR_DESC_V4 in the calibrated prompts
  featureCap: string // swaps in for FEATURE_CAP_V4
}

export const CAST_V4: readonly CastMember[] = [
  {
    id: 'amara',
    desc:
      'a kind adult woman villager, about 3 heads tall, wearing a soft water-blue headscarf, ' +
      'a cream apron dress over a warm-grey skirt, and a small brown herb satchel on one hip',
    featureCap:
      'Only THREE signature features: the water-blue headscarf, the cream apron dress, the brown ' +
      'satchel. No collar detail, no herbs, no jewelry, no extra props or accessories.',
  },
  {
    id: 'yusuf',
    desc:
      'a sturdy older man villager, about 3 heads tall, with a short grey beard, wearing a ' +
      'warm-grey flat cap and a honey-brown carpenter apron over a cream shirt',
    featureCap:
      'Only THREE signature features: the grey beard, the warm-grey flat cap, the honey-brown ' +
      'carpenter apron. No tools, no belt detail, no extra props or accessories.',
  },
  {
    id: 'nadia',
    desc:
      'a young adult woman villager, about 3 heads tall, with honey-brown hair in a single long ' +
      'braid, wearing a wide-brim straw sun hat and a sage-green work dress',
    featureCap:
      'Only THREE signature features: the straw sun hat, the single braid, the sage-green dress. ' +
      'No ledger, no papers, no basket, no extra props or accessories. Both hands are EMPTY: ' +
      'no book, nothing held in either hand.',
  },
  {
    id: 'salma',
    desc:
      'a stout middle-aged woman villager, about 3 heads tall, with dark hair in a neat round bun, ' +
      'wearing a dusty-rose dress with a white cooking apron',
    featureCap:
      'Only THREE signature features: the round hair bun, the dusty-rose dress, the white apron. ' +
      'No spoon, no ladle, no kerchief, no extra props or accessories.',
  },
]
