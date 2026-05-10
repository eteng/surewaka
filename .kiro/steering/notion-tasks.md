---
inclusion: always
description: Notion Master Task Hub integration for project management tracking
---

# Notion Task Tracking

## Master Task Hub

The project management database is in Notion:
- Database: "Master Task Hub"
- Data source ID: `collection://34fbbd69-ff4a-815e-957e-000b081ef0b7`

## Schema

| Property | Type | Values |
|----------|------|--------|
| Task Name | title | Free text |
| Status | select | To-Do, In Progress, Done |
| Workstream | select | Tech, Legal, Ops, Office, Growth, Finance, Marketing, Partnerships, Product, HR |
| Priority | select | P0 (Critical), P1, P2, P3 |
| Complete | checkbox | __YES__ / __NO__ |
| Owner | person | User IDs |
| Timeline | date | Start and optional end date |
| Blocked By | relation | Other tasks in same DB |
| Blocking | relation | Other tasks in same DB |

## Task Tracking Process

When working on development tasks:

1. **Starting work** — set Status to "In Progress"
2. **Completing work** — set Status to "Done" and Complete to "__YES__"
3. **New tasks discovered** — create with Workstream "Tech", Status "To-Do", appropriate Priority
4. **Blockers found** — update the Blocked By relation

## Rules

- All code/engineering tasks use Workstream: "Tech"
- Product/design tasks use Workstream: "Product"
- Only update tasks when meaningful progress is made
- Include a brief implementation summary in the task page content when marking Done
