# Flex Credit Pre-flight: end-to-end plan (14 October 2026)

A free Chrome extension that scans a Salesforce org before any AI feature is switched on and lists every automation that will spend Flex Credits without a person clicking anything, why, roughly how much, and where to change it.

## 1. Can it be built? Yes, with two parts still to prove

Everything below marked **verified** was checked on 14 October 2026 against Salesforce's own pages or a real org (the DealPulse Agentforce Developer Edition, read-only). **Unverified** items are the week-0 spikes.

| What the tool needs | Status | How we know |
|---|---|---|
| The metering rules themselves | **Verified** | [Metering for Agentforce and Generative AI Usage](https://help.salesforce.com/s/articleView?id=ai.generative_ai_usage_metering_logic.htm&type=5): usage is unmetered only when the user has the Unmetered User-Based AI permission *and* the prompt or action runs as the current user. A flow running as the Automated Process User: metered. Scheduled Apex or batch: metered. An agent on a schedule: metered. Agentforce Grid: always metered. Data 360 services consume credits even when the AI call is unmetered. |
| The credit prices | **Verified** | [Flex Credits Rate Card, 21 April 2026](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/assets/pdf/agentforce/Flex-Credits-Rate-Card-04.21.2026.pdf): agent action 20 credits (16 in sandbox); prompts 2 (basic), 4 (standard), 16 (advanced); Data 360 prep 40 per million rows, segmentation 50, activation 60, queries 3, unification 75,000 per million rows, streaming pipeline 3,500, real-time pipeline 250,000 per million events, unstructured processing 150 per MB, intelligent processing 600 per MB; volume tiers reset monthly. The $500 per 100,000 credits price is what customers report, not on the card. |
| Which flows call a prompt template, and in what context | **Verified** | Flow metadata carries `<actionType>generatePromptResponse</actionType>` with the template name, plus `triggerType` (record, scheduled) and `runInMode` (system or default). Confirmed in the [Flow metadata reference](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm) and in Salesforce's own sample code (trailheadapps/coral-cloud). Our engine already retrieves and parses flow metadata. |
| The unmetered permission | **Verified** | It is a permission set licence, "Unmetered User Based AI", plus a permission set ([Configure User Permissions for Unmetered Licenses](https://help.salesforce.com/s/articleView?language=en_US&id=ai.generative_ai_usage_unmetered_considerations.htm&type=5)). Readable through PermissionSetLicense and its assignments. The test org does not have it, so the tool must handle its absence (then nothing is unmetered). |
| Agents and whether they are active | **Verified** | BotDefinition and BotVersion, which the health check already reads. The test org shows three agents, two active. |
| Scheduled Apex that calls AI | **Verified, with a limit** | AsyncApexJob (JobType ScheduledApex) gives the class; ApexClass.Body is readable for the org's own classes and scanned for ConnectApi prompt and LLM calls. Managed-package classes return no body, so those are reported as "packaged, cannot read". |
| Threshold alerts | **Verified** | TenantConsumptionAlert is a queryable object (AlertType, AlertScope, TriggerValue, AlertStatus). Zero rows means no alert is set. |
| AI settings | **Verified** | Settings metadata: AgentPlatform (enableAgentPlatform), EinsteinGpt (enableEinsteinGptPlatform), EinsteinCopilot, SetupCopilot. Retrieved from the test org. |
| Data 360 streams and transforms | **Types exist, reads unverified** | DataStreamDefinition and MktDataTranObject are listed metadata types in the test org, but it holds none, so retrieving real ones is untested. This is the $31,000 case, so it matters. |
| Coworker billing global search | **Unverified** | No setting found that says Coworker is on. Fallback: report the Agentforce (Default) agent's active status, which the engine already reads. |
| Prompt credit tier per template | **Unverified** | The rate card tiers prompts by model (basic, standard, advanced). The template metadata names its primaryModel; the model-to-tier table lives in Salesforce's billing help and has to be copied in and dated. |
| A Chrome extension reaching the org with no connected app | **Verified** | Salesforce Inspector Reloaded (600,000 users) uses only the `cookies` and `storage` permissions plus host permissions on Salesforce domains, reads the session cookie and calls the REST and Tooling APIs. Same pattern. |
| The extension under passkey sign-in | **Unverified** | Inspector Reloaded has an open issue ([#1229](https://github.com/tprouvot/Salesforce-Inspector-reloaded/issues/1229)) about failing to launch in some passkey orgs. Week-0 spike on the Lakewood sandbox, which has passkeys. |

**Verdict:** the core (flows, scheduled Apex, agents, permissions, alerts, settings, credit maths) is buildable now on data we already know how to read. Data 360 is the one part that could shrink the first version if the reads fail; the tool is still useful without it, but less dramatic.

## 1a. Spike results, 14 October 2026

- **Data 360 is present on Lakewood production and the partial sandbox** (not the dev sandbox): 7 data streams, 7 source-object mappings, 5 data sources, 3 prompt templates, Agentforce Coworker licences provisioned (0 used). The streams are Salesforce's own standard set (CRM Account_Home and Contact_Home, plus the billing usage streams), which is what most orgs with Data 360 switched on will look like.
- **Stream and mapping definitions retrieve through the Metadata API** (19 files from the partial sandbox). The stream definition carries the connector type, the source, the lake object, and `dataExtractMethods`: Account_Home is `FULL_REFRESH`, the mode that reprocesses every row on each run. The mapping file lists the fields. Neither carries the refresh schedule or row counts.
- **Spike 2 passed, 15 October 2026, with the Data Cloud Architect permission set assigned.** The schedule and counts are plain SOQL on setup objects, no Connect API needed: `DataStream` (status, RefreshFrequency HOURLY or BATCH, RefreshHours, RefreshMode FULL, INCREMENTAL or UPSERT, FullRefreshIntervalDays, LastRefreshDate, rows added last run and in total), `DataLakeObjectInstance` (TotalRecords, LastRefreshDate), `MktDataTransform` (Type, FullRunFrequency, last run and status) and `MktCalculatedInsight`. Read on the partial sandbox and on production. Lakewood production: 7 streams, 5 active, all of them Salesforce's own billing-usage streams with 3 to 1,520 rows; the CRM Account and Contact streams exist but are inactive. So Lakewood spends almost nothing on Data 360 today, which is the right answer, and the engine now computes rows and credits per month per stream (`engine/src/data360.ts`).
- Earlier note, kept for the record: **the Connect API** (`/ssot/data-streams`, `data-transforms`, `identity-resolutions`, `activations`) (`/services/data/v67.0/ssot/data-streams`, `data-transforms`, `identity-resolutions`, `data-model-objects`), which answered FUNCTIONALITY_NOT_ENABLED for the admin user because no Data Cloud permission set licence is assigned on that org (0 of 200,000 used). `/ssot/segments` works. To test the schedule reads, a Data Cloud permission set has to be assigned to the admin running the tool; the extension will need to say so when it is missing.
- **Data 360 types in the org:** DataStreamDefinition, DataStreamTemplate, MktDataTranObject, DataSrcDataModelFieldMap, MktCalcInsightObjectDef, DataCalcInsightTemplate, MarketSegmentDefinition, ActivationPlatform, DataConnector (S3, Ingest API, streaming), MktDataConnection. So calculated insights, segments and activations are also readable as metadata, which covers four of the rate card's Data 360 lines without the Connect API.
- **Metadata retrieves can stall.** On 15 Oct 2026 a retrieve of two prompt templates from the Lakewood partial sandbox sat in Pending for over ten minutes, on a path that had taken 30 seconds that morning. The engine bounds the wait and reports the prompt tier as a range when the models are not read; the extension starts that retrieve first, in parallel with the flow reads.
- **Passkey spike: passed, 15 October 2026.** Loaded unpacked in Mitesh's Chrome on the Lakewood partial sandbox (passkey sign-in): session cookie found on the my.salesforce.com host, Organization query answered, Tooling query counted 64 flow definitions, and one flow's full definition came back as JSON. No connected app, nothing installed.
- **Decided:** open source under MIT from day one.

## 2. What the first version checks

Each finding says what it is, why Salesforce bills it (quoting the rule), what it could cost per month, and the Setup page to change it.

1. **Flows that call a prompt template and run as the Automated Process User.** Record-triggered and scheduled flows with `generatePromptResponse`. Cost estimate: records created or updated on the trigger object in the last 30 days (a count, not the records) times the prompt tier. The biggest everyday source.
2. **Flows that call a prompt template as the current user, where users lack the unmetered licence.** Same flows, different reason: without the licence, every run is metered anyway.
3. **Scheduled Apex and batch jobs that call prompts or LLMs.** Scheduled classes whose code calls the prompt or LLM APIs. Packaged classes listed as unreadable.
4. **Active agents, and which run without a person.** Active agents from BotVersion; flags scheduled or background use where detectable, and shows the 20-credit action price.
5. **Data 360 streams and transforms** (if the week-0 spike passes): each stream's refresh schedule and each transform, with the per-million-row price, so the admin sees that a full refresh of a large stream is the 75,000-credit line, not the 2-credit one.
6. **Agentforce Grid** (always metered) and **Coworker** (billing search once on): present or not.
7. **Unmetered licence coverage:** how many AI users hold the Unmetered User Based AI licence, and whether the licence exists in the org at all.
8. **Threshold alerts:** whether any consumption alert is configured, and a reminder that alerts notify but never stop spend.
9. **The month in numbers:** a table of every billable item with a low and high credit estimate and the dollar figure at the price the admin enters (default blank, with the reported $500 per 100,000 shown as a hint).

**What it will not do:** cap or stop spending (only Salesforce can), read records (counts only, and only with the admin's say-so in the UI), send anything anywhere, or claim exact bills. Every estimate is labelled an estimate.

## 3. How it is built

- **Form:** Chrome extension, Manifest V3, TypeScript, built with esbuild. Opens as a side panel in the Salesforce tab the admin already has open.
- **Access:** reads the Salesforce session cookie, calls REST, Tooling and Metadata APIs directly. Nothing installed in the org, no connected app, no server of ours, nothing leaves the browser. Permissions: `cookies`, `storage`, `sidePanel`, host permissions for Salesforce domains.
- **Engine:** the health check's existing flow retrieval and parsing (fast-xml-parser, fflate) moved into a shared package used by both the check and the extension. New: prompt-call detection, run-context rules, Apex body scan, Data 360 reads, credit maths.
- **Output:** a report page in the side panel, with "copy as Markdown" and "download HTML" so the admin can send it to whoever signs off on AI spend. Each line links into Setup.
- **Open source:** publish the repository under MIT on GitHub from day one. For a recognition tool this is the trust signal, and it is how Flow Scanner got built into bigger tools.
- **Not building:** a hosted version, accounts, or telemetry. Later: the same engine as an `sf` CLI plugin for companies that ban extensions.

## 4. Six-week plan

**Week 0, two days of spikes (go or no-go):**
- Extension skeleton: read the session cookie and run one Tooling query, on the Lakewood sandbox (passkeys on) and the DealPulse Developer Edition. If passkey orgs fail, stop and rethink.
- Retrieve DataStreamDefinition and MktDataTranObject from an org that has Data 360 content. Get a free Agentforce Developer Edition with Data 360 sample data for this; if none exists, ask a client or partner for one read-only run.
- Copy the model-to-tier table from Salesforce's billing help, with its date.

**Weeks 1 and 2: the engine.** Checks 1, 2, 3, 4, 7, 8 and the settings, as pure functions with tests, the way the health check's checks are written. Runs from the command line against the three test orgs before any UI exists.

**Week 3: Data 360 and estimates.** Check 5, the 30-day record counts, the credit table, sandbox versus production multipliers.

**Week 4: the side panel.** Report design, plain-language copy with the quoted rule per finding, Setup links, export. Same copy rules as the report: no em dashes, "we found", nothing we cannot stand behind.

**Week 5: hardening.** Orgs with 1,000+ flows (paging, time budget), packaged metadata, missing permissions (say what was skipped and why), a test on at least three orgs including one production org with real Flex Credit usage.

**Week 6: ship.** Chrome Web Store listing, privacy policy page on meethemind.com, screenshots and a 60-second demo recording, README, launch posts.

## 5. What you need to provide

| Item | Why | Cost |
|---|---|---|
| A Google account registered as a Chrome Web Store developer | To publish | $5 one-time |
| A privacy policy page on meethemind.com | Required by the Web Store; it states nothing leaves the browser | Your time, I draft it |
| An Agentforce Developer Edition org with Data 360 sample data | To build and test checks 4 to 6 | Free |
| One production org with real Flex Credit usage, for a read-only test | To check the estimates against a real bill | A client or partner's goodwill |
| A GitHub repository under MTM, public | Open source, trust, contributions | Free |
| A product name without "Agentforce" in it | Salesforce trademark rules; "for Salesforce" is allowed | A decision |
| An icon and two or three screenshots | Web Store listing | Small design job |
| A support email | Web Store requires one | partners@meethemind.com |
| Your time | Testing on orgs I cannot reach, reviewing copy, the launch posts | About a day a week |

## 6. Risks, and what we do about each

- **Salesforce changes the rules or prices.** Likely over a year. The rules and rate table live in one dated file in the repo; the report prints the date it was checked against.
- **It can only warn.** Hard caps are Salesforce's to build. The copy says so in the first line.
- **Estimates are rough.** Record counts stand in for flow runs; agent conversations are not countable from metadata. Show low and high, never one number.
- **Data 360 reads fail or need a licence.** Ship without check 5 and say so; add it when an org to test against appears.
- **Salesforce's AI Control Plane ships cost views.** Not before February 2027 by Salesforce Ben's reporting, and it shows cost after the fact; pre-flight stays different.
- **Some companies ban extensions.** The CLI version of the same engine, later.
- **Passkey orgs.** The week-0 spike decides this before any other work starts.

## 7. Launch

- Reply in the thread that started this ([Reddit, 19 Aug 2026](https://www.reddit.com/r/salesforce/comments/1vsx4jj/psa_be_careful_with_your_agentforce_and/)) and the Trailblazer forecasting threads, with the tool, not a pitch.
- The Trailblazer Community goes read-only on 30 October and moves to Slack; post there, on LinkedIn, and in r/salesforce.
- Pitch Salesforce Ben a maintainer-written piece: "what in your org spends Flex Credits without asking", using the tool's output on an anonymised org.
- Offer the engine to Salesforce Inspector Reloaded and Org Check as a module, the Flow Scanner route to reach.
- Every report ends with one line: the check is free, MTM does AI cost governance work.
