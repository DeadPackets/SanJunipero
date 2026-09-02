# Scene prototype — four registers, three seeds

Throwaway mock. Real personas and voice cards from `packages/agents/src/live/founderMinds.ts`; `RULES_OF_BEING` and `SPEECH_RULES` verbatim from `packages/agents/src/prompt/rulesOfBeing.ts`. Mind route pinned exactly as caller `turn` is pinned: `z-ai/glm-5.3-flash`, provider order Wafer then DeepInfra, temperature 1, 600 output tokens.

| register | seed | model | lines | s | $ | exit |
|---|---|---|---|---|---|---|
| plain | A | glm-5.3-flash | 7 | 37.5 | 0.00104 | Nadia walked |
| plain | B | glm-5.3-flash | 10 | 34.8 | 0.00158 | ran out of lines |
| plain | C | glm-5.3-flash | 10 | 52.7 | 0.00117 | Salma walked |
| wants | A | glm-5.3-flash | 5 | 29.7 | 0.00111 | Nadia walked |
| wants | B | glm-5.3-flash | 10 | 30.5 | 0.00190 | ran out of lines |
| wants | C | glm-5.3-flash | 6 | 24.6 | 0.00091 | Salma walked |
| director | A | glm-5.3-flash | 3 | 45.0 | 0.00062 | Nadia walked |
| director | B | glm-5.3-flash | 10 | 43.9 | 0.00133 | ran out of lines |
| director | C | glm-5.3-flash | 10 | 46.3 | 0.00108 | ran out of lines |
| invention | A | glm-5.3-flash | 3 | 14.9 | 0.00060 | Nadia walked |
| invention | B | glm-5.3-flash | 6 | 27.3 | 0.00079 | ran out of lines |
| invention | C | glm-5.3-flash | 6 | 28.0 | 0.00110 | ran out of lines |
| wants | B | google/gemini-3.7-flash | 10 | 44.0 | 0.02741 | ran out of lines |
| wants | B | openai/gpt-5.6-luna | 10 | 33.0 | 0.00433 | ran out of lines |
| invention | C | google/gemini-3.7-flash | 6 | 25.4 | 0.01757 | ran out of lines |
| invention | C | openai/gpt-5.6-luna | 6 | 26.9 | 0.00370 | ran out of lines |

Total for the 16 scenes below: **$0.06625**.

---

## Register 1 — Plain village

Today's SPEECH_RULES as-is. Two-mind loop, no want, no status, no director. Exit: leave when you have nothing more worth saying. Cap 10 lines.

*Seed A — Nadia asks Omar for the planks he promised and did not bring. The half-finished store, mid-morning.*

#### Seed A

`glm-5.3-flash (Wafer/DeepInfra)` · 7 lines · 37.5s · $0.00104 · exit: Nadia walked

**Nadia:** Omar. Six planks, landslide day, you said yes without even looking. And I've told Salma and Penn they're coming, so that's on you now, not me. Not 'soon'. Say a day.
*(He looks wrecked. Doesn't change the planks.)* `escalate`

**Omar:** Nadia. Ask me first about the boy, then I'll talk planks till you're sick of it.
*(Two days by his bedside. Say it plain, Omar.)* `continue`

**Nadia:** Fine, the boy. How is he? Fever broke or not? Tell me that's a yes and I'll stand here all day about planks, honestly, I'll bring tea.
*(I do care. Both things are true at once.)* `continue`

**Omar:** Fever broke last night, near dawn. He asked for bread and ate the heel, crust and all. So yes. A yes I'd stake my name on.
*(She came. She asked. That's the part that matters.)* `continue`

**Nadia:** Oh, that's good, that's genuinely good, a boy eating a crust is a whole sermon. Okay. So he's up, which means you're up, which means today you can walk six planks over here. Midday. Don't make me name an hour and regret it.
*(Fever's done, I can push now.)* `escalate`

**Omar:** Midday, then. And since I'm up, I'll carry two at a time, which is still slower than your promise. Fair is fair.
*(She stung me. She's not wrong, though.)* `continue`

**Nadia:** Two at a time, look at him, negotiating. Fine, midday, and if Salma asks me where her wall planks are before you're here, I'm telling her the truth, that you were busy keeping a boy alive. Which sounds better than my excuse, so don't be late anyway.
*(He staked his name on it. Good.)* `leave`

*Seed B — Salma and Yusuf at the fire at dusk; she is sure he is sweet on Amara.*

#### Seed B

`glm-5.3-flash (Wafer/DeepInfra)` · 10 lines · 34.8s · $0.00158 · exit: ran out of lines

**Salma:** Cold enough for the good coat. Lucky Amara didn't see you hauling those beams in this. She'd have fussed.
*(There. Said her name. Watch his hands.)* `escalate`

**Yusuf:** Fussed over the beams, more like. They were green anyway.
*(She's circling. Don't hand her the rope.)* `continue`

**Salma:** Green beams, still standing. So much for your excuses.
*(Say Amara's name, Yusuf. Any day now.)* `continue`

**Yusuf:** She can fuss at the house instead. It's got walls now.
*(She's circling. Don't look toward the road.)* `continue`

**Salma:** Walls and a roof gap. She'll find something to fuss at.
*(Say her name again, see if he flinches.)* `continue`

**Yusuf:** Roof gap's next week's problem. Fire's tonight's.
*(She's circling. Don't feed it.)* `continue`

**Salma:** Funny how she walked past twice this week and you forgot how to talk both times.
*(Deadpan. Watch his hands, not his mouth.)* `escalate`

**Yusuf:** Didn't forget how to talk. Had nothing worth saying.
*(She saw. Of course she saw.)* `continue`

**Salma:** Nothing worth saying. That's new for you.
*(Caught him. Watch the hands, not the mouth.)* `continue`

**Yusuf:** Talk's cheap by a fire. Grab a log.
*(She's not letting go. Turn it with work.)* `continue`

*Seed C — The well ran dry; Amara wants a rule about who draws first. First light, Amara and Salma.*

#### Seed C

`glm-5.3-flash (Wafer/DeepInfra)` · 10 lines · 52.7s · $0.00117 · exit: Salma walked

**Amara:** Salma. Well's dry. You saw it first, or me?
*(She came at first light. Same as me. Habit?)* `continue`

**Salma:** You built it. You tell it.
*(She wants me on her list. No.)* `continue`

**Amara:** Bucket order, then. Families first, then whoever's standing. You second, me last.
*(She'll test the edge before she agrees.)* `continue`

**Salma:** Families first. So where's that put me?
*(Half bucket left. I'll take half.)* `escalate`

**Amara:** With the families, Salma. Not after them. You haul more than you drink and I know it.
*(Say the rule plain, then hold her eyes.)* `continue`

**Salma:** So I'm family now. Keep that under your hat.
*(She's offering cover. Why.)* `continue`

**Amara:** Not under my hat. Out where you can use it. Order starts tomorrow, sun-up. You in it or not?
*(She'll say yes. She always does the work.)* `continue`

**Salma:** Sun-up. Don't come looking if I'm not there. I'll be there.
*(She put me in the front and meant it.)* `continue`

**Amara:** Sun-up, then. Rope's worn near the hook. I'll splice it today.
*(She said she'd be there. That's enough.)* `continue`

**Salma:** Rope first, then. Rule can wait on a dry well.
*(She'd rather I asked. I won't.)* `leave`

---

## Register 2 — Wants and status

Each mind carries an explicit private want and must name a status move: press / give way / deflect / tease. The aside is a feeling, not a plan. Exit: someone won or the pot boiled over. Cap 10 lines.

*Seed A — Nadia asks Omar for the planks he promised and did not bring. The half-finished store, mid-morning.*

#### Seed A

`glm-5.3-flash (Wafer/DeepInfra)` · 5 lines · 29.7s · $0.00111 · exit: Nadia walked

**Nadia:** Omar. Planks. I know, I know, the little one. But I've told Salma and I've told Ruth they're coming, so I need a day. Today, tomorrow. Out loud, not soon.
*(He looks like a man carrying more than wood.)* `press` `continue`

**Omar:** You told two people already, Nadia. Before you asked me how she keeps down the broth. That's the part I keep chewing on.
*(I wanted her to ask first. She didn't.)* `press` `continue`

**Nadia:** I told them because you said yes, Omar. That's the chain. You said yes first, I just... passed it on. And I did ask about the broth, I asked first, actually. Look. Sick child, I get it, I'm not a monster. But Ruth is counting on those planks for her roof and it's my name on it now, so give me a day. Today. Tomorrow at the latest. Say it and I'll leave you alone, I swear.
*(Caught, and it stings more because he's right.)* `press` `continue`

**Omar:** She asked first. Fine, I'll give you that. Tomorrow, then. Before noon, and I'll carry them myself, so Ruth hears it from my mouth too. But Nadia, the girl ate a whole bowl this morning. You can tell them that part as well.
*(She did ask. I owed her that.)* `give way` `continue`

**Nadia:** Tomorrow before noon, carried by your own arms, and Ruth hears it from you. That's better than I hoped for, honestly. And I'll tell them about the bowl. Whole bowl, your mouth, my word on it. Go sit with her.
*(Relief, and a small sting of shame under it.)* `give way` `leave`

*Seed B — Salma and Yusuf at the fire at dusk; she is sure he is sweet on Amara.*

#### Seed B

`glm-5.3-flash (Wafer/DeepInfra)` · 10 lines · 30.5s · $0.00190 · exit: ran out of lines

**Salma:** You going to stand there all night, or until she walks past again.
*(He knows I know. Good.)* `tease` `continue`

**Yusuf:** Until the fire burns down. You got a question, ask it plain or don't.
*(She's seen it. No use pretending.)* `deflect` `continue`

**Salma:** Plain. Fine. The third beam, the crooked one. That was on purpose, or were your hands cold?
*(He'll know why I asked. Good.)* `tease` `continue`

**Yusuf:** The third beam sits true. Ask Salma, she's slept under it twice.
*(Her eyes are kind. That's the danger.)* `deflect` `continue`

**Salma:** He checked the beam for me. Very thorough, Yusuf. You check anything else of mine that close?
*(He's guarding the wrong door.)* `tease` `escalate`

**Yusuf:** Your firewood's damp. That's why it smokes.
*(She hit close. I'm not ready for this.)* `deflect` `continue`

**Salma:** Damp wood. That the only thing of mine you've been keeping an eye on?
*(Come on. Just say her name, Yusuf.)* `press` `continue`

**Yusuf:** Amara took the short beams yesterday. Saved me the walk. There's your keeping an eye on.
*(She's close. Too close, and I fed her.)* `deflect` `continue`

**Salma:** There it is. You brought her up all by yourself.
*(He walked straight into it. Feels almost unfair.)* `press` `continue`

**Yusuf:** Wood's popping. That's the damp, not me talking.
*(Caught. She'll pry it out of me by spring.)* `deflect` `continue`

*Seed C — The well ran dry; Amara wants a rule about who draws first. First light, Amara and Salma.*

#### Seed C

`glm-5.3-flash (Wafer/DeepInfra)` · 6 lines · 24.6s · $0.00091 · exit: Salma walked

**Amara:** Well's dry. I counted the buckets, Salma. Yours first, everyone after, agreed?
*(If she balks, I've already lost the morning.)* `press` `continue`

**Salma:** You counted my buckets at midnight? Get some sleep, Amara.
*(She keeps ledgers on people. Tiring.)* `deflect` `continue`

**Amara:** I don't sleep much. Doesn't change the numbers. Yours first, or somebody else decides for you.
*(Her laughing won't fill the well.)* `press` `continue`

**Salma:** Somebody else deciding for me. That's new. Didn't realize the well came with a landlord. I'll carry back double today, every day, and you can cross me off your list for good.
*(Being on anybody's list is the thing I can't stand.)* `press` `continue`

**Amara:** Double's fine. But the order stands. Yours first, say it.
*(She'll do it. I just need it said.)* `press` `continue`

**Salma:** Fine. I'm standing here, aren't I? Rope's in my hand. Write that down however you like.
*(He wants the words, not the water. No.)* `give way` `leave`

---

## Register 3 — Director-staged

A game-master call runs first and returns stakes, one private want per mind, an ending beat, and a caption for the viewer. It never writes dialogue. The two minds get the stakes and their want and are never told a director exists. Cap 10 lines.

*Seed A — Nadia asks Omar for the planks he promised and did not bring. The half-finished store, mid-morning.*

#### Seed A

`glm-5.3-flash (Wafer/DeepInfra)` · 3 lines · 45.0s · $0.00062 · exit: Nadia walked

> **Director — stakes:** Whether the store's south wall gets closed before the weather turns, and whether two friends stop keeping score about a promise made on the worst day of each other's lives.
> **Director — ending beat (never shown to the minds):** Nadia starts stacking the planks herself, and Omar picks up the other end of the first one without a word about who owes what.

**Caption:** Two people carried planks through the mud, one wall short of done.

**Nadia:** Omar. I know, I know, the boy's sick, I'm not here about that. Except I am, a bit, because I told Tomas and I told Salma the planks were coming and they believed me, Omar, and it's been six days. So. Before noon? Just point, I'll carry them myself.
*(Don't ask why. Don't ask why.)* `continue`

**Omar:** You slept at Salma's again, I can see it in your eyes. Sit a minute. No, don't sit, stand, fine. The planks are there, under the tarp by the well, I cut them the day after the slide. That's the shameful part, Nadia. They've been ready six days and I never said a word. The boy took all of me and I let the rest go quiet. I should have sent word. Tomas and Salma believed you because you believed me, and I made a liar out of you both.
*(Say the fault plain. Don't dress it up.)* `continue`

**Nadia:** Stop. Stop it, Omar, that's enough grovelling, take my bag. Six days the boy had all of you, that's not a debt. The planks were there. Go sit with him, I'll carry them, and Salma gets the story right this time.
*(He cut them the day after. Of course he did.)* `leave`

*Seed B — Salma and Yusuf at the fire at dusk; she is sure he is sweet on Amara.*

#### Seed B

`glm-5.3-flash (Wafer/DeepInfra)` · 10 lines · 43.9s · $0.00133 · exit: ran out of lines

> **Director — stakes:** This is the first time Salma has set herself to ask a true thing out loud, and the answer will decide whether the house ever gets a roof.
> **Director — ending beat (never shown to the minds):** She holds the fire's heat between them and waits; he reaches for the hammer and finds she has already moved it out of reach.

**Caption:** The fire burned down before either of them spoke, and the house stood another night without a roof.

**Salma:** Cold early this year. You planning to stay, or should I bring out a chair?
*(Say the beam thing first. Then the name.)* `continue`

**Yusuf:** Chair's for sitting. I'm standing.
*(She's winding up to something. I can tell.)* `continue`

**Salma:** Standing's fine. Just asking, since you stare at Amara's door more than mine, and mine's the one without a roof.
*(Say it, Yusuf. Just the name.)* `escalate`

**Yusuf:** Your door faces the morning sun. That's worth more than my staring.
*(She saw. Course she saw. She always sees.)* `escalate`

**Salma:** You cut every beam straight. Must've had a reason.
*(Say her name. Just once. Please.)* `escalate`

**Yusuf:** Reason was the beams. Straight beams hold a roof.
*(She's asking about Amara. Don't hand her that.)* `continue`

**Salma:** Straight beams. Funny, Amara was asking about them too.
*(There. It's out. Say her name back.)* `escalate`

**Yusuf:** Amara asks questions. I answer them. That's all she gets.
*(Careful. The fire's not the only thing popping.)* `escalate`

**Salma:** That's all she gets. Or all you give. Which is it, Yusuf?
*(Say her name. Just once. For me.)* `escalate`

**Yusuf:** All I give. You want the hammer or not?
*(Hands, Yusuf. Keep to the hands.)* `escalate`

*Seed C — The well ran dry; Amara wants a rule about who draws first. First light, Amara and Salma.*

#### Seed C

`glm-5.3-flash (Wafer/DeepInfra)` · 10 lines · 46.3s · $0.00108 · exit: ran out of lines

> **Director — stakes:** If Amara names Salma as the one drawing more than she carries back, Salma's private habits become the village's business before the sun is up.
> **Director — ending beat (never shown to the minds):** Salma hands the slack rope back to Amara without a word, and Amara, instead of counting, ties the bucket on for her.

**Caption:** Two women at a dry well, and only one of them is keeping a list.

**Amara:** Salma. Rope's worn near the hook. You noticed?
*(Three buckets more going out than back.)* `continue`

**Salma:** Noticed. Figured you'd want the honor of fixing it.
*(Rope first. The buckets come second.)* `continue`

**Amara:** Fixed it Tuesday. Rope's not the thing I came out here for.
*(Three buckets back this week. Say it plain.)* `continue`

**Salma:** So ask it. Bucket's already full, Amara.
*(Count somebody else's buckets. Please.)* `escalate`

**Amara:** Four buckets short since Sunday. Nobody's listening. Just you and me and the rope.
*(Say it plain, Salma. Then we're done.)* `continue`

**Salma:** Ask the rope. It's down there more than me.
*(She counted. Of course she counted.)* `continue`

**Amara:** I counted twice, Salma. Don't make me say it again. Was it you.
*(Say it plain. Don't make me drag it.)* `escalate`

**Salma:** Define "short." My bucket's small. Yours has ambition.
*(Admit nothing before coffee. Nothing before sun, either.)* `continue`

**Amara:** Short means four buckets, and your bucket's not small. Was it you or wasn't it. Say it once and we make the rule together, you and me. Say nothing and I make it without you.
*(Give her the choice, not the shame.)* `escalate`

**Salma:** It was me. All four. I'll carry them back before the sun clears the ridge — but the rule's mine too, then. You and me means you and me.
*(Say it once, clean. She'll take that.)* `continue`

---

## Register 4 — Invention and ruling

The first mouth must put something NEW into the world (a custom, rule, device, game, or name). The second must not simply agree. Afterwards an arbiter voice, which heard only the words, upholds / refuses / amends it into one plain sentence the town keeps. Cap 6 lines + 1 arbiter call.

*Seed A — Nadia asks Omar for the planks he promised and did not bring. The half-finished store, mid-morning.*

#### Seed A

`glm-5.3-flash (Wafer/DeepInfra)` · 3 lines · 14.9s · $0.00060 · exit: Nadia walked

**Caption:** A promise got a deadline, and the planks now have a date.

**Nadia:** Omar. Planks. I know, I know, the boy, I'd have done the same, but I've told Tarek and told Ilsa and now I'm standing here looking like a liar with an open wall. So new rule, I just thought of it, call it the slate rule: can't say soon, only a day. Say a day or say nothing, that's it, that's the whole rule. Which is it?
*(He's got the tired eyes. Go soft but get the day.)* `escalate`

**Omar:** Slate rule's fair. Slate it for tomorrow, before noon, I'll carry them myself. Though you asked after your wall before you asked after the boy, Nadia.
*(Say the sting plain. She'll hear it.)* `escalate`

**Nadia:** Tomorrow before noon, done, slate it. And you're right, I asked about the wall first, that was... I'm not saying I'm sorry, I'm saying I'm aware. For the record I did ask Salma about the boy twice, she'd tell you, but fine, that's not the point. Planks. Tomorrow. I'll come to you, you don't carry them, I've got two arms.
*(He got me and he knows it.)* `leave`

**Arbiter — upheld. “the slate rule”**

> Say a day or say nothing, nothing in between.

*Why:* They both agreed to it in their own mouths, and Omar named his day before the rule was even finished. The wall-first part stung, but it was shame between them, not terms; leave that out of the law. What holds is only the promise-shape: a day, before noon, and the carrier is Nadia because she closed that door herself.

*Seed B — Salma and Yusuf at the fire at dusk; she is sure he is sweet on Amara.*

#### Seed B

`glm-5.3-flash (Wafer/DeepInfra)` · 6 lines · 27.3s · $0.00079 · exit: ran out of lines

**Caption:** Two people invented a way to keep talking, and the valley wrote it down.

**Salma:** Yusuf. New rule for the fire. One question each, no lying, no dodging. Call it the fire tax.
*(He'll dodge, and the dodge will answer.)* `escalate`

**Yusuf:** Fire tax. Who's collecting it, then?
*(She's aiming at Amara. I can smell it.)* `continue`

**Salma:** Me. Collector keeps the proceeds. That's you paying me, in answers.
*(He'll haggle. Haggling means yes.)* `escalate`

**Yusuf:** Tax collector. Alright. One question each, and I go first.
*(She'll aim at Amara. But mine lands first.)* `escalate`

**Salma:** You first. Fine. Mine still gets asked, though. Last words at the fire, collector's privilege.
*(He thinks going first is safe. It isn't.)* `continue`

**Yusuf:** She gets to ask hers after I've gone to bed. That's my price.
*(Fire's warm. Leaving costs more than answering.)* `continue`

**Arbiter — amended. “The Fire Tax”**

> One question each at the fire, answered honestly, and Salma may ask hers last, even after you've gone to bed, as long as the answer waits for morning if you're asleep.

*Why:* They made a tax and then argued over who collects. The version that holds is the one where both questions get asked — hers at the fire's end, his answered when he wakes, not dodged, just delayed. That's the smallest amendment that keeps it a tax and not a trap.

*Seed C — The well ran dry; Amara wants a rule about who draws first. First light, Amara and Salma.*

#### Seed C

`glm-5.3-flash (Wafer/DeepInfra)` · 6 lines · 28.0s · $0.00110 · exit: ran out of lines

**Caption:** Two women agree at the well that every bucket gets counted the day it's carried, out loud or not at all.

**Amara:** Bucket's dry. So here's how it goes: first light belongs to whoever slept in the wellhouse that night. Keeper's row first, then the rest. Call it well-order.
*(She draws at night. She knows it.)* `escalate`

**Salma:** Well-order. So I'm last, every night, forever.
*(Odd hours keep me off her list.)* `continue`

**Amara:** Last to carry back the least, you mean. I counted, Salma. Eleven buckets down the hill, seven come home. Fix that and we'll talk about your place in the row.
*(Say the number once. Let her sit with it.)* `continue`

**Salma:** The other four went to Dez's goats, Amara. I was watering your list, not dodging it.
*(Counted. Of course she counted.)* `continue`

**Amara:** Dez's goats, right. Should've said so. Still seven and four next time, written down or spoken. So: well-order stands, goats count as carried. Say yes and it's done.
*(She watched the goats. She counts too.)* `continue`

**Salma:** Goats count, fine. But nothing written. First light's mine because I'm standing here, not because somebody slept somewhere.
*(A list with my name on it. No.)* `continue`

**Arbiter — amended. “Well-Order”**

> Whoever sleeps in the wellhouse draws first, and every bucket—goats included—gets counted out loud the same day it's carried.

*Why:* Amara's order held by sleeping; Salma's held by standing. The well takes both: the row stands as first light found it, but nothing counts unless it's said, that day, by the one who carried it. No paper—the town keeps what is spoken at the well, and that is enough.

---

## Stronger models, same loop

Register 2 on seed B and register 4 on seed C, run through OpenRouter with the identical prompts.

### google/gemini-3.7-flash — wants / seed B

#### Seed B

`google/gemini-3.7-flash` · 10 lines · 44.0s · $0.02741 · exit: ran out of lines

**Salma:** Amara was asking after you. Told her you forgot how to talk.
*(Spit it out, Yusuf.)* `tease` `continue`

**Yusuf:** Fire is spitting sparks, Salma. Pine is too green.
*(She knows too much already.)* `deflect` `continue`

**Salma:** Pine is fine. Must be sparks turning your neck red.
*(He dodges like a rabbit in brush.)* `tease` `continue`

**Yusuf:** Wind is cold off the river. Sit down, Salma.
*(Too sharp by half, that woman.)* `deflect` `continue`

**Salma:** Cold river. Good thing you spent midday staring at Amara's porch.
*(He will break before I do.)* `tease` `continue`

**Yusuf:** Her front step is leaning, Salma. Needs truing.
*(She knows too much.)* `deflect` `continue`

**Salma:** Needs truing. Must take three hours of hard staring, Yusuf.
*(He never was any good at lying.)* `tease` `continue`

**Yusuf:** A bad join takes time, Salma. Kick that log in.
*(She will not let a man sit quiet.)* `deflect` `continue`

**Salma:** Took three hours staring, Yusuf. Surprised the step didn't fix itself.
*(He is red as a beet.)* `tease` `continue`

**Yusuf:** Cedar burns too fast anyway. Pass me that green pine, Salma.
*(She won't let this bone go.)* `deflect` `continue`

### openai/gpt-5.6-luna — wants / seed B

#### Seed B

`openai/gpt-5.6-luna` · 10 lines · 33.0s · $0.00433 · exit: ran out of lines

**Salma:** You go quiet whenever Amara passes. Very subtle, Yusuf.
*(I want the truth, not the satisfaction.)* `tease` `continue`

**Yusuf:** The fire's loud enough. Pass me that split log, Salma.
*(The cold is easier than this question.)* `deflect` `continue`

**Salma:** Of course. It drowns out all sorts of things.
*(The silence between us feels almost useful.)* `tease` `continue`

**Yusuf:** That shutter’s hung wrong. Rain’ll find the bed by morning.
*(I want the fire, not her sharp eyes.)* `deflect` `continue`

**Salma:** You noticed the shutter. Amara noticed you. Everybody’s observant tonight.
*(The cold isn’t the reason my hands shake.)* `tease` `continue`

**Yusuf:** Then everybody can mend what they notice. Hand me that hinge.
*(The fire is easier company than this question.)* `deflect` `continue`

**Salma:** You can fix wood. Shame about what you won’t name.
*(His silence is warmer than the fire.)* `press` `continue`

**Yusuf:** The hinge is bent. Fetch the other one, Salma.
*(The fire is easier company than this.)* `deflect` `continue`

**Salma:** Fine. The hinge. Amara can keep the observing.
*(I want him to deny it, plainly, once.)* `tease` `continue`

**Yusuf:** The door ought to face morning. Hold it, Salma.
*(Glad for the cold, not her question.)* `deflect` `continue`

### google/gemini-3.7-flash — invention / seed C

#### Seed C

`google/gemini-3.7-flash` · 6 lines · 25.4s · $0.01757 · exit: ran out of lines

**Caption:** Two women stand by a dry well bucket at sunrise.

**Amara:** Bucket came up mud, Salma. We set a stone line on the rim. Storehouse draws first.
*(The well is mine to keep alive.)* `escalate`

**Salma:** Storehouse gets the mud, Amara. Call me when it's wet.
*(Nobody puts me on a ledger.)* `continue`

**Amara:** It clears by noon. Storehouse gets first draw, then yours.
*(She will not dodge the rule today.)* `continue`

**Salma:** Second in line. Perfect. I will just come at midnight.
*(Nobody puts my name on a slate.)* `continue`

**Amara:** Rope locks at dusk, Salma. Second draw at noon, or nothing.
*(Midnight won't save her from the count.)* `escalate`

**Salma:** A lock on a rope. Next you will want a badge, Amara.
*(She will sleep by the winch next.)* `continue`

**Arbiter — amended. “The Stone Line”**

> Storehouse draws first at noon, the next draw takes what comes after, and the rope stays locked from dusk until dawn.

*Why:* A muddy well cannot bear midnight dipping, so the turn must wait on the clearing and the rope must rest at night.

### openai/gpt-5.6-luna — invention / seed C

#### Seed C

`openai/gpt-5.6-luna` · 6 lines · 26.9s · $0.00370 · exit: ran out of lines

**Caption:** The queue became one bucket at a time.

**Amara:** The First Rope. One bucket each, in arrival order. You’re first. Keep it.
*(If she agrees, the morning has its shape.)* `continue`

**Salma:** Lovely. A queue for an empty well. What does first buy?
*(She’s counting water that isn’t there.)* `continue`

**Amara:** It buys first draw when water returns, not a second bucket.
*(A rule without water is still worth having.)* `continue`

**Salma:** Call it a claim, then. I draw when I’m here, one bucket.
*(A queue with better shoes is still a queue.)* `continue`

**Amara:** Claim, then. One bucket when you’re here, and it ends when you draw.
*(Her word first. The rule follows after.)* `continue`

**Salma:** Call it a bucket, then. Whoever’s here draws one. Nothing carries.
*(A lovely little rule, with no leash attached.)* `continue`

**Arbiter — amended. “The Bucket”**

> Whoever is here draws one bucket, and nothing carries.

*Why:* The claim of priority was reduced to a single present draw, with no stored turn or second bucket.
