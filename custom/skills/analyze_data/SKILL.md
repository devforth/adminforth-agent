name: analyze_data
description: Universal skill to analyze AdminForth resource data, summarize trends, and compare distributions from fetched rows.
---

# Involved tools

Always call `get_resource` first if you need to inspect resource structure and column names.

Then you need to select between two main tools for fetching data:

- Load and call `aggregate` tool to fetch data for analytics. This is the main tool for fast server-side aggregations, including filtered data, grouped metrics, and date buckets such as day, week, or month. Always prioritize this way of fetching data for analytics, as it is optimized for performance and reduces the amount of data transferred and processed in-memory.

- Load and call `get_resource_data` tool only when the requested analysis cannot be answered with `aggregate`. When using it, pass `columns` with only the fields required for the calculation so large result sets do not include unrelated row data.

# Instructions

When the user asks for analytics, reports, trends, comparisons, or distributions:

- Fetch the requested data using `aggregate` whenever possible.
- If it is not possible to get the required aggregates using `aggregate`, fetch the underlying rows with `get_resource_data`.
- Prefer narrow requests: use filters, sorting, pagination, and date ranges whenever possible.
- Prefer narrow row payloads: include `columns` when only one or a few fields are needed.
- If the request is ambiguous, clarify the resource, metric, grouping, or date range before fetching data.
- Return a short written summary with the key finding and most important numbers.
- If the user asks for a chart, or if a chart would help and you decide to produce one, invoke the `charts` skill for chart formatting and Vega-Lite requirements.
