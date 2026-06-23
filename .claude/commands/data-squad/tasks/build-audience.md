---
task: buildAudience()
responsavel: "@wes-kao"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: expertise
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: target_audience
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: audience_strategy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Spiky POV identified and validated"
  - "[ ] Platform selected with format fit analysis"
  - "[ ] 30-day content starter pack outlined"
---

# Task: Build Audience

**Task ID:** DATA-005
**Version:** 1.0.0
**Command:** `*build-audience`
**Agent:** Wes Kao (wes-kao)
**Purpose:** Build an engaged audience through a Spiky Point of View, strategic platform selection, content cadence, and cohort design

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `expertise` | User prompt | Yes | Domain expertise or knowledge area |
| `target_audience` | User prompt | Yes | Who the audience should be |
| `current_presence` | User | No | Existing audience size, platforms, content |
| `goal` | User | No | Audience goal: authority, leads, community, course launch |
| `time_commitment` | User | No | Hours per week available for content creation |

## Preconditions

- Domain expertise exists and is demonstrable
- Target audience is identifiable
- Metrics frameworks loaded (`data/metrics-frameworks.yaml`)

## Execution Phases

### Phase 1: Find Spiky Point of View

1. Identify your **unique intersection** -- the combination of expertise that only you have
2. Apply the **Spiky POV Framework**:
   - **Specific:** Not "marketing is important" but "B2B SaaS companies waste 60% of their marketing budget on brand awareness before achieving PMF"
   - **Provable:** Can be backed by data, experience, or results
   - **Interesting:** Makes people stop scrolling
   - **Contrarian:** Challenges conventional wisdom
   - **Your terrain:** You have more credibility on this than most
3. Generate **5-10 candidate spiky POVs**
4. Test each against the **"Would someone argue with this?"** filter:
   - If no one would argue, it's not spiky enough
   - If everyone would argue, it's not credible enough
5. Select the **1 primary spiky POV** and **2-3 supporting POVs**
6. Validate: can you create 50+ pieces of content from this POV?

### Phase 2: Choose Platform

1. Evaluate platforms against your audience and content style:
   - **LinkedIn:** B2B, professional, long-form text, career-oriented
   - **Twitter/X:** Tech, media, fast takes, thread culture
   - **Newsletter:** Owned audience, deep dives, high trust
   - **YouTube:** Evergreen, search-driven, visual learners
   - **Podcast:** Long-form, relationship building, commute audience
   - **TikTok/Reels:** Broad reach, entertainment-first, younger demos
2. Apply the **Platform Selection Matrix**:
   - Audience presence (where does your audience already spend time)
   - Content format fit (matches your natural creation style)
   - Distribution mechanics (organic reach potential)
   - Monetization path (leads, courses, consulting)
3. Select **1 primary platform** and **1 secondary platform**
4. Define the **content-native format** for each platform
5. Set up profiles with spiky POV in bio/description

### Phase 3: Design Content Cadence

1. Create the **Content Pillar System** (3-5 pillars):
   - Each pillar connects to the spiky POV
   - Each pillar has 10+ subtopics
   - Pillars cover: education, opinion, story, tactical, inspiration
2. Design the **weekly content cadence**:
   - Publishing frequency per platform
   - Content type rotation (pillar 1 Mon, pillar 2 Wed, etc.)
   - Engagement time blocks (respond to comments, DMs)
3. Build the **Content Repurposing Engine**:
   - Long-form (newsletter/blog) > Short-form (social posts)
   - Threads > Carousel > Video script
   - Every 1 long-form piece = 5-10 derivative pieces
4. Create a **30-day content starter pack**:
   - 12 post/article outlines
   - 4 "hero" pieces (deep dives)
   - 4 engagement hooks (questions, polls, debates)
5. Define the **minimum viable cadence** -- what to publish even on the worst week

### Phase 4: Build Cohort and Measure

1. Design the **Audience-to-Cohort Pipeline**:
   - Free content > Email capture > Nurture > Paid cohort
   - Define the **lead magnet** aligned with spiky POV
   - Design the **nurture sequence** (5-7 emails)
2. Apply **Cohort-Based Course (CBC) principles** if applicable:
   - Outcome-oriented (students achieve X in Y weeks)
   - Accountability through deadlines and peer interaction
   - Transformation > Information
3. Define **audience growth metrics**:
   - Follower/subscriber growth rate
   - Engagement rate (interactions / impressions)
   - Email list growth and open rate
   - Content-to-lead conversion rate
   - Audience-to-customer conversion rate
4. Set **milestone targets**:
   - 30 days: Cadence established, first 100 engaged followers
   - 90 days: Spiky POV recognized, first 500 engaged
   - 6 months: Authority established, monetization path clear
5. Create the **weekly review ritual** -- 15 min to check metrics and adjust

## Output Format

```yaml
audience_strategy:
  expertise: "{domain}"
  target_audience: "{description}"
  spiky_pov:
    primary: "{main spiky POV}"
    supporting: ["{pov1}", "{pov2}"]
  platform:
    primary: "{platform}"
    secondary: "{platform}"
    format: "{native content format}"
  content_cadence:
    pillars: ["{pillar1}", "{pillar2}", "{pillar3}"]
    frequency: "{X posts per week}"
    repurposing_ratio: "1 long-form = {X} derivatives"
  cohort_pipeline:
    lead_magnet: "{description}"
    nurture_length: "{X emails}"
    cohort_ready: "{yes|no|future}"
  milestones:
    30_day: "{target}"
    90_day: "{target}"
    6_month: "{target}"
  deliverables:
    - spiky-pov-analysis.md
    - content-strategy.md
    - content-calendar-30day.md
    - audience-metrics.md
```

## Veto Conditions

1. **NEVER start creating content without a spiky POV** -- generic content drowns in noise
2. **NEVER be on more than 2 platforms simultaneously** -- spread too thin means no traction anywhere
3. **NEVER publish without a repurposing plan** -- every piece should generate multiple derivatives
4. **NEVER measure only follower count** -- engagement rate matters more than vanity metrics
5. **NEVER skip the "Would someone argue?" test** -- a POV nobody disagrees with is invisible

## Completion Criteria

- [ ] Spiky POV identified and validated (1 primary, 2-3 supporting)
- [ ] Platform selected with format fit analysis
- [ ] Content pillars defined (3-5) with subtopics
- [ ] Weekly content cadence designed
- [ ] 30-day content starter pack outlined
- [ ] Audience-to-cohort pipeline mapped
- [ ] Growth metrics and milestones set (30/90/180 days)
- [ ] Output matches schema above
