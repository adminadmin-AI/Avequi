# Data-Driven Growth Output Quality Checklist

**Checklist ID:** DATA-CL-001
**Referenced by:** tasks/review.md
**Purpose:** Validate data analysis and data-driven growth deliverables for quality before delivery to user.

[[LLM: INITIALIZATION INSTRUCTIONS

This checklist validates data-driven growth output specifically.

EXECUTION APPROACH:
1. For each category, verify every item against the deliverable
2. Mark items as [x] Pass, [ ] Fail, [N/A] Not Applicable
3. CRITICAL items block delivery; non-critical items are advisory

CRITICAL items are marked with (CRITICAL) suffix.]]

---

## 1. Data Sources & Integrity

- [ ] All data sources are explicitly cited with recency dates (CRITICAL)
- [ ] Data collection methodology is described or referenced
- [ ] Sample size is adequate for the conclusions drawn (CRITICAL)
- [ ] Data limitations and known biases are disclosed
- [ ] Data is relevant to the question being asked, not tangential

## 2. Statistical Validity

- [ ] Correct statistical methods are applied for the data type and question (CRITICAL)
- [ ] Correlation is not presented as causation without justification
- [ ] Confidence intervals or margins of error are stated where applicable
- [ ] Outliers are identified and their handling is explained
- [ ] Comparisons use appropriate baselines and time periods

## 3. Actionable Insights

- [ ] Insights are specific and actionable — not "data is interesting" (CRITICAL)
- [ ] Each insight connects to a business decision or action
- [ ] Priorities are clear: which insight to act on first and why
- [ ] Impact estimates are provided: what happens if you act vs don't act
- [ ] Quick wins vs long-term plays are distinguished

## 4. Visualization & Presentation

- [ ] Visualizations are clear, labeled, and not misleading (CRITICAL)
- [ ] Chart types are appropriate for the data (no pie charts for 15 categories)
- [ ] Axes start at zero or deviation is justified and noted
- [ ] Color usage is accessible and meaningful
- [ ] Key takeaways are highlighted, not buried in data

## 5. Metrics & KPIs

- [ ] Metrics are defined with clear formulas/calculations
- [ ] Leading indicators are distinguished from lagging indicators
- [ ] Benchmarks or targets are provided for context
- [ ] Metric relationships are mapped (how does X affect Y?)
- [ ] Vanity metrics are flagged or excluded

## 6. Recommendations & Next Steps

- [ ] Recommendations are grounded in the data, not assumptions (CRITICAL)
- [ ] A/B test suggestions are included where appropriate
- [ ] Monitoring plan: what to track after implementing changes
- [ ] Data gaps are identified with collection recommendations
- [ ] Timeline for expected impact is estimated

---

## PASS/FAIL Criteria

**PASS:** All CRITICAL items [x] and fewer than 3 non-critical failures.
**REVISE:** All CRITICAL items [x] but 3+ non-critical failures.
**FAIL:** Any CRITICAL item unchecked.
