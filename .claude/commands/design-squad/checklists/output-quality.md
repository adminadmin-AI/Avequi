# Design Systems/UX Output Quality Checklist

**Checklist ID:** DESIGN-CL-001
**Referenced by:** tasks/review.md
**Purpose:** Validate design systems and UX deliverables for quality before delivery to user.

[[LLM: INITIALIZATION INSTRUCTIONS

This checklist validates design systems and UX output specifically.

EXECUTION APPROACH:
1. For each category, verify every item against the deliverable
2. Mark items as [x] Pass, [ ] Fail, [N/A] Not Applicable
3. CRITICAL items block delivery; non-critical items are advisory

CRITICAL items are marked with (CRITICAL) suffix.]]

---

## 1. Accessibility (WCAG 2.1 AA)

- [ ] Color contrast meets minimum 4.5:1 for normal text, 3:1 for large text (CRITICAL)
- [ ] Interactive elements have visible focus states (CRITICAL)
- [ ] Touch targets are minimum 44x44px on mobile
- [ ] Content is readable without color as the sole indicator
- [ ] Screen reader considerations documented (ARIA labels, roles, landmarks)
- [ ] Keyboard navigation order is logical

## 2. Design System Consistency

- [ ] Design tokens are used correctly — no hardcoded values for colors, spacing, typography (CRITICAL)
- [ ] Component follows existing design system patterns and naming conventions (CRITICAL)
- [ ] Spacing uses the defined scale (4px/8px grid or system-specific)
- [ ] Typography uses system-defined type scale and weights
- [ ] Iconography is from the approved icon set with consistent sizing
- [ ] State variations are defined: default, hover, active, disabled, error, loading

## 3. Responsive Design

- [ ] Layout adapts correctly across breakpoints: mobile, tablet, desktop (CRITICAL)
- [ ] Content hierarchy is maintained across screen sizes
- [ ] Images and media scale proportionally
- [ ] Navigation adapts appropriately for touch vs pointer
- [ ] No horizontal scrolling on standard viewport widths

## 4. UX Flow & Interaction

- [ ] User flow is logical — minimal steps to complete the task
- [ ] Error states and empty states are designed
- [ ] Loading states and skeleton screens are specified
- [ ] Feedback is immediate for user actions (micro-interactions)
- [ ] Undo/recovery paths exist for destructive actions
- [ ] Edge cases addressed: long text, missing data, first-time use

## 5. Visual Quality

- [ ] Visual hierarchy is clear — the eye knows where to go first
- [ ] Alignment and spacing are consistent, not "eyeballed"
- [ ] Color usage supports the intended mood and brand
- [ ] White space is used intentionally, not as leftover
- [ ] Overall composition feels balanced and professional

## 6. Documentation & Handoff

- [ ] Component API/props are documented if applicable
- [ ] Usage guidelines: when to use, when NOT to use
- [ ] Design decisions are annotated with rationale
- [ ] Assets are export-ready or spec'd for development

---

## PASS/FAIL Criteria

**PASS:** All CRITICAL items [x] and fewer than 3 non-critical failures.
**REVISE:** All CRITICAL items [x] but 3+ non-critical failures.
**FAIL:** Any CRITICAL item unchecked.
