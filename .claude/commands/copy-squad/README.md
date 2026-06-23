# Copy Squad

Elite squad of 23 copywriting agents — 22 legendary copywriters + 1 orchestrator (Copy Chief).

## Quick Start

```
@copy-chief     # Activate the orchestrator
*diagnose       # Triage your copywriting request
*full-copy-project  # End-to-end copy project workflow
```

## Tier Architecture

| Tier | Name | Agents | Focus |
|------|------|--------|-------|
| **0** | Orchestration | copy-chief | Routes demands, reviews output, mediates |
| **1A** | Direct Response Legends | gary-halbert, eugene-schwartz, claude-hopkins, gary-bencivenga, robert-collier, john-carlton, jim-rutz | Long-form, print, mail |
| **1B** | Modern Copy & Funnels | dan-kennedy, frank-kern, russell-brunson, todd-brown, stefan-georgi, jon-benson, ry-schwartz | VSLs, funnels, webinars, launches |
| **1C** | Email & Relationship | ben-settle, andre-chaperon, dan-koe | Email sequences, daily emails, nurture |
| **1D** | Offers & Sales Pages | joe-sugarman, david-ogilvy, clayton-makepeace, parris-lampropoulos, david-deutsch | Offer architecture, print ads, financial/health |

## Routing Matrix

The Copy Chief automatically routes your request to the best specialist:

| Request Type | Primary | Secondary |
|-------------|---------|-----------|
| Headline | eugene-schwartz | gary-halbert |
| Sales letter / long-form | gary-halbert | john-carlton |
| Email sequence | andre-chaperon | ben-settle |
| VSL / video sales letter | stefan-georgi | jon-benson |
| Webinar script | russell-brunson | todd-brown |
| Offer creation | dan-kennedy | joe-sugarman |
| Funnel copy | russell-brunson | frank-kern |
| Big idea / campaign concept | todd-brown | eugene-schwartz |
| Bullet points / fascinations | gary-bencivenga | clayton-makepeace |
| Daily emails / engagement | ben-settle | dan-koe |
| Classic sales letter / mail | robert-collier | jim-rutz |
| Financial / health copy | clayton-makepeace | parris-lampropoulos |
| Brand / premium copy | david-ogilvy | david-deutsch |
| Ad copy / paid ads | dan-kennedy | frank-kern |
| Launch copy | frank-kern | russell-brunson |
| Personal brand copy | dan-koe | ry-schwartz |
| Copy review / critique | copy-chief | eugene-schwartz |

## Components

- **23 agents** — 1 orchestrator + 22 specialists
- **13 tasks** — write-headline, write-sales-letter, write-vsl-script, write-email-sequence, write-ad-copy, write-landing-page, write-bullets, create-funnel-copy, create-offer, analyze-copy, critique-copy, diagnose, review
- **2 workflows** — full-copy-project, copy-review-cycle
- **1 checklist** — output-quality (quality gate for deliverables)
- **2 data files** — routing-catalog, copy-frameworks

## Workflows

### Full Copy Project (`*full-copy-project`)
End-to-end: brief > diagnose > assign specialist > write > review > deliver.

### Copy Review Cycle (`*copy-review-cycle`)
Iterative write-critique-revise loop (max 3 iterations).

## Requirements

- AIOS >= 4.0.0
