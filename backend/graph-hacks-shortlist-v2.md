# Stronger Graph Hacks shortlist

Research date: 14 October 2026, Asia/Kolkata. These selections replace the first-round recommendations. They are strategic judgments, not official scores or win probabilities. No implementation or benchmark was run.

## Overall selection: Rewind

An agent memory system with explicit evidence lineage and selective correction across agents. A verified source revocation invalidates memories that lose their support, identifies affected runs, stops pending actions grounded in invalid state, and resumes only the necessary work. Independently supported knowledge remains usable.

The memorable demo: a poisoned source contributes a false supplier payment fact; a planner and executor reuse it across sessions. Revoke that source. The graph shows the recorded propagation, the mock payment boundary rejects an action proposed against an obsolete memory revision, affected workers restart with corrected context, and unrelated knowledge survives.

FalkorDB stores Source -> Fact -> DerivedFact/Procedure -> Run -> ProposedAction relationships, plus source authority, valid-time metadata, tenant, and revision. Instrument retrieval and require explicit supporting IDs for derived facts. A run reading a fact is potentially affected; do not pretend to reconstruct hidden model reasoning. Maintain independent supports so revoking one source does not erase facts justified elsewhere.

Minimum scope: two agents, two tenants, one simulated procurement workflow, versioned memory, a source-revocation tool, and a mock action executor that checks current revisions outside the LLM. Include episodic run history, semantic facts, and verified procedural memory. Show persistence across process restarts and concurrent memory updates. Revocation cannot undo completed real-world actions; list such actions for review. This is correction machinery, not a universal poison detector.

Evidence:

- [Reddit practitioner discussion of memory poisoning](https://www.reddit.com/r/AIMemory/comments/1v7kd7b/has_anyone_else_run_into_memory_poisoning_in/): reports persistence and reinforcement of incorrect/stale memory. Anecdotal evidence.
- [Forcepoint's primary research write-up](https://www.forcepoint.com/blog/x-labs/persistent-memory-poisoning-ai-agents): discusses malicious material persisting in agent memory and influencing later tasks.
- [MemoryGraft](https://arxiv.org/abs/2512.16962): studies poisoned successful experiences causing persistent behavioral drift in a specific evaluated agent stack. Do not generalize to every product.
- [MemSecBench](https://arxiv.org/abs/2607.27080): studies persistence, downstream consequences, and selective repair across evaluated configurations. A source of evaluation ideas, not proof Rewind is effective.
- [Glen on YC](https://www.ycombinator.com/companies/glen) and [Wato on YC](https://www.ycombinator.com/companies/wato): shared organizational agent context already has commercial entrants. Rewind's focus is lineage-aware correction and dependent-action handling, not generic memory storage. No claim of being first.

Evaluation proposals: contamination spread, affected-run identification, independently supported knowledge retained, blocked stale actions, tenant isolation, concurrent writes, restart behavior, and correct recomputation on labeled synthetic cases. Report measured fixture results only.

## Track 01: AccessCut

An agent that removes a departing person's reachable access while keeping legitimate automated workflows operating. Distinguish human access, known/copied credentials, service identity permissions, workload dependency, and credential rotation state. Removing an employee from a group does not inherently revoke a shared credential they may possess.

The memorable demo: disabling the ordinary user leaves a test API credential working. Blind revocation would stop the nightly billing job. AccessCut discovers both paths, immediately proposes containment, prepares a replacement machine credential, updates the owned test workload, checks health, rotates the exposed credential, and verifies the former access fails. Every real write must use an approved action plan. Verification is bounded to the inventoried integrations and tested permissions.

Minimum scope: one departing person, one GitHub integration, a local mock business API with real token enforcement, and one scheduled job. Use known policy semantics and discovered paths. Candidate edge cuts plus dependency-aware ordering are enough; a globally optimal constrained minimum cut is not a required claim.

Evidence:

- [Service account/API-key offboarding discussion](https://www.reddit.com/r/sysadmin/comments/1ur2w0a/whats_your_offboarding_process_for_service/): asks how to handle undocumented integrations beyond ordinary checklists.
- [Offboarding checklist discussion](https://www.reddit.com/r/sysadmin/comments/11m1e6i/): reports lingering access and warns about automations running as employee accounts.
- [Gather on YC](https://www.ycombinator.com/companies/gather): onboarding/offboarding coordination is an established commercial category.
- [Lumos non-human identity guide](https://www.lumos.com/identity-matters/non-human-identity/non-human-identity): discusses service identities outside ordinary employee lifecycle events.
- [Lumos agent identity governance](https://www.lumos.com/identity-matters/non-human-identity/ai-agent-identity-governance) and [Veza insider threat product](https://veza.com/resources/veza-for-insider-threat/): both cover related identity lifecycle concerns. The narrow demonstration should emphasize dependency-aware migration and verified access closure, not unprecedented discovery.

Evaluation proposals: tested access paths closed, protected workflows remaining healthy, incorrect revocations, and incomplete discovery explicitly reported.

## Track 03: LastDay

A company-brain agent that runs an evidence-based departure drill: which workflows lose ownership or verified know-how when a specific person becomes unavailable, what questions remain unanswered, and what handover would close those gaps?

The memorable demo: mark the senior engineer unavailable in a fictional company. Trace their role through billing operations, incident workarounds, customer dependencies, and source documents. Find critical workflows with no verified backup; ask targeted interview questions grounded in missing evidence; capture reviewed answers and their provenance; create successor tasks. A replacement completes a sandbox task using the new runbook, which closes that specific verified gap.

FalkorDB stores people, teams, systems, workflows, decisions, documents, incidents, and customer/project dependencies. Model ownership separately from demonstrated capability and general contribution. Commit count or recent messages do not establish competence. A missing backup in the graph means missing documented evidence, not proof nobody else knows the workflow. The agent cannot recover knowledge absent from all sources without asking someone.

Minimum scope: a fictional company of about 12 people, three important workflows, a small GitHub repository, synthetic ticket/chat history, and an interactive text interview. Avoid building a full HR system or using real employee scoring.

Evidence:

- [Engineering manager's knowledge-transfer crisis](https://www.reddit.com/r/EngineeringManagers/comments/1qut5qh/suffering_the_consequences_of_tribal_knowledge/): a manager describes reliance on a departing long-tenured engineer. Comments disagree about severity and remedies; treat it as a reported scenario, not a universal pattern.
- [Institutional knowledge discussion on Hacker News](https://news.ycombinator.com/item?id=22454333): discusses moving from individual know-how to durable organizational context.
- [Hexa on YC](https://www.ycombinator.com/companies/hexa): its industrial-distribution launch identifies departing experienced workers and lost operational knowledge as a problem. This is adjacent vertical evidence, not direct validation for the proposed software-team product.
- [Hyperspell on YC](https://www.ycombinator.com/companies/hyperspell): broad company-context tools already exist. LastDay should lead with a named departure, specific gaps, adaptive elicitation, and a tested successor workflow.

Evaluation proposals: correct ownership/dependency paths, missing evidence correctly marked, targeted questions answered, and specific successor tasks completed. Do not report a universal bus-factor score as objective truth.

## Decision

Rewind has the most distinctive technical story for the memory track. AccessCut has the clearest action-and-verification demo. LastDay has the most accessible company-brain story. For a four-day build, choose one central workflow and two agents at most initially. Preserve the first-round lesson from WeMakeDevs winners: observable effects, credible evidence, and an honest demonstration of a failure boundary matter more than the breadth of the feature list.
