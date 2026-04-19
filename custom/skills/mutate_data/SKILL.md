name: mutate_data
description:  Create/update/delete some record of resource or call actions on one or multiple records
---

# General rules

- if there is a dedicated action for some routine (result of `get_resource` tool call, field actions), prefer this to manual updating of records, for example, if you want to approve some comment, prefer calling `approve` action instead of updating `approved` field of comment record (because in action there might be some additional logic like sending notification to user, updating some counters and so on)

## Confirmation

Before performing any state mutation including action calls edit/delete please fetch record which is going to be edited/deleted and show user record in format field → value (show several most important fields which can help user to understand what exactly record he is going to edit or delete). 
For field values with long texts show only several first words and add "..." at the end.
Also please add related link to record with will be changed. For example /{BASE_URL}/resource/{resourceId}/show/{primary key}. Use _label from `get_resource_data` as anchor text for link (use markdown link).
And in the same message ask user for final confirmation.

When creating new record, show user all data which you gona create and in same message ask for confirmation.

# Calling actions

To call action on some record you can use `start_custom_action` tool,  or `start_custom_bulk_action` if you need to perform action on several records at once. 

Before calling any of this action you should understand whether this action is allowed. User result of `get_resource` tool call and check `action.allowed` - if this attribute is true or is not exists, assume action is allowed. If this attribute is false, action is not allowed, you should warn user that this action is not allowed for him.

### Example

If you want to block some user you can confirm that this action by saying:

```I am going to block user:
* Username: john_doe
* Email: john_doe@example.com
* IP Country: USA
* Currently blocked: No // show this field only if it exists in user record

View [John Doe](/resource/users/show/123)
Are you sure?
```

## Updating

You can use tool `update_record` tool it updates fields of record. To update `allowedActions.edit` should be set to true and 
`updated` column `showIn.edit` should be true at the same time. If one of this condition is not met, explain to user that is 
not allowed to edit

In addition to instructions above show user the table of edits (old value/new value)

### Examples

For example if you gonna modify user record, in confirmation please share full user info (not only username but also email, ip country - anything which help adminto check that that is correct user). Message could look like this:

```
I am going to update user:
* Username: john_doe
* Email: john_doe@example.com
* IP Country: USA
I am going to change email from john_doe@example.com to new_email@example.com

View [John Doe](/admin/resource/users/show/123)

Are you sure?
```


## Deleting

To delete some record you can use `delete_record` tool. To delete record `allowedActions.delete` should be set to true.

### Example 

If you gonna delete user record, in confirmation please share full user info (not only username but also email, ip country - anything which help adminto check that that is correct user). Message could look like this:

```I am going to delete user:
* Username: john_doe
* Email: john_doe@example.com
* Signed up: 2024 Jan 1
* IP Country: USA

View [John Doe](/admin/resource/users/show/123)

Are you sure?
```

## Creating

To create new record you can use tool `create_record`. To create record `allowedActions.create` should be set to true.

When calling `create_record` tool pass only columns which have `showIn.create` set to true.

After creation of new record also show user a link to this record. If several records record were created, show links to all of them in list.