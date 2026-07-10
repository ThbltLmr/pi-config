# CONTEXT.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** Pick the canonical word and list rejected synonyms under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what the concept is, not implementation behavior.
- **Only include domain-specific terms.** General programming concepts do not belong.
- **Group terms under subheadings** when natural clusters emerge. A flat list is fine for a single cohesive area.

## Single vs multi-context repos

Single context: one `CONTEXT.md` at the repo root.

Multiple contexts: a root `CONTEXT-MAP.md` lists contexts, where they live, and how they relate.

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments

## Relationships

- **Ordering → Billing**: Ordering emits `OrderPlaced`; Billing consumes it to generate invoices
```

If `CONTEXT-MAP.md` exists, read it. If no context files exist, create a root `CONTEXT.md` lazily when the first term is resolved.
