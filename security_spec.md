# Shate AI - Security Specification

## 1. Data Invariants
- Every document must belong to a `userId` matching the authenticated user.
- Tasks must have a valid `panelId` if scheduled.
- Messages must be associated with a valid `chatId`.
- Routines are strictly per-user and only two types exist: `morning` and `evening`.
- Email MUST be verified for all write operations.

## 2. Dirty Dozen Payloads

1.  **Identity Spoofing**: Create a task with `userId` of another user.
2.  **Resource Poisoning**: Create a task with a document ID that is 2MB long.
3.  **Shadow Update**: Update a task and add an `isAdmin` field.
4.  **PII Leak**: Attempt to list all `chats` without a `where` clause on `userId`.
5.  **Unverified Write**: Attempt to create a task with `email_verified: false` in auth token.
6.  **Immutable field breach**: Attempt to change the `userId` of an existing task.
7.  **Terminal State Bypass**: Attempt to update a task and change `createdAt`.
8.  **List Query Scraping**: List messages without specializing the `chatId` or `userId`.
9.  **Type Injection**: Set `completed` to a string "yes" instead of boolean.
10. **Size Attack**: Set `content` of a message to 1MB of text.
11. **Relational Orphan**: Create a message for a non-existent `chatId` (though `exists()` is expensive in list queries, we check it for single creates).
12. **Routine Overflow**: Add 10,000 task IDs to a routine list.

## 3. Conflict Report

| Collection | Identity Spoofing | State Shortcutting | Resource Poisoning | Status |
| :--- | :--- | :--- | :--- | :--- |
| tasks | Blocked by `isOwner` | Blocked by `isValidTask` | Blocked by `isValidId` | PASS |
| panels | Blocked by `isOwner` | N/A | Blocked by `isValidId` | PASS |
| chats | Blocked by `isOwner` | N/A | Blocked by `isValidId` | PASS |
| messages | Blocked by `isOwner` | Blocked by `isValidMessage` | Blocked by `isValidId` | PASS |
| routines | Blocked by `isOwner` | Blocked by `isValidRoutine` | Blocked by `isValidId` | PASS |
