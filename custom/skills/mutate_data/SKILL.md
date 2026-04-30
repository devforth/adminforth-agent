name: mutate_data
description:  Create/update/delete some record of resource or call actions on one or multiple records
---

# Involved tools

Use `create_record` for creating records.

Use `update_record` for editing records.

Use `delete_record` for deleting records.

Use `start_custom_action` and `start_custom_bulk_action` for resource actions.

# General rules

- if there is a dedicated action for some routine (result of `get_resource` tool call, field actions), prefer this to manual updating of records, for example, if you want to approve some comment, prefer calling `approve` action instead of updating `approved` field of comment record (because in action there might be some additional logic like sending notification to user, updating some counters and so on)

## Confirmation

Before performing any state mutation including action calls edit/delete please fetch record which is going to be edited/deleted and show user record in format field → value (show several most important fields which can help user to understand what exactly record he is going to edit or delete). 

Every confirmation must describe one exact fetched row. Never combine `_label`, primary key, link, or field values from different rows or different resources in one confirmation.

For field values with long texts show only several first words and add "..." at the end.
Also please add related link to record with will be changed. Build it as `{ADMIN_BASE_PATH}resource/{resourceId}/show/{primary key}`. Use _label from `get_resource_data` as anchor text for link (use markdown link). Links should always be relative paths and must start with `ADMIN_BASE_PATH`. Do not add an extra slash after `ADMIN_BASE_PATH`.

Before sending the confirmation, verify that the `resourceId`, `{primary key}`, `_label`, and all shown fields come from the same exact fetched row.

# Calling actions

To call action on some record you can use `start_custom_action` tool,  or `start_custom_bulk_action` if you need to perform action on several records at once. 

Before calling any of this action you should understand whether this action is allowed. User result of `get_resource` tool call and check `action.allowed` - if this attribute is true or is not exists, assume action is allowed. If this attribute is false, action is not allowed, you should warn user that this action is not allowed for him.

## Updating

You can use tool `update_record` tool it updates fields of record. To update `allowedActions.edit` should be set to true and 
`updated` column `showIn.edit` should be true at the same time. If one of this condition is not met, explain to user that is not allowed to edit

In addition to instructions above show user the table of edits (old value/new value)

## Deleting

To delete some record you can use `delete_record` tool. To delete record `allowedActions.delete` should be set to true.

## Creating

To create new record you can use tool `create_record`. To create record `allowedActions.create` should be set to true.

When calling `create_record` tool pass only columns which have `showIn.create` set to true and `backendOnly` is not set to true.

For decimal fields please use string values with dot as decimal separator.

After creation of new record also show user a link to this record. If several records record were created, show links to all of them in list.

Omit any pictures or file paths, you are not capable of doing it. If they are not required all is good, if they are required, explain to user that you are not able to create record because of this reason.

### Working with dates 

When you create or update date or datetime fields, please use ISO format for this. For example, "2024-01-01" for date and "2024-01-01T12:00:00Z" for datetime. If user provides date in different format, try to parse it and convert to ISO format.
