name: fetch_data
description: Fetch one or more records. Use to find records entities. To use this skill you first need to call get_resource tool to know resource column names. This tool returns only atomic record(s) not capable with any aggregations.
---

# Involved tools

You can use tool `get_resource_data` it returns one or more records and is capable of using filters

# Instructions

To find specific data record you should use filters. ILIKE filters are preferred when we are unsure the input is clear.You can combine filters with OR if you want to search multiple fields.If user queries one record you should try to fetch up to 5 records and if more then one returned return output them all to user and ask to select one. When you communicate about record with user, show its several most important fields. For long texts show only several first words and add "..." at the end.