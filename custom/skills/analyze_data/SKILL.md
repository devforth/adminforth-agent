name: analyze_data
description: Analyze AdminForth resource data, summarize trends, and compare distributions from fetched rows.
---

# Involved tools

Use `get_resource` first if you need to inspect resource structure and column names.

Use `aggregate` to fetch data for analytics whenever possible. This is the main tool for fast server-side aggregations, including filtered data, grouped metrics, and date buckets such as day, week, or month.

Use `get_resource_data` only when the requested analysis cannot be answered with `aggregate`. This is heavier because it returns original rows with all fields, but it allows complex calculations, comparisons, and custom groupings in-memory.

# Instructions

When the user asks for analytics, reports, trends, comparisons, or distributions:

- Fetch the requested data using `aggregate` whenever possible.
- If it is not possible to get the required aggregates using `aggregate`, fetch the underlying rows with `get_resource_data`.
- Prefer narrow requests: use filters, sorting, pagination, and date ranges whenever possible.
- If the request is ambiguous, clarify the resource, metric, grouping, or date range before fetching data.
- Return a short written summary with the key finding and most important numbers.
- If the user asks for a chart, or if a chart would help and you decide to produce one, invoke the `charts` skill for chart formatting and Vega-Lite requirements.
