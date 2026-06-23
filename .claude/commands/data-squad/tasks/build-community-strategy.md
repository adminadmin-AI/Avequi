---
task: buildCommunityStrategy()
responsavel: "@david-spinks"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: business
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: community_goal
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: community_strategy
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] SPACES model assessed with primary dimension selected"
  - "[ ] Engagement ladder designed with 7 rungs"
  - "[ ] Community Health Score defined with 5 components"
---

# Task: Build Community Strategy

**Task ID:** DATA-003
**Version:** 1.0.0
**Command:** `*build-community-strategy`
**Agent:** David Spinks (david-spinks)
**Purpose:** Design a community-led growth strategy using the SPACES model and engagement ladder

---

## Inputs

| Input | Source | Required | Description |
|-------|--------|----------|-------------|
| `business` | User prompt | Yes | Business or product description |
| `community_goal` | User prompt | Yes | Primary goal for the community |
| `existing_community` | User | No | Current community status (none, early, growing, mature) |
| `platform_preference` | User | No | Preferred platform (Discord, Slack, Circle, forum, etc.) |
| `resources` | User | No | Team and budget available for community management |

## Preconditions

- Business or product exists with identifiable users
- Community goal is articulated (even if broad)
- Metrics frameworks loaded (`data/metrics-frameworks.yaml`)

## Execution Phases

### Phase 1: Define SPACES Model Goals

1. Assess which SPACES dimensions are most relevant:
   - **S — Support:** Members help each other (reduces support costs)
   - **P — Product:** Members provide feedback and ideas (improves product)
   - **A — Acquisition:** Community attracts new customers (reduces CAC)
   - **C — Contribution:** Members create content or code (increases value)
   - **E — Engagement:** Members connect with each other (increases retention)
   - **S — Success:** Members achieve outcomes (reduces churn)
2. Rank SPACES dimensions by business impact
3. Select **primary dimension** (1) and **secondary dimensions** (1-2)
4. Define success metrics for each selected dimension
5. Set 90-day targets for each metric

### Phase 2: Design Engagement Ladder

1. Map the **Community Engagement Ladder** (7 rungs):
   - **Lurker:** Observes but does not participate
   - **Follower:** Consumes content, reacts occasionally
   - **Contributor:** Posts, comments, shares experiences
   - **Collaborator:** Helps others, answers questions
   - **Champion:** Advocates publicly, creates content
   - **Leader:** Moderates, mentors, organizes events
   - **Partner:** Co-creates with the brand, advisory role
2. For each rung, define:
   - **Trigger action** -- what moves someone up
   - **Recognition** -- how progression is acknowledged
   - **Permissions** -- what unlocks at this level
3. Design **nudge sequences** to move people up the ladder
4. Identify the **critical transition** -- which rung jump has the highest impact
5. Create engagement programs for each rung

### Phase 3: Plan Launch

1. Define the **Minimum Viable Community (MVC)**:
   - Target founding member count (typically 20-50)
   - Content seed plan (10-20 initial posts/discussions)
   - Welcome experience design
2. Choose platform and configure:
   - Channel/category structure
   - Rules and guidelines
   - Onboarding flow
3. Recruit **founding members**:
   - Identify super-users from existing customer base
   - Personal invitation strategy
   - Founding member benefits
4. Create **content calendar** for first 30 days:
   - Daily content types
   - Discussion prompts
   - Events (AMAs, workshops, challenges)
5. Define **community rituals** -- recurring events that build habit

### Phase 4: Measure

1. Implement the **Community Health Score** with 5 components:
   - **Activity rate:** % of members active in last 30 days
   - **Response rate:** % of posts that receive replies
   - **Growth rate:** Net new members per period
   - **Depth score:** Average interactions per active member
   - **Sentiment:** Positive/negative ratio in community discussions
2. Design the **reporting dashboard**:
   - Weekly pulse: top 3 metrics + notable moments
   - Monthly review: full health score + engagement ladder distribution
   - Quarterly strategy: SPACES progress + goal adjustment
3. Define **intervention triggers**:
   - Activity rate < 20% = engagement crisis
   - Response rate < 50% = content strategy review
   - Negative sentiment spike = immediate investigation
4. Create **feedback loops** -- how community data informs product and business

## Output Format

```yaml
community_strategy:
  business: "{name}"
  spaces_primary: "{S|P|A|C|E|S}"
  spaces_secondary: ["{dimension1}", "{dimension2}"]
  engagement_ladder:
    rungs: 7
    critical_transition: "{rung X to rung Y}"
  launch_plan:
    platform: "{platform}"
    founding_members_target: {number}
    launch_date: "{date or 'TBD'}"
    content_seed: {number of initial posts}
  health_score:
    activity_rate: {target: "", current: ""}
    response_rate: {target: "", current: ""}
    growth_rate: {target: "", current: ""}
    depth_score: {target: "", current: ""}
    sentiment: {target: "", current: ""}
  deliverables:
    - community-strategy.md
    - engagement-ladder.md
    - launch-plan.md
    - content-calendar.md
```

## Veto Conditions

1. **NEVER launch a community without founding members** -- empty communities die immediately
2. **NEVER skip the SPACES assessment** -- a community without business purpose becomes a cost center
3. **NEVER automate all community interaction** -- authentic human presence is non-negotiable
4. **NEVER ignore negative sentiment spikes** -- unaddressed toxicity kills communities fast
5. **NEVER measure only member count** -- vanity metrics hide dying communities

## Completion Criteria

- [ ] SPACES model assessed with primary and secondary dimensions selected
- [ ] Engagement ladder designed with 7 rungs and trigger actions
- [ ] Launch plan created with founding member strategy
- [ ] Content calendar drafted for first 30 days
- [ ] Community Health Score defined with 5 components
- [ ] Intervention triggers established
- [ ] 90-day targets set for each key metric
- [ ] Output matches schema above
