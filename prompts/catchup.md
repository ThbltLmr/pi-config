---
description: Summarize all changes since the last merge commit
---

Review all changes since the last merge commit and provide a concise catchup summary.

## Process

1. Find the last merge commit:

   ```bash
   git log --merges -1 --format="%H"
   ```

2. If no merge commit exists, use a sensible base such as the repository root commit, upstream default branch, or ask if ambiguous.

3. Gather changed files:

   ```bash
   git diff --name-only <merge_commit>..HEAD
   git diff --name-only HEAD
   git diff --name-only --cached
   ```

4. Inspect relevant diffs:

   ```bash
   git diff <merge_commit>..HEAD -- <file>
   git diff HEAD -- <file>
   git diff --cached -- <file>
   ```

5. Read files when the diff alone is insufficient to understand the change.

## Output

Respond with a concise grouped summary:

```markdown
## Catchup since <merge_commit_short>

### <area / feature>
- <what changed and why, if discernible> (`path/to/file:line`)
- <another change>

### Validation / risks
- <tests run or not run>
- <notable risks or follow-ups>
```

Keep bullets short, concrete, and useful for someone rejoining the branch. Focus on what changed, not every line touched.
