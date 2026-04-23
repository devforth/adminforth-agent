name: data-analytics
description: Analyze AdminForth resource data, summarize trends, and create charts from fetched rows.
---

# Involved tools

Use `get_resource` first if you need to inspect resource structure and column names.

Use `get_resource_data` to fetch data for this skill. This is the main tool for loading rows for analytics, comparisons, distributions, and trend analysis.

# Instructions

When the user asks for analytics, reports, trends, comparisons, or distributions:

- Fetch the requested data using `aggregate` tool. This tool is capable of performing fast server-side aggregations on filtered data, groupings by date including grouping by day/week/month etc. 
- if it is not possible to get the required aggregates using `aggregate`, fetch the underlying rows with `get_resource_data`. This is much heavier since returns original rows  with all fields, but allows you to perform complex calculations, comparisons, and custom groupings in-memory. Always prefer `aggregate` when possible.
- Prefer narrow requests: use filters, sorting, pagination, and date ranges whenever possible.
- If the request is ambiguous, clarify the resource, metric, grouping, or date range before fetching data.
- Return a short written summary with the key finding and most important numbers.
- If a chart would help, produce a Vega-Lite spec.

# Charts

Use Vega-Lite syntax for charts.

Return every chart as valid JSON inside a `vega-lite` fenced code block.

Every chart spec should include:
- `title.text`
- `title.subtitle`
- explicit axis titles when axes are used
- tooltips for the key fields

### Line chart

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": {
    "text": "Orders by Day",
    "subtitle": "Daily order count for the selected date range"
  },
  "data": {
    "values": [
      { "date": "2026-04-01", "orders": 18 },
      { "date": "2026-04-02", "orders": 25 },
      { "date": "2026-04-03", "orders": 21 },
      { "date": "2026-04-04", "orders": 29 }
    ]
  },
  "mark": { "type": "line", "point": true },
  "encoding": {
    "x": { "field": "date", "type": "temporal", "title": "Date" },
    "y": { "field": "orders", "type": "quantitative", "title": "Orders" },
    "tooltip": [
      { "field": "date", "type": "temporal", "title": "Date" },
      { "field": "orders", "type": "quantitative", "title": "Orders" }
    ]
  }
}
```

### Bar chart

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": {
    "text": "Revenue by Category",
    "subtitle": "Top categories in the current filtered dataset"
  },
  "data": {
    "values": [
      { "category": "Hardware", "revenue": 42000 },
      { "category": "Software", "revenue": 31500 },
      { "category": "Services", "revenue": 22750 }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": { "field": "category", "type": "nominal", "title": "Category", "sort": "-y" },
    "y": { "field": "revenue", "type": "quantitative", "title": "Revenue" },
    "tooltip": [
      { "field": "category", "type": "nominal", "title": "Category" },
      { "field": "revenue", "type": "quantitative", "title": "Revenue" }
    ]
  }
}
```

### Area chart

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": {
    "text": "Monthly Signups",
    "subtitle": "New users accumulated across the last six months"
  },
  "data": {
    "values": [
      { "month": "2025-11-01", "signups": 120 },
      { "month": "2025-12-01", "signups": 155 },
      { "month": "2026-01-01", "signups": 168 },
      { "month": "2026-02-01", "signups": 190 },
      { "month": "2026-03-01", "signups": 214 },
      { "month": "2026-04-01", "signups": 238 }
    ]
  },
  "mark": { "type": "area", "line": true, "point": true },
  "encoding": {
    "x": { "field": "month", "type": "temporal", "title": "Month" },
    "y": { "field": "signups", "type": "quantitative", "title": "Signups" },
    "tooltip": [
      { "field": "month", "type": "temporal", "title": "Month" },
      { "field": "signups", "type": "quantitative", "title": "Signups" }
    ]
  }
}
```

### Scatter plot

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": {
    "text": "Ad Spend vs Revenue",
    "subtitle": "Campaign-level correlation for the selected month"
  },
  "data": {
    "values": [
      { "campaign": "Search", "spend": 1200, "revenue": 5400 },
      { "campaign": "Social", "spend": 900, "revenue": 3100 },
      { "campaign": "Email", "spend": 350, "revenue": 2200 },
      { "campaign": "Affiliates", "spend": 700, "revenue": 3600 }
    ]
  },
  "mark": { "type": "point", "filled": true, "size": 120 },
  "encoding": {
    "x": { "field": "spend", "type": "quantitative", "title": "Ad Spend" },
    "y": { "field": "revenue", "type": "quantitative", "title": "Revenue" },
    "tooltip": [
      { "field": "campaign", "type": "nominal", "title": "Campaign" },
      { "field": "spend", "type": "quantitative", "title": "Ad Spend" },
      { "field": "revenue", "type": "quantitative", "title": "Revenue" }
    ]
  }
}
```

### Pie chart

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": {
    "text": "Tickets by Status",
    "subtitle": "Share of tickets in each workflow state"
  },
  "data": {
    "values": [
      { "status": "Open", "count": 42 },
      { "status": "In Progress", "count": 27 },
      { "status": "Resolved", "count": 58 }
    ]
  },
  "mark": { "type": "arc", "innerRadius": 40 },
  "encoding": {
    "theta": { "field": "count", "type": "quantitative", "title": "Tickets" },
    "color": { "field": "status", "type": "nominal", "title": "Status" },
    "tooltip": [
      { "field": "status", "type": "nominal", "title": "Status" },
      { "field": "count", "type": "quantitative", "title": "Tickets" }
    ]
  }
}
```

### Histogram

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": {
    "text": "Order Value Distribution",
    "subtitle": "Histogram of order totals in the filtered result set"
  },
  "data": {
    "values": [
      { "order_total": 24 },
      { "order_total": 31 },
      { "order_total": 39 },
      { "order_total": 42 },
      { "order_total": 63 },
      { "order_total": 78 },
      { "order_total": 95 }
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": { "bin": true, "field": "order_total", "type": "quantitative", "title": "Order Total" },
    "y": { "aggregate": "count", "type": "quantitative", "title": "Count" },
    "tooltip": [
      { "aggregate": "count", "type": "quantitative", "title": "Count" }
    ]
  }
}
```