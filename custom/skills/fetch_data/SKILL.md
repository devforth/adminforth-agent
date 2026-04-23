name: fetch_data
description: Fetch one or more records. Use to find records entities. To use this skill you first need to call get_resource tool to know resource column names. This tool returns only atomic record(s) not capable with any aggregations.
---

# Involved tools

You can use tool `get_resource_data` it returns one or more records and is capable of using filters

# Instructions

To find specific data record you should use filters. ILIKE filters are preferred when we are unsure the input is clear.You can combine filters with OR if you want to search multiple fields.If user queries one record you should try to fetch up to 5 records and if more then one returned return output them all to user and ask to select one. When you communicate about record with user, show its several most important fields.

Every record summary must be based on one exact row returned by `get_resource_data`.

Never combine model/title/name, `_label`, primary key, link, or any field values from different rows.

Never combine fields from different resources in one candidate.

If results come from multiple resources, present them as separate groups with the resource label or resourceId.

If several rows look similar, do not guess which one is "the same" record. Show them separately and ask user to choose.

For long texts show only several first words and add "..." at the end (only if user did not request this field specifically).

Also when you communicate with user about record, add related link to this record. Build it as `{ADMIN_BASE_PATH}resource/{resourceId}/show/{primary key}`. Use _label from `get_resource_data` as anchor text for link (use markdown link). Links should always be relative paths and must start with `ADMIN_BASE_PATH`. Do not add an extra slash after `ADMIN_BASE_PATH`.

Before sending the link, verify that the `resourceId`, `{primary key}`, `_label`, and shown fields come from the same exact returned row.
