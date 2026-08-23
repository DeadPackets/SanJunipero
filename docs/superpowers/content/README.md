# The discovery tree and the five founders, re-authored — for your approval

You approved both of these when San Junipero was a stone-age world. You have since set the period to
contemporary rural, and asked for both to be rewritten and shown to you before anything uses them.

That is what is in this folder. **Nothing here is wired into the engine.** No code was touched — the two
documents and this page are the whole change.

| File | What it is |
|---|---|
| `c8-discovery-tree.md` | 103 nodes: everything the town can find, and what it has to already know to find it |
| `c8-founders.md` | The five people who wake up on the first morning, and what they wake up remembering |

The originals are untouched where they were, in `.claude/scratch/archive/physics-verbs-superpowers/`.

---

## The tree

**Its premise changed, so it is not a rename.** The old tree was civilisation from zero: making fire from
nothing, chipping stone to an edge, twisting plant fibre into rope, a mud-brick oven, then copper, then
iron, then steam. A town with a working generator does not discover how to make a pot. Renaming those
hundred nodes would have produced nonsense, so the arc was re-thought from the canon up.

**The era arc.** The five rungs are no longer centuries; they are distances. `handwork` is what these
hands already do on the first morning — farming, fishing, foraging, carpentry, masonry, tailoring, cooking,
and keeping the generator running — and nothing on that rung is a discovery at all; it is the floor. One
step out is `arrangement`, and this is where the tree now spends its weight: a turn agreed at the well, who
eats first when there is not enough, the count said out loud at the storehouse door, the lent saw brought
back sharp. `works` is anything that needs a place built for it or a season's patience — the race dug from
the upper fork, soap boiled out of ash and fat, a room kept clean for the ill, an argument brought to one
ground at one hour instead of happening everywhere at once. `machinery` is not manufacture and never
becomes it: it is a dead machine stripped for what still turns, a part cut to fit where the right one will
never come, a wheel put in the race, a burnt motor rewound by somebody patient enough to count the turns —
and, just as often, the agreement about who may use the thing and who is answerable for it. `industry`, the
far edge, is where the valley gets large enough to outlast the people in it: current strung to every roof,
a store filled by people who will not eat from it, what we agreed written once with every name under it,
and deciding out loud what the last of the fuel is for. Nobody ever builds a factory. There is nowhere for
one to come from.

**Half the tree is now social, and that is the point.** The old draft had 11 social nodes in 104 — about
one in ten. The canon says the opposite in its own words: the new thing this town finds "is far more often
an arrangement between its people … than a machine nobody here could build". So the count is now **52 of
103**, a bare majority. More than half, because the canon says *more often*. Only just more than half,
because an arrangement has to be an arrangement *about* something, and the crafts are what there is to
arrange.

**What survived from the old tree.** Its shape, exactly: one node per block, the same eight fields in the
same order, the same unlock namespaces, the same DAG rule. A transcriber will not be able to tell the two
files apart structurally. Some individual nodes survived a change of century almost intact — preserving
food, bridging the fork, splinting a break, a night watch, teaching children on purpose, writing down what
is owed. Roughly a dozen carried over in substance. The other ninety are new, because the old ones were
about a world with no metal in it.

**One thing I want you to look at.** A comment in `canon.ts` says the top two rungs are "the ones the canon
puts out of reach for good". I have read that as *asymptotic rather than empty* — the town reaches toward
`machinery` and `industry` and gets there only by salvage, substitution and agreement, never by making
anything new out of raw material. So those rungs have 34 nodes between them rather than none. If you meant
them to be genuinely empty, that is 34 nodes to delete and it is a five-minute change. It is the single
biggest judgement call in the file.

---

## The five founders

You chose these people. They are the same five, with the same temperaments, the same grudges, the same
skills and the same secrets. What changed is only what the century forced.

**Amara**, 38, the healer. Raised by her aunt Halima — who is now a district nurse rather than a village
herbalist paid in eggs, and is otherwise the same woman. Amara spent eleven years on overflow wards and agency
nights, watched a counter refuse a prescription over a Wednesday and a Friday, and left during a flu winter
in a way she does not talk about. Her creed, her guilt, her insomnia and her secret are all unchanged.

**Yusuf**, 52, the builder. His father still lost the family's home to a signature; he was still nine. Twenty
years with Deniz, who now runs a joinery rather than a timber yard. Rahima, the sold bed, the workshop he
slept in afterwards — all intact. His secret is the same theft, and it is better in this century: the chest
of planes and chisels he took the night before the clearance, thirty years' earnings that were never paid
for, propping up a man whose whole creed is that you own what you earn.

**Nadia**, 29, the planner. Three Willows, the child who counted things, the plan at twenty-four that took
the farm — blight, then flood, then the bank. Her father works another man's land and is gentle with her
about it, which is still the worst part. This one needed almost nothing: a maltster's contract instead of a
maltster, a produce buyer's desk instead of a merchant's counting house. Her secret is untouched.

**Omar**, 24, the tinkerer who cannot read. Uncle Karim, one boat, one good eye. The bilge pump fixed at
twelve with a boot sole and a clip. The winters he missed school because the whitefish were running. He is
now the only person in the valley with a feel for the generator, which quietly makes him load-bearing in a
way he would love and has not noticed yet. His secret is unchanged and his dodges still work.

**Salma**, 45, the cook who keeps everyone's accounts. Nineteen years running the Gilded Ox, now a roadhouse
on the west road. Started at fourteen noticing things. Still not a widow; Tarek is still alive in Marash;
the burn scar is still a kitchen accident. Two counties instead of two towns, and a valley up a track over a
pass is the farthest distance yet offered.

**The one thing I had to invent.** The old shared memory was a land agent's printed advertisement and ten
days on the road to an empty meadow. The new one is grounded in what the code actually builds:
`cityTemplate.ts` puts eight
dwellings, a storehouse, a well and a fire pit on the map before anybody does anything, so the five did not
arrive at a meadow — **they arrived at a village somebody else had built and walked away from**, houses with
the furniture still in them. That is better than the meadow and it is not my invention; it was already in
the layout. What *is* mine is why nothing arrives from outside any more: they came up a single track over a
pass, and six weeks later the pass came down in a slide. The canon requires the valley to be cut off and
does not say why. If you would rather it were something else, that is one paragraph.

The standing stone out past the edge of town survives, still unexplained, exactly as `cityTemplate.ts`
intends it. Your signed amendment of 2026-08-17 — the sexes, the word budgets, the pronoun lines — is
carried forward with nothing re-decided, and is now also written inline in each voice card so a single sheet
is self-contained.

---

## How I checked it, rather than asserting it

A script at `.scratch/tree-check.mjs` parses the tree and proves the structural claims:

```
nodes: 103   handwork=8 arrangement=26 works=35 machinery=22 industry=12
[SOCIAL]: 52 of 103 (50.5%)
handwork rung (8 landed): farming, fishing, foraging, carpentry, masonry, tailoring, cooking, machine_repair
genesis frontier (5 landed): bridging, common_store, food_preserving, memorial, work_rota
DAG: acyclic, no forward citations, 103 nodes topologically ordered
PASS: every check above holds.
```

The line that matters most is the third and fourth. `canon.ts` landed thirteen ids and `setting.test.ts`
asserts them; the tree opens on exactly those thirteen and no others. The strongest check is the genesis
one: a node is reachable on the first morning if every one of its prereqs is a craft the town already
practises, and the script proves that **exactly five** nodes in 103 satisfy that — the five the canon names,
with the exact parents the canon gives them. Adjacency is not a claim in this file; it is enforced.

Every word-level grep returns nothing on both files: the wrong-century list, the one-way glass, and the
single banned noun for a thing you work with. I also ran the full `FORBIDDEN_FRAMING` and
`CONSTRUCT_VOCABULARY` constants rather than the short list, which caught three words the narrow greps
would have missed. This page passes the same greps, so the whole folder can be checked with one command.
