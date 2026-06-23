---
task: setupTracking()
responsavel: "@pixel-specialist"
responsavel_type: Agent
atomic_layer: Task
elicit: true

Entrada:
  - campo: platforms
    tipo: string
    origem: User Input
    obrigatorio: true
  - campo: website
    tipo: string
    origem: User Input
    obrigatorio: true

Saida:
  - campo: trackingSetup
    tipo: string
    destino: Console
    persistido: false

Checklist:
  - "[ ] Tracking architecture mapped with all platforms"
  - "[ ] Event hierarchy defined with parameters"
  - "[ ] QA checklist created and tested"
---

# Task: Setup Tracking

**Task ID:** TRAFFIC-005
**Version:** 1.0.0
**Command:** `*setup-tracking`
**Agent:** Pixel Specialist (pixel-specialist)
**Purpose:** Design and document the tracking and attribution setup for paid advertising.

---

## Inputs

| Field | Type | Source | Required | Validation |
|-------|------|--------|----------|------------|
| platforms | list | User prompt | Yes | Ad platforms in use (facebook, google, tiktok, etc.) |
| website | string | User prompt | Yes | Website URL and tech stack (WordPress, Shopify, custom, etc.) |
| conversion_events | list | User prompt | Yes | Key events to track (purchase, lead, signup, etc.) |
| funnel_pages | list | User prompt | No | Key pages in the funnel (landing, checkout, thank you) |
| current_tracking | string | User prompt | No | Existing tracking setup description |
| ecommerce | boolean | User prompt | No | Whether the site has e-commerce transactions |

---

## Preconditions

- Website accessible and editable (or tag manager access available)
- Ad platform accounts created with pixel/tag IDs available
- Conversion events defined (what counts as a conversion)

---

## Execution Phases

### Phase 1: Tracking Architecture
1. Map the complete tracking stack:
   - Tag Manager: Google Tag Manager, Meta Pixel Helper, platform-native
   - Pixels: Meta Pixel, Google Ads Tag, TikTok Pixel, LinkedIn Insight Tag
   - Analytics: Google Analytics 4, platform analytics
   - Server-side: Conversions API (CAPI), offline conversions
2. Define the conversion event hierarchy:
   - Primary: The main business outcome (purchase, lead form submit)
   - Secondary: Mid-funnel events (add to cart, initiate checkout, page view)
   - Micro: Engagement events (scroll depth, time on page, video view)
3. Map events to funnel stages:
   - Page View → Landing page visit
   - Lead → Form submission or opt-in
   - InitiateCheckout → Checkout page reached
   - Purchase → Transaction completed
4. Document UTM parameter strategy for attribution

### Phase 2: Platform-Specific Setup
1. For each platform, document the setup requirements:
   - **Meta (Facebook/Instagram):**
     - Base Pixel installation
     - Conversions API (server-side) setup
     - Event Match Quality score optimization
     - Custom conversions and standard events
     - Domain verification and aggregated event measurement
   - **Google Ads:**
     - Google Ads tag installation
     - Enhanced conversions setup
     - Conversion linker tag
     - GA4 integration for audience sharing
   - **TikTok:**
     - TikTok Pixel installation
     - Events API setup
     - Click ID parameter handling
   - **LinkedIn:**
     - Insight Tag installation
     - Conversion tracking setup
2. Provide step-by-step setup instructions for each platform
3. Define the testing procedure to verify each event fires correctly

### Phase 3: Attribution Strategy
1. Define the attribution model for reporting:
   - Last-click: Simple but biased toward bottom-of-funnel
   - Data-driven: Recommended when volume supports it
   - Multi-touch: For complex funnels with many touchpoints
2. Set the attribution window per platform:
   - Meta: 7-day click, 1-day view (default)
   - Google: 30-day click (default)
   - TikTok: 7-day click, 1-day view
3. Document the discrepancy expectation between platforms
4. Create a source-of-truth reporting framework:
   - Which platform to believe for which metrics
   - How to reconcile cross-platform attribution

### Phase 4: QA and Validation
1. Create a tracking QA checklist:
   - Each pixel fires on the correct pages
   - Events fire with correct parameters (value, currency, content ID)
   - Server-side events match browser events (deduplication)
   - UTM parameters pass through the funnel correctly
   - Thank you page events fire once (no duplicate conversions)
2. Define the validation testing procedure
3. Document known limitations and edge cases
4. Set up monitoring alerts for tracking failures

---

## Output Format

```markdown
## Tracking Setup: {Website/Business}

**Platforms:** {list}
**Tag Manager:** {GTM / platform-native / custom}
**Server-Side:** {yes/no — CAPI, Enhanced Conversions}

---

### Event Map

| Event | Trigger | Platforms | Parameters | Page |
|-------|---------|-----------|------------|------|
| PageView | All pages | All | URL, referrer | * |
| Lead | Form submit | Meta, Google | value, content_name | /thank-you |
| Purchase | Transaction | Meta, Google | value, currency, content_ids | /order-confirmation |

### Platform Setup Guides

#### Meta Pixel + CAPI
{Step-by-step instructions}

#### Google Ads + Enhanced Conversions
{Step-by-step instructions}

#### {Additional platforms}

### UTM Strategy

| Parameter | Convention | Example |
|-----------|-----------|---------|
| utm_source | {platform} | facebook |
| utm_medium | {type} | cpc |
| utm_campaign | {naming convention} | cold_lookalike_offer1 |

### Attribution Framework
**Primary model:** {model}
**Windows:** {per platform}
**Source of truth:** {which system for which metric}

### QA Checklist
- [ ] {item per platform and event}

### Monitoring
| Alert | Condition | Action |
|-------|-----------|--------|
```

---

## Veto Conditions

- NEVER launch paid ads without verified tracking — spending without measurement is burning money
- NEVER trust a single platform's attribution in isolation — cross-reference
- NEVER skip server-side tracking (CAPI) for Meta — browser-only tracking loses 30-40% of events
- NEVER fire purchase events without value parameters — ROAS calculation depends on it
- NEVER assume tracking works after setup — always run a QA test with real conversions

---

## Completion Criteria

- [ ] Tracking architecture mapped with all platforms
- [ ] Event hierarchy defined with parameters
- [ ] Platform-specific setup guides written
- [ ] UTM strategy documented
- [ ] Attribution model selected and windows set
- [ ] QA checklist created and tested
- [ ] Monitoring alerts defined
