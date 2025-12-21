# CursorFlow Prepare

## Core Philosophy: Think Like an Engineering Manager

Before writing any command, adopt the mindset of an engineering manager assigning work to developers:

### 1. Each Lane is a Developer
- **One developer = One area of responsibility**
- Just as you wouldn't assign a frontend developer to work on database migrations while simultaneously building UI components, don't mix unrelated concerns in a single lane
- A lane maintains context across its tasks—switching domains mid-lane loses that continuity

### 2. Separation of Concerns
- **Different domains → Different lanes**: Backend API and Frontend UI should be separate lanes
- **Same domain, sequential work → Multiple tasks in one lane**: Planning, implementing, and testing the same feature stays in one lane
- **Shared dependencies → Use `dependsOn`**: If the UI needs the API to exist first, make the UI lane depend on the API lane

### 3. Clear Boundaries, Clear Prompts
- Each task prompt should be specific enough that a developer could execute it without asking questions
- If your prompt says "implement the feature," that's too vague—specify WHAT, WHERE, and HOW
- Include verification steps: "Double-check that all edge cases are handled"

### 4. Fail-Safe Design
- **Expect incomplete work**: AI agents sometimes miss edge cases. Add a "verify" task at the end
- **Post-merge validation**: When a lane depends on another, include instructions to "merge, resolve conflicts, then verify integration"

---

## Terminal-First Workflow

CursorFlow follows a **terminal-first** approach. Everything is defined via CLI commands.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Create Lanes │ ──▶ │ 2. Add Tasks    │ ──▶ │ 3. Validate     │ ──▶ │ 4. Run          │
│ (prepare)       │     │ (prepare)       │     │ (doctor)        │     │ (run)           │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Step-by-Step Workflow

```bash
# Step 1: Create lanes with preset templates
# Complex feature: plan → implement → test
cursorflow prepare AuthSystem --preset complex --prompt "Build authentication system"

# Or simple fix: implement → test
cursorflow prepare BugFix --preset simple --prompt "Fix login bug"

# Or multi-lane with auto-merge for dependent lanes
cursorflow prepare FullStack --lanes 3 --sequential --preset complex \
  --prompt "Build your layer"

# Step 2: Add more lanes if needed (merge preset auto-applied)
cursorflow prepare --add-lane _cursorflow/tasks/2412211530_AuthSystem \
  --depends-on "01-lane-1,02-lane-2"  # Uses merge preset automatically

# Step 3: Add tasks to existing lanes
cursorflow prepare --add-task _cursorflow/tasks/2412211530_AuthSystem/01-lane-1.json \
  --task "verify|sonnet-4.5|Double-check all requirements|All criteria met"

# Step 4: Validate configuration
cursorflow doctor --tasks-dir _cursorflow/tasks/2412211530_AuthSystem

# Step 5: Run
cursorflow run _cursorflow/tasks/2412211530_AuthSystem
```

---

## Command Reference

### Usage

```bash
# Create new feature
cursorflow prepare <feature-name> [options]

# Add lane to existing task directory
cursorflow prepare --add-lane <task-dir> [options]

# Add task to existing lane
cursorflow prepare --add-task <lane-file> --task <spec>
```

### Options

| Option | Description |
|--------|-------------|
| **Core** ||
| `<feature-name>` | Feature name (for new task directories) |
| `--lanes <num>` | Number of lanes to create (default: 1) |
| `--preset <type>` | Use preset template: `complex` \| `simple` \| `merge` |
| **Task Definition** ||
| `--prompt <text>` | Task prompt (context for preset or single task) |
| `--criteria <list>` | Comma-separated acceptance criteria |
| `--model <model>` | Model to use (default: `sonnet-4.5`) |
| `--task <spec>` | Full task spec: `"name\|model\|prompt\|criteria"` (repeatable) |
| **Dependencies** ||
| `--sequential` | Chain lanes: 1 → 2 → 3 (auto-merge between lanes) |
| `--deps <spec>` | Custom dependency graph: `"2:1;3:1,2"` |
| `--depends-on <lanes>` | Dependencies for `--add-lane`: `"01-lane-1,02-lane-2"` |
| **Incremental** ||
| `--add-lane <dir>` | Add a new lane to existing task directory |
| `--add-task <file>` | Append task(s) to existing lane JSON file |
| **Advanced** ||
| `--template <path>` | Custom JSON template |
| `--force` | Overwrite existing files |

---

## Preset Templates

CursorFlow provides 3 preset templates for common patterns:

### `--preset complex` (plan → implement → test)

For complex features that need planning:

```bash
cursorflow prepare FeatureName --preset complex --prompt "Implement user authentication"
```

Generated tasks:
1. **plan** (sonnet-4.5-thinking): Analyze requirements, **save plan to `_cursorflow/PLAN_lane-{N}.md`**
2. **implement** (sonnet-4.5): **Read plan from `_cursorflow/PLAN_lane-{N}.md`**, build feature
3. **test** (sonnet-4.5): **Refer to plan document** for test requirements

**Plan Document Path**: Each lane saves its plan to `_cursorflow/PLAN_lane-{N}.md` where `{N}` is the lane number. The implement and test tasks explicitly reference this document.

### `--preset simple` (implement → test)

For simple changes or bug fixes:

```bash
cursorflow prepare BugFix --preset simple --prompt "Fix login validation bug"
```

Generated tasks:
1. **implement** (sonnet-4.5): Make the required changes
2. **test** (sonnet-4.5): Write/update tests

### No Preset (Single Task)

For quick, simple changes you can omit the preset entirely:

```bash
cursorflow prepare QuickFix --prompt "Fix typo in README.md"
```

Generated: Single `implement` task with your prompt directly.

### `--preset merge` (merge → test)

For integration lanes with dependencies. **Auto-applied when `--depends-on` is set**:

```bash
cursorflow prepare --add-lane _cursorflow/tasks/2412211530_Feature \
  --preset merge --depends-on "01-lane-1,02-lane-2"
```

Generated tasks:
1. **merge** (sonnet-4.5): Resolve conflicts, verify integration
2. **test** (sonnet-4.5): Run integration tests

### Auto-Detection

When a lane has dependencies (`--depends-on` or via `--sequential`), the `merge` preset is automatically applied unless you explicitly specify another preset.

### Task Spec Format (`--task`)

```
"name|model|prompt|criteria1,criteria2"
```

- **name**: Task identifier (alphanumeric, `-`, `_`)
- **model**: AI model (`sonnet-4.5`, `sonnet-4.5-thinking`, etc.)
- **prompt**: Instructions for the AI
- **criteria**: Comma-separated acceptance criteria (optional)

---

## Quick Examples

### 1. Simple Single-Lane Feature

```bash
cursorflow prepare FixBug --prompt "Fix null pointer in auth.ts line 42"
```

### 2. Single Lane with Multiple Tasks

```bash
cursorflow prepare AddAPI \
  --task "plan|sonnet-4.5-thinking|Create REST API design|Design documented" \
  --task "implement|sonnet-4.5|Build the API endpoints|All endpoints work" \
  --task "verify|sonnet-4.5|Test all edge cases|All tests pass"
```

### 3. Multiple Parallel Lanes

```bash
cursorflow prepare Dashboard --lanes 2 \
  --prompt "Implement dashboard for your layer"

# Lane 1: Frontend developer
# Lane 2: Backend developer
# Both work in parallel
```

### 4. Sequential Lanes with Dependencies

```bash
cursorflow prepare AuthSystem --lanes 3 --sequential \
  --prompt "Implement your authentication layer"

# Lane 1: DB Schema (starts immediately)
# Lane 2: Backend API (waits for Lane 1, auto-merges)
# Lane 3: Frontend (waits for Lane 2, auto-merges)
```

### 5. Adding Lanes Incrementally

```bash
# Create initial feature
cursorflow prepare PaymentFlow --lanes 2 --sequential \
  --prompt "Implement payment processing"

# Later: Add integration test lane that depends on both
cursorflow prepare --add-lane _cursorflow/tasks/2412211530_PaymentFlow \
  --prompt "Run integration tests for payment flow" \
  --criteria "All payment flows tested,Error handling verified" \
  --depends-on "01-lane-1,02-lane-2"
```

### 6. Adding Tasks to Existing Lane

```bash
# Add verification task to lane 1
cursorflow prepare --add-task _cursorflow/tasks/2412211530_PaymentFlow/01-lane-1.json \
  --task "verify|sonnet-4.5|Double-check payment validation|All validations work"
```

---

## Understanding `dependsOn`

`dependsOn` is not just ordering—it triggers **automatic branch merging**.

### How It Works

1. Lane 1 completes and creates branch `feature/lane-1-abc123`
2. Lane 2 starts, `runner.ts` **merges Lane 1's branch** into Lane 2's worktree
3. Lane 2 now has all of Lane 1's code changes and can build upon them

### Dependency Patterns

```bash
# Sequential: 1 → 2 → 3
cursorflow prepare Feature --lanes 3 --sequential

# Diamond: 1 → 2, 1 → 3, 2+3 → 4
cursorflow prepare Feature --lanes 4 --deps "2:1;3:1;4:2,3"

# Parallel then merge: 1, 2 (parallel) → 3
cursorflow prepare Feature --lanes 3 --deps "3:1,2"
```

### Example: 3-Lane Authentication System

```bash
cursorflow prepare AuthSystem --lanes 3 --deps "2:1;3:1,2" \
  --prompt "Implement your assigned component"
```

| Lane | Role | dependsOn | When It Starts |
|------|------|-----------|----------------|
| 01-lane-1 | DB Schema | (none) | Immediately |
| 02-lane-2 | Backend API | 01-lane-1 | After DB done, merges DB branch |
| 03-lane-3 | Integration Tests | 01-lane-1, 02-lane-2 | After both, merges both branches |

---

## Task Design Patterns

### Standard Patterns

**Complex Feature (recommended):**
```bash
cursorflow prepare ComplexFeature \
  --task "plan|sonnet-4.5-thinking|Analyze requirements and create plan|Plan documented" \
  --task "implement|sonnet-4.5|Implement according to plan|Code complete" \
  --task "verify|sonnet-4.5|Double-check all requirements are met|All tests pass"
```

**Simple Change:**
```bash
cursorflow prepare SimpleFix \
  --task "implement|sonnet-4.5|Fix the bug and add test|Bug fixed,Test added" \
  --task "verify|sonnet-4.5|Verify fix works in all cases|All cases handled"
```

**Merge Lane (for dependent lanes):**
```bash
# Create as 4th lane depending on 2 and 3
cursorflow prepare --add-lane _cursorflow/tasks/2412211530_Feature \
  --depends-on "02-lane-2,03-lane-3" \
  --task "merge|sonnet-4.5|Merge branches and resolve conflicts|Clean merge" \
  --task "integrate|sonnet-4.5|Verify integration|Tests pass"
```

### Best Practices

1. **Be Specific**
   - ❌ "Implement the feature"
   - ✅ "Create `src/api/users.ts` with GET/POST/PUT/DELETE endpoints for User model"

2. **Include Verification**
   - Always add a final "verify" task
   - AI agents often miss edge cases on first pass

3. **Scope Post-Merge Tasks**
   - When `dependsOn` is set, include: "After merging, resolve any conflicts and verify integration"

4. **Use Thinking Models for Planning**
   - Use `sonnet-4.5-thinking` for `plan` tasks (deeper reasoning)
   - Use `sonnet-4.5` for `implement` tasks (faster execution)

---

## When to Use Multiple Lanes

### Good Use Cases for Separate Lanes

| Scenario | Lanes | Why |
|----------|-------|-----|
| Frontend + Backend | 2 | Different file sets, can run in parallel |
| Database + API + UI | 3 | Sequential dependency, clean separation |
| Multiple microservices | N | Completely isolated codebases |
| Refactor + New Feature | 2 | Refactor first, feature depends on it |

### Keep in Single Lane

| Scenario | Why |
|----------|-----|
| Sequential tasks on same files | Context continuity |
| Plan → Implement → Test same feature | Single developer mindset |
| Tightly coupled changes | Avoid merge complexity |

---

## Validation with Doctor

Before running, always validate your configuration:

```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/2412211530_FeatureName
```

The doctor command checks:
- Required fields (`tasks`, `name`, `prompt`)
- Valid task name format
- Correct dependency graph (no circular dependencies)
- Configuration value types

---

## Generated File Structure

```
_cursorflow/tasks/2412211530_FeatureName/
├── 01-lane-1.json     # Lane 1 configuration
├── 02-lane-2.json     # Lane 2 configuration
├── 03-lane-3.json     # Lane 3 configuration (if added)
└── README.md          # Auto-generated instructions
```

### JSON Schema

```json
{
  "baseBranch": "main",
  "branchPrefix": "featurename/lane-1-",
  "timeout": 600000,
  "enableIntervention": false,
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "enableReview": true,
  "reviewModel": "sonnet-4.5-thinking",
  "maxReviewIterations": 3,
  "laneNumber": 1,
  "devPort": 3001,
  "dependsOn": ["01-lane-1"],
  "tasks": [
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "prompt": "Your task instructions here",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"]
    }
  ]
}
```

### Key Fields

| Field | Required | Description |
|-------|----------|-------------|
| `tasks` | Yes | Array of task objects |
| `tasks[].name` | Yes | Task identifier |
| `tasks[].prompt` | Yes | Instructions for AI agent |
| `tasks[].model` | No | Model override |
| `tasks[].acceptanceCriteria` | No | Criteria for AI review |
| `dependsOn` | No | Array of lane names to wait for |
| `baseBranch` | Yes | Branch to create worktree from |
| `branchPrefix` | Yes | Prefix for the feature branch |

---

## Checklist

### Before Creating Tasks
- [ ] Requirements are clearly understood
- [ ] Work is divided by domain (one lane = one area of responsibility)
- [ ] Dependencies between lanes are identified

### After Creating Tasks
- [ ] Each task has a specific, actionable prompt
- [ ] Acceptance criteria are measurable
- [ ] Dependent lanes include merge/integration instructions
- [ ] Final task includes verification step

### Before Running
- [ ] `cursorflow doctor --tasks-dir <dir>` passes with no errors
- [ ] JSON files reviewed for any issues
