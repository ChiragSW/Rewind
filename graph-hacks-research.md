# Graph Hacks research and idea selection

Research date: 14 October 2026, Asia/Kolkata. This is an idea and research note, not implementation work. Rankings are strategic judgment, not published judging scores or estimated probabilities of winning.

## Original shortlist

The user requested stronger alternatives after this first round. The current recommendation is **Rewind**, with **AccessCut** and **LastDay** as the other track selections. See [the second-round shortlist](graph-hacks-shortlist-v2.md). The original research below is retained as background.

Build **PromiseGraph**, primarily for Company Brain. It traces a changed engineering dependency to customer commitments, deadlines, owners, and source evidence, then prepares the follow-up work. Add connected-data actions and durable agent handoffs only after the primary workflow works reliably.

| Track | Selected concept | Distinctive behavior | Main implementation risk |
| --- | --- | --- | --- |
| Agents That Act on Connected Data | ClaimTrace | Investigates linked refund claims while testing legitimate product or delivery explanations | Available identity signals and false positives |
| Agent Memory and Coordination | CaseRelay | Preserves diagnostic attempts, evidence, constraints, and version-dependent procedures across support handoffs | Stale memory and concurrent updates |
| Company Brain | PromiseGraph | Finds customer commitments affected by engineering changes and prepares an accountable response | Extracting and resolving commitments accurately |

## Evidence and limitations

The research used the public event brief and rules, three previous WeMakeDevs project galleries, public winning repositories, YC company profiles and founder launch posts, Reddit discussions, and primary technical documentation. Reddit accounts are anecdotal and sometimes promotional. Founder descriptions establish what companies say they solve; they do not independently validate product effectiveness or willingness to pay. No customer interviews, private YC Bookface access, or independent product tests were performed. All demo sizes, customer values, and performance targets below are proposed fixtures, not measured outcomes.

## Event requirements

[Official brief](https://www.wemakedevs.org/hackathons/falkordb) permits entering multiple tracks. [Official rules](https://www.wemakedevs.org/hackathons/falkordb/rules) require central use of FalkorDB, allowed data, a public repository, graph model and essential queries in the README, a working demo, and deployment or complete local setup. The event runs October 15 at 12:01 AM IST through October 18 at 11:59 PM IST. Main coding and design work must begin during the event; advance research, notes, and graph sketches are allowed. AI assistant use must be disclosed. Recheck rules when the event opens.

## Track 1: ClaimTrace

**Pitch:** Investigate suspicious refund clusters and show whether the evidence points to related-account abuse, a bad product batch, a delivery problem, or insufficient information.

**Buyer hypothesis:** A merchant's fraud or returns operations lead who currently joins order history, customer messages, shipping records, and warehouse observations manually.

Evidence:

- [Merchant describing a repeat purchaser with a different email](https://www.reddit.com/r/shopify/comments/1ux9ghs/customer_refund/): the merchant reports identical name/address but a new email. This supports identity continuity as an investigation problem; it does not establish that the customer committed fraud.
- [Founder asking about excessive chargebacks](https://www.reddit.com/r/startups/comments/1bdsyed/): a creator marketplace founder describes tension between payouts and later disputes, despite account requirements and KYC. This is adjacent evidence for connected risk investigation, not proof of the proposed ecommerce workflow.
- [Repeat disputes from one customer](https://www.reddit.com/r/shopify/comments/1uwzjxq/repeat_chargebacks_from_same_customer/): evidence assembly and repeat activity remain operational concerns.
- [Chargehound on YC](https://www.ycombinator.com/companies/chargehound): already automates dispute responses. Evidence generation by itself is an established product category.
- [Pango on YC](https://www.ycombinator.com/companies/pango): its founders describe fragmented post-purchase tools and difficulty automating returns. Their claimed results are not independently verified here.
- [Stripe's Radar expansion](https://stripe.com/blog/expanding-stripe-radar-to-protect-more-of-your-business): multi-account abuse is already addressed by major fraud products. Do not pitch connected-account detection as unprecedented.
- [Signifyd return abuse report](https://www.signifyd.com/ecommerce-fraud-and-returns-trends-2025/): documents return abuse as a commercial concern. Vendor statistics should be identified as vendor data if used in a presentation.
- [Previous Agent Harness submissions](https://www.wemakedevs.org/hackathons/trueforge/projects): RefundGuard and a support/refund agent already appear in the gallery. ClaimTrace needs the linked investigation and competing explanations to distinguish itself.

Proposed graph: Customer -> Order -> RefundClaim; Order -> Shipment -> DeliveryEvent; Customer -> Address; Order -> Product -> Batch; Claim -> SupportMessage. Add device or payment identifiers only when present in authorized data. Distinguish observed relationships from hypothesized identity matches, preserve evidence IDs, and avoid merging people based on one shared address.

Agent behavior: select graph investigation tools, expand related cases, compare refund timing and corroborating records, request missing evidence, and prepare a review case. Treat correlations as review signals. One approved write should create or annotate a case in an owned test system; demonstrate its returned ID and persisted result.

Proposed demo fixture: 200 synthetic orders with a suspected related-account cluster, a legitimate household, a defective product batch, and an ambiguous case. Reveal an apparently suspicious refund burst that is actually explained by a warehouse defect record. No automatic fraud accusation or refund denial.

Evaluate correct grouping, legitimate cases escalated unnecessarily, source completeness, and correct abstention. These would be fixture results, not real fraud detection accuracy.

## Track 2: CaseRelay

**Pitch:** A support investigation survives a new session, a new specialist, and a product version change without repeating failed diagnostics or forgetting restrictions.

**Buyer hypothesis:** Technical support lead at a B2B software or connected-device company handling complex cases across shifts and engineering escalations.

Evidence:

- [Agent builders asking about session bloat and handoff](https://www.reddit.com/r/AI_Agents/comments/1wbifl0/how_are_you_all_handling_session_bloat_and_state/): describes costs and context loss when passing work to a fresh or specialized agent.
- [Lost constraints between agents](https://www.reddit.com/r/AI_Agents/comments/1r86fmq/the_real_reason_your_multiagent_system_fails_isnt/): rejected approaches and their reasons can disappear at handoff. This is an anecdotal design account.
- [CSM describing incomplete support investigations](https://www.reddit.com/r/CustomerSuccess/comments/1q2f3p3/lack_of_confidence_in_support_team_assistance_for/): issues bounce back without sufficient testing, creating specialist workload.
- [Mem0 on YC](https://www.ycombinator.com/companies/mem0): persistent agent memory is already a mature competitive theme.
- [Wato on YC](https://www.ycombinator.com/companies/wato): shared company memory and reusable agent workflows already have direct competition.
- [Telemetron's historical launch, retained on the Layers YC profile](https://www.ycombinator.com/companies/layers): hardware support requires telemetry, firmware knowledge, manuals, warranty logic, and escalations. The profile now represents a changed company identity; use the launch as historical evidence.
- [Telemetron product site](https://www.telemetron.ai/): confirms an existing connected-device support offering. CaseRelay should focus on version-aware persistent investigations rather than claim to invent telemetry support.
- [MAST research paper](https://arxiv.org/abs/2503.13657): identifies system design, inter-agent misalignment, and verification failure categories across multi-agent traces. This supports the importance of handoffs; it does not validate CaseRelay.

Proposed graph: Case -> Episode -> DiagnosticAttempt -> Evidence; Attempt -> Hypothesis with tested/refuted status; Device or Installation -> ProductVersion; Procedure -> ApplicableVersion; Case -> Constraint; Agent -> Handoff -> Case. Preserve history and record when an observation was made and when it was valid.

Memory types: episodic attempts and outcomes; semantic confirmed facts and constraints; procedural verified diagnostic sequences with applicability conditions. Procedures become reusable after verified resolution, not after an agent claims success.

Proposed demo: agent A records that a reboot failed, captures logs and a customer restriction against factory reset, then the worker process is terminated. Agent B resumes from FalkorDB with no old chat window. It avoids repeating the reboot and violating the restriction, selects the next justified diagnostic, and verifies resolution. A later firmware update invalidates an old procedure's applicability without erasing history.

Minimum scope: two specialist agents, one product family, a deterministic diagnostic simulator, persistent graph memory, one real ticket action in a test workspace, and two isolated tenants. Two simultaneous writers should preserve both observations and explicitly resolve conflicting status. Do not equate namespacing with authorization; server-side access control is required.

Evaluate unnecessary repeated diagnostics, retained constraints, successful recovery after restart, stale procedure rejection, conflict handling, and tenant isolation. Compare against the same agents with summary-only handoffs.

## Track 3: PromiseGraph

**Pitch:** Before a project delay or dependency change breaks a customer commitment, trace who is affected, why, who owns the response, and what can be done next.

**Buyer hypothesis:** Founder, head of customer success, or product leader at a growing B2B SaaS company where customer commitments and engineering execution live in different systems.

Evidence:

- [Startup CTO describing CEO overselling](https://www.reddit.com/r/startups/comments/ugq8ss/): a founder reports promises outside current capability and scope. This supports the coordination problem, not every allegation in the discussion.
- [Sales-to-onboarding handoff depends on memory](https://www.reddit.com/r/CustomerSuccess/comments/1wqahi8/our_sales_to_onboarding_handoff_currently_depends/): onboarding and CS reconstruct what was promised from notes and conversations.
- [Custom workflows becoming the roadmap](https://www.reddit.com/r/startups/comments/1v3sa2b/every_enterprise_prospect_wants_one_custom/): founders discuss the boundary between sales engineering and lasting product work.
- [Internal knowledge fragmentation](https://www.reddit.com/r/startups/comments/1korcvt/): source ownership, staleness, and Slack archaeology are recurring concerns. Several proposed remedies are organizational habits, so the product must complement ownership rather than replace it.
- [Poth Labs on YC](https://www.ycombinator.com/companies/poth-labs): customer graphs across tickets, calls, CRM, and analytics already exist. A broad customer brain would overlap directly.
- [Kraftful on YC](https://www.ycombinator.com/companies/kraftful): feedback aggregation, revenue context, and ticket generation are also established.
- [Memoir on YC](https://www.ycombinator.com/companies/memoir): the page contains both a proactive company-teammate description and launch history. Its launch account says an earlier company-brain pitch lacked urgency. Avoid assuming all page descriptions represent the same product stage.
- [Promptless on YC](https://www.ycombinator.com/companies/promptless): automatic documentation updates are a neighboring category; stale-doc correction alone is not a sufficient distinctive pitch.

Proposed graph: Account -> Commitment -> Feature -> Ticket -> Dependency; Commitment -> Deadline; Person -> Owns -> Ticket or Account; Decision -> Supersedes -> Decision; Commitment and Decision -> SourceMessage or Document. Classify wishlist requests, tentative estimates, and confirmed commitments separately. A newer comment does not automatically override an approved commitment.

Agent behavior: ingest a ticket change, trace affected confirmed commitments, identify owners and decision rationale, calculate affected account value without double-counting, check unresolved dependencies, and prepare a response plan. Generate task/comment drafts and customer updates with source links. Human approval precedes sending or changing commitments.

Proposed demo: a fictional export milestone slips. PromiseGraph connects the delay to two customers' dated commitments and a dependency owner. It cites the original promise and relevant project decision. Then introduce an approved revised deadline for one account; its alert clears while the other remains. A tentative request from a third account must never be treated as a promise.

Minimum scope: synthetic CRM rows, an allowed chat/document export, one live GitHub test repository as the engineering source and action destination, typed commitment extraction with evidence spans, deterministic graph traversal, and an owner/action interface. Add production Slack/CRM connectors after the central loop works.

Evaluate affected-account precision/recall on labeled fixtures, correct distinction between commitments and requests, supported evidence paths, fresh deadline selection, correct owners, and successful persisted actions. Affected ARR is exposure, not predicted loss or proven revenue saved.

## Prior hackathon patterns

- [Agent Harness official winners](https://www.wemakedevs.org/hackathons/trueforge/projects): ONCALL emphasizes recoverable incident execution; CapyGuard emphasizes evidence and structural separation; the page also lists many incident-response and repair submissions. Those domains have crowded precedents.
- [ONCALL repository](https://github.com/ElijahUmana/oncall-trueforge-hackathon): study restart reconciliation, source evidence, and confirmed external effects.
- [CapyGuard repository](https://github.com/chinesepowered/hack-qofo): study boundaries between untrusted material and the agent producing the verdict, and honest labels for unavailable evidence. Its README distinguishes live and replayed surfaces; do not assume every described path was live.
- [AgentHack 2025 gallery](https://archive.wemakedevs.org/hackathons/agenthack25/projects): DCRCA and an AML agent won prizes, establishing precedent for domain-specific investigation and coordination.
- [AI Agents Assemble 2025 gallery](https://archive.wemakedevs.org/hackathons/assemblehack25/projects): InFoundry won a sponsor prize with an inspect/propose/test workflow. Other sponsor winners differ substantially, so there is no single universal winning category.

Inference: a focused workflow, meaningful sponsor usage, observable state changes, and a credible failure demonstration are useful design lessons. The catalogs do not prove the causal reasons judges chose the winners. Reuse lessons, not submission code or branding.

## Four-day plan for PromiseGraph

1. October 15: ingestion, entity IDs, commitment classification, source spans, graph model, and labeled fixtures. Prove one changed ticket can retrieve the affected commitment and owner.
2. October 16: agent investigation, evidence paths, deadline risk logic, and an approved GitHub test-workspace action with receipt verification.
3. October 17: approved decision supersession, conflicting/unknown facts, replay/restart behavior, and comparison with a text-retrieval baseline. Add a second agent only if it has a clear specialist task.
4. October 18: deployment or verified local setup, README and key queries, short demo, disclosed data/AI use, and blog post. Leave time before the 11:59 PM IST deadline.

Strong demo order: a recognizable problem, one changed record, a multi-hop finding, its source evidence, a confirmed action, then a new fact that correctly changes the finding.

## Technical sources

- [Official event resources](https://www.wemakedevs.org/hackathons/falkordb/resources): direct links to clients, Cypher, algorithms, and setup.
- [FalkorDB MCP integration](https://www.falkordb.com/blog/mcp-integration-falkordb-graphrag/): supported integration route for agent graph tools.
- [Graphiti repository](https://github.com/getzep/graphiti): temporal knowledge graph tooling with a FalkorDB backend; optional, not needed for the first typed domain model.
- [Temporal retrieval issue](https://github.com/getzep/graphiti/issues/1625) and [MCP image schema issue](https://github.com/getzep/graphiti/issues/1656): reported version-specific pitfalls. If adopting Graphiti, inspect the installed version and test temporal retrieval and exposed tool schemas. These reports are not a claim that every current version is affected.

For the hackathon, explicit typed domain records and a few parameterized Cypher tools offer a manageable starting point. Use LLM extraction for unstructured statements, retain its evidence and uncertainty, and let verified graph records drive decisions. Demonstrate a real graph-dependent workflow rather than relying on a graph animation.
